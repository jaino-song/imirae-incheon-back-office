import {
    createRemediationStoragePath,
    type DocumentStorageRemediationRepository,
    type DuplicateDocumentOwner,
    type LockedDocumentRemediation,
    remediateDocumentStoragePathDuplicates,
} from "application/services/document-storage-duplicate-remediator";
import {
    FileStorageObjectNotFoundError,
    type FileStoragePort,
} from "domain/ports/file-storage.port";

const SOURCE_PATH = "documents/legacy/shared.pdf";
const SOURCE_BYTES = Buffer.from("same-bytes");

function owner(
    id: string,
    branchId: string,
    createdAt: string,
): DuplicateDocumentOwner {
    return {
        id,
        branchId,
        storagePath: SOURCE_PATH,
        mimeType: "application/pdf",
        fileSize: SOURCE_BYTES.byteLength,
        createdAt: new Date(createdAt),
    };
}

class FakeStorage implements FileStoragePort {
    readonly objects = new Map<string, Buffer>([[SOURCE_PATH, SOURCE_BYTES]]);
    corruptNewCopies = false;
    upload = jest.fn(async (file: Buffer, path: string): Promise<string> => {
        if (this.objects.has(path)) throw new Error("object already exists");
        this.objects.set(
            path,
            this.corruptNewCopies ? Buffer.from("SAME-BYTES") : Buffer.from(file),
        );
        return `signed://${path}`;
    });
    delete = jest.fn(async (path: string): Promise<void> => {
        this.objects.delete(path);
    });

    async download(path: string): Promise<Buffer> {
        const object = this.objects.get(path);
        if (!object) throw new FileStorageObjectNotFoundError(path, "download");
        return Buffer.from(object);
    }

    async createSignedUrl(path: string): Promise<string> {
        return `signed://${path}`;
    }

    async ensureBucketExists(): Promise<void> {}
}

class FakeRepository implements DocumentStorageRemediationRepository {
    readonly validBranches = new Set<string>();
    replaceSucceeds = true;

    constructor(readonly owners: DuplicateDocumentOwner[]) {
        for (const item of owners) {
            if (item.branchId) this.validBranches.add(item.branchId);
        }
    }

    async listDuplicateStoragePaths(): Promise<string[]> {
        const counts = new Map<string, number>();
        for (const item of this.owners) {
            counts.set(item.storagePath, (counts.get(item.storagePath) ?? 0) + 1);
        }
        return [...counts.entries()]
            .filter(([, count]) => count > 1)
            .map(([storagePath]) => storagePath)
            .sort();
    }

    async listStoragePathOwners(storagePath: string): Promise<DuplicateDocumentOwner[]> {
        return this.owners.filter((item) => item.storagePath === storagePath);
    }

    async withLockedOwner(
        id: string,
        expectedStoragePath: string,
        operation: (transaction: LockedDocumentRemediation) => Promise<void>,
    ): Promise<boolean> {
        const lockedOwner = this.owners.find(
            (item) => item.id === id && item.storagePath === expectedStoragePath,
        );
        if (!lockedOwner) return false;

        await operation({
            owner: lockedOwner,
            branchExists: async (branchId) => this.validBranches.has(branchId),
            findDocumentIdByStoragePath: async (storagePath) => this.owners
                .find((item) => item.storagePath === storagePath)?.id ?? null,
            replaceStoragePath: async (storagePath) => {
                if (!this.replaceSucceeds
                    || lockedOwner.storagePath !== expectedStoragePath) return false;
                lockedOwner.storagePath = storagePath;
                return true;
            },
        });
        return true;
    }
}

