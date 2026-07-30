import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "infrastructure/database/prisma.service";

const COMPLETED_STATUS_CODES = [
    "003",
    "012",
    "022",
    "032",
    "050",
    "062",
    "072",
    "092",
];
const DELETED_STATUS_CODES = ["047", "049", "099"];

export interface EformsignMirrorReadiness {
    ready: boolean;
    missingDetails: number;
    completedWithoutDocumentPdf: number;
    completedWithoutAuditTrailPdf: number;
    unfinishedSyncs: number;
}

export class EformsignMirrorNotReadyError extends Error {
    constructor(readonly readiness: EformsignMirrorReadiness) {
        super(
            "Eformsign local mirror is not ready"
            + ` missingDetails=${readiness.missingDetails}`
            + ` completedWithoutDocumentPdf=${readiness.completedWithoutDocumentPdf}`
            + ` completedWithoutAuditTrailPdf=${readiness.completedWithoutAuditTrailPdf}`
            + ` unfinishedSyncs=${readiness.unfinishedSyncs}`,
        );
        this.name = EformsignMirrorNotReadyError.name;
    }
}

@Injectable()
export class EformsignMirrorReadinessService {
    constructor(private readonly prisma: PrismaService) {}

    async inspect(): Promise<EformsignMirrorReadiness> {
        const activeDocuments = {
            statusType: { notIn: DELETED_STATUS_CODES },
        };
        const completedDocumentWhere = {
            statusType: { in: COMPLETED_STATUS_CODES },
        };
        const [
            missingDetails,
            unfinishedSyncs,
            completedRows,
        ] = await Promise.all([
            this.prisma.eformsign_doc.count({
                where: {
                    ...activeDocuments,
                    detailPayload: { equals: Prisma.DbNull },
                },
            }),
            this.prisma.eformsign_doc.count({
                where: {
                    ...activeDocuments,
                    syncStatus: { in: ["pending", "syncing", "failed"] },
                },
            }),
            this.prisma.eformsign_doc.findMany({
                where: completedDocumentWhere,
                select: {
                    syncStatus: true,
                    detailSourceUpdatedDate: true,
                    files: {
                        select: { fileType: true, sourceUpdatedDate: true },
                    },
                },
            }),
        ]);
        const hasCurrentFile = (
            document: (typeof completedRows)[number],
            fileType: "document" | "audit_trail",
        ): boolean => document.syncStatus === "ready"
            && document.detailSourceUpdatedDate !== null
            && document.files.some((file) => file.fileType === fileType
                && file.sourceUpdatedDate.getTime()
                    === document.detailSourceUpdatedDate!.getTime());
        const completedWithoutDocumentPdf = completedRows.filter(
            (document) => !hasCurrentFile(document, "document"),
        ).length;
        const completedWithoutAuditTrailPdf = completedRows.filter(
            (document) => !hasCurrentFile(document, "audit_trail"),
        ).length;

        return {
            ready:
                missingDetails === 0
                && completedWithoutDocumentPdf === 0
                && completedWithoutAuditTrailPdf === 0
                && unfinishedSyncs === 0,
            missingDetails,
            completedWithoutDocumentPdf,
            completedWithoutAuditTrailPdf,
            unfinishedSyncs,
        };
    }

    async assertReady(): Promise<EformsignMirrorReadiness> {
        const readiness = await this.inspect();
        if (!readiness.ready) {
            throw new EformsignMirrorNotReadyError(readiness);
        }
        return readiness;
    }
}