describe("document storage duplicate remediation", () => {
    it("keeps the stable earliest owner and gives later rows verified deterministic copies", async () => {
        const earliest = owner("doc-a", "branch-a", "2026-01-01T00:00:00.000Z");
        const later = owner("doc-b", "branch-b", "2026-01-02T00:00:00.000Z");
        const latest = owner("doc-c", "branch-c", "2026-01-03T00:00:00.000Z");
        const repository = new FakeRepository([latest, earliest, later]);
        const storage = new FakeStorage();
        const laterDestination = createRemediationStoragePath(later);
        const latestDestination = createRemediationStoragePath(latest);

        const summary = await remediateDocumentStoragePathDuplicates(
            repository,
            storage,
        );

        expect(earliest.storagePath).toBe(SOURCE_PATH);
        expect(later.storagePath).toBe(laterDestination);
        expect(latest.storagePath).toBe(latestDestination);
        expect(storage.objects.get(SOURCE_PATH)).toEqual(SOURCE_BYTES);
        expect(storage.objects.get(later.storagePath)).toEqual(SOURCE_BYTES);
        expect(storage.objects.get(latest.storagePath)).toEqual(SOURCE_BYTES);
        expect(summary).toEqual({
            duplicatePathsFound: 1,
            ownersRemediated: 2,
            staleOwnersSkipped: 0,
            verifiedCopiesReused: 0,
        });
    });

    it("reuses a verified deterministic orphan after an interrupted prior run", async () => {
        const earliest = owner("doc-a", "branch-a", "2026-01-01T00:00:00.000Z");
        const later = owner("doc-b", "branch-b", "2026-01-02T00:00:00.000Z");
        const repository = new FakeRepository([earliest, later]);
        const storage = new FakeStorage();
        const destinationPath = createRemediationStoragePath(later);
        storage.objects.set(destinationPath, SOURCE_BYTES);

        const summary = await remediateDocumentStoragePathDuplicates(
            repository,
            storage,
        );

        expect(later.storagePath).toBe(destinationPath);
        expect(storage.upload).not.toHaveBeenCalled();
        expect(summary.verifiedCopiesReused).toBe(1);
    });

    it("deletes a new copy and leaves metadata unchanged when conditional update loses ownership", async () => {
        const earliest = owner("doc-a", "branch-a", "2026-01-01T00:00:00.000Z");
        const later = owner("doc-b", "branch-b", "2026-01-02T00:00:00.000Z");
        const repository = new FakeRepository([earliest, later]);
        repository.replaceSucceeds = false;
        const storage = new FakeStorage();
        const destinationPath = createRemediationStoragePath(later);

        await expect(remediateDocumentStoragePathDuplicates(repository, storage))
            .rejects.toThrow("Conditional storage_path update lost ownership");

        expect(later.storagePath).toBe(SOURCE_PATH);
        expect(storage.objects.has(destinationPath)).toBe(false);
        expect(storage.delete).toHaveBeenCalledWith(destinationPath);
        expect(storage.objects.get(SOURCE_PATH)).toEqual(SOURCE_BYTES);
    });

    it("rejects a hash-mismatched copy, compensates it, and never updates the row", async () => {
        const earliest = owner("doc-a", "branch-a", "2026-01-01T00:00:00.000Z");
        const later = owner("doc-b", "branch-b", "2026-01-02T00:00:00.000Z");
        const repository = new FakeRepository([earliest, later]);
        const storage = new FakeStorage();
        storage.corruptNewCopies = true;
        const destinationPath = createRemediationStoragePath(later);

        await expect(remediateDocumentStoragePathDuplicates(repository, storage))
            .rejects.toThrow("SHA-256 mismatch");

        expect(later.storagePath).toBe(SOURCE_PATH);
        expect(storage.objects.has(destinationPath)).toBe(false);
        expect(storage.objects.get(SOURCE_PATH)).toEqual(SOURCE_BYTES);
    });

    it("refuses an unverified branch before creating a destination object", async () => {
        const earliest = owner("doc-a", "branch-a", "2026-01-01T00:00:00.000Z");
        const later = owner("doc-b", "branch-b", "2026-01-02T00:00:00.000Z");
        const repository = new FakeRepository([earliest, later]);
        repository.validBranches.delete("branch-b");
        const storage = new FakeStorage();

        await expect(remediateDocumentStoragePathDuplicates(repository, storage))
            .rejects.toThrow("branch is not verified");

        expect(storage.upload).not.toHaveBeenCalled();
        expect(later.storagePath).toBe(SOURCE_PATH);
    });
});
