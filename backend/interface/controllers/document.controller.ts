import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    ForbiddenException,
    Inject,
    Logger,
    NotFoundException,
    Res,
    Query,
    UseGuards,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentService } from "application/services/document.service";
import { DocumentCategoryService } from "application/services/document-category.service";
import { UpdateDocumentDto, UploadDocumentDto } from "interface/dto/document.dto";
import {
    DocumentEntity,
    DOCUMENT_VISIBILITY_SCOPE,
    max_file_size,
} from "domain/entities/document.entity";
import {
    DOCUMENT_INLINE_SAFE_MIME_TYPE_SET,
    DOCUMENT_UPLOAD_CAPABILITIES,
} from "domain/constants/document-storage.constants";
import {
    getDocumentFileExtension,
    normalizeDocumentMimeType,
    validateDocumentUploadCandidate,
} from "domain/services/document-upload-policy";
import {
    FILE_STORAGE_PORT,
    FileStorageObjectNotFoundError,
    FileStoragePort,
} from "domain/ports/file-storage.port";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";

const MAX_DOCUMENT_TAGS = 50;
const MAX_DOCUMENT_TAG_LENGTH = 100;

function parseDocumentTags(tags: string[] | string | undefined): string[] {
    if (tags === undefined) {
        return [];
    }

    let parsed: unknown = tags;
    if (typeof tags === "string") {
        try {
            parsed = JSON.parse(tags);
        } catch {
            throw new BadRequestException("tags must be a valid JSON array");
        }
    }

    if (!Array.isArray(parsed)) {
        throw new BadRequestException("tags must be an array");
    }

    if (parsed.length > MAX_DOCUMENT_TAGS) {
        throw new BadRequestException(`tags must contain ${MAX_DOCUMENT_TAGS} items or fewer`);
    }

    if (!parsed.every((tag): tag is string => (
        typeof tag === "string" && tag.length <= MAX_DOCUMENT_TAG_LENGTH
    ))) {
        throw new BadRequestException(`each tag must be a string up to ${MAX_DOCUMENT_TAG_LENGTH} characters`);
    }

    return parsed;
}

function isMissingStorageObjectError(error: unknown): boolean {
    if (error instanceof FileStorageObjectNotFoundError) {
        return true;
    }

    if (!(error instanceof Error)) {
        return false;
    }

    return error.message.toLowerCase().includes("object not found");
}

interface DocumentTenant {
    branchId?: string;
    userId?: string;
    globalRole?: string | null;
}

function requireDocumentTenant(tenant: DocumentTenant): {
    branchId: string;
    userId: string;
    globalRole?: string | null;
} {
    if (!tenant.branchId || !tenant.userId) {
        throw new ForbiddenException("tenant context unavailable");
    }
    return {
        branchId: tenant.branchId,
        userId: tenant.userId,
        globalRole: tenant.globalRole,
    };
}

/** RFC 5987 value-chars percent-encoding: encodeURIComponent plus the characters it leaves bare that RFC 5987 does not allow. */
function encodeRfc5987ValueChars(value: string): string {
    return encodeURIComponent(value).replace(
        /['()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

/**
 * RFC 6266/5987 Content-Disposition value carrying an ASCII-only `filename`
 * fallback plus a UTF-8 `filename*`, so Korean document names survive a
 * download instead of arriving percent-encoded. Both parameters are built from
 * restricted alphabets - the fallback replaces every non-printable-ASCII byte
 * (including CR/LF), double quote, and backslash with "_", and the extended
 * form is fully percent-encoded - which is what keeps this header immune to
 * header/parameter injection through a document name.
 */
function buildContentDisposition(type: "inline" | "attachment", filename: string): string {
    const asciiFallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
    return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987ValueChars(filename)}`;
}

@Controller("documents")
@UseGuards(JwtGuard, TenantGuard)
export class DocumentController {
    private readonly logger = new Logger(DocumentController.name);

    constructor(
        private readonly documentService: DocumentService,
        private readonly documentCategoryService: DocumentCategoryService,
        @Inject(FILE_STORAGE_PORT)
        private readonly fileStorage: FileStoragePort,
    ) {}

    /**
     * POST /documents/upload
     * Upload a new document with file
     */
    @Post("upload")
    @UseInterceptors(
        FileInterceptor("file", {
            limits: {
                fileSize: max_file_size,
            },
        }),
    )
    async upload(
        @CurrentTenant() tenant: DocumentTenant,
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: UploadDocumentDto,
    ) {
        if (!file) {
            throw new BadRequestException("file is required");
        }

        const tags = parseDocumentTags(dto.tags);

        const validationError = validateDocumentUploadCandidate({
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            bytes: file.buffer,
        });
        if (validationError) throw new BadRequestException(validationError);

        const verifiedTenant = requireDocumentTenant(tenant);
        const isOwner = verifiedTenant.globalRole === "owner";
        const requestedVisibilityScope = dto.visibilityScope ??
            (isOwner ? DOCUMENT_VISIBILITY_SCOPE.ALL_BRANCHES : DOCUMENT_VISIBILITY_SCOPE.BRANCH);

        if (requestedVisibilityScope === DOCUMENT_VISIBILITY_SCOPE.ALL_BRANCHES && !isOwner) {
            throw new ForbiddenException("only owners can publish documents to all branches");
        }

        const documentName = dto.name?.trim() || file.originalname;
        if (documentName.length > 255) {
            throw new BadRequestException("document name must be 255 characters or fewer");
        }
        const mimeType = normalizeDocumentMimeType(file.mimetype);
        const branchId = verifiedTenant.branchId;
        await this.documentCategoryService.assertAvailableToBranch(branchId, dto.categoryId);
        const fileExtension = getDocumentFileExtension(file.originalname);
        const storagePath = `documents/${branchId}/${randomUUID()}${fileExtension}`;

        // upload to storage
        const storageUrl = await this.fileStorage.upload(
            file.buffer,
            storagePath,
            mimeType,
        );
        let entity: DocumentEntity;
        try {
            entity = await this.documentService.create(branchId, {
                name: documentName,
                description: dto.description,
                categoryId: dto.categoryId,
                tags,
                mimetype: mimeType,
                filesize: file.size,
                storagepath: storagePath,
                branchid: branchId,
                uploadedby: verifiedTenant.userId,
                visibilityScope: requestedVisibilityScope,
            });
        } catch (error) {
            // The object is already in storage, so a failed insert (claimed
            // storage path, stale category, transient DB error) would leak an
            // orphaned object no row references and no sweep job reclaims.
            // deleteStoragePath swallows object-not-found, so the compensation
            // is safe to attempt blindly; if it fails too, log it and still
            // rethrow the original error - the caller needs the real cause.
            try {
                await this.documentService.deleteStoragePath(storagePath);
            } catch (cleanupError) {
                this.logger.error(
                    `failed to delete orphaned storage object ${storagePath} after document creation failed`,
                    cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
                );
            }
            throw error;
        }
        return this.toResponse(entity, branchId, storageUrl);
    }

    @Get("capabilities")
    getCapabilities(@CurrentTenant() tenant: DocumentTenant) {
        const verifiedTenant = requireDocumentTenant(tenant);
        return {
            ...DOCUMENT_UPLOAD_CAPABILITIES,
            uploadVisibilityScope: verifiedTenant.globalRole === "owner"
                ? DOCUMENT_VISIBILITY_SCOPE.ALL_BRANCHES
                : DOCUMENT_VISIBILITY_SCOPE.BRANCH,
        };
    }

    @Get()
    async findAll(
        @CurrentTenant() tenant: DocumentTenant,
        @Query("categoryId") categoryId?: string
    ) {
        const { branchId } = requireDocumentTenant(tenant);
        const entities = categoryId
            ? await this.documentService.findByCategoryId(branchId, categoryId)
            : await this.documentService.findAll(branchId);
        return entities.map((entity) => this.toListResponse(entity, branchId));
    }

    @Get(":id")
    async findById(@CurrentTenant() tenant: DocumentTenant, @Param("id") id: string) {
        const { branchId } = requireDocumentTenant(tenant);
        const entity = await this.documentService.findById(branchId, id);
        return this.toResponse(entity, branchId);
    }

    /**
     * GET /documents/org/:branchid
     * Find documents by branch ID
     */
    @Get("org/:branchid")
    async findByOrgId(
        @CurrentTenant() tenant: DocumentTenant,
        @Param("branchid") branchid: string
    ) {
        const { branchId } = requireDocumentTenant(tenant);
        const entities = await this.documentService.findByOrgId(branchId, branchid);
        return entities.map((entity) => this.toListResponse(entity, branchId));
    }

    @Get("category/:categoryId")
    async findByCategoryId(
        @CurrentTenant() tenant: DocumentTenant,
        @Param("categoryId") categoryId: string
    ) {
        const { branchId } = requireDocumentTenant(tenant);
        const entities = await this.documentService.findByCategoryId(branchId, categoryId);
        return entities.map((entity) => this.toListResponse(entity, branchId));
    }

    @Put(":id")
    async update(
        @CurrentTenant() tenant: DocumentTenant,
        @Param("id") id: string,
        @Body() dto: UpdateDocumentDto
    ) {
        const { branchId } = requireDocumentTenant(tenant);
        if (dto.categoryId) {
            await this.documentCategoryService.assertAvailableToBranch(branchId, dto.categoryId);
        }
        const entity = await this.documentService.update(branchId, id, {
            name: dto.name,
            description: dto.description,
            categoryId: dto.categoryId,
            tags: dto.tags,
        });
        return this.toResponse(entity, branchId);
    }

    /**
     * DELETE /documents/:id
     * Delete a document (also deletes from storage)
     */
    @Delete(":id")
    async delete(@CurrentTenant() tenant: DocumentTenant, @Param("id") id: string) {
        const { branchId } = requireDocumentTenant(tenant);
        await this.documentService.deleteWithStorage(branchId, id);
        return { message: "Document deleted successfully" };
    }

    /**
     * GET /documents/:id/download
     * Download a document file
     */
    @Get(":id/download")
    async download(
        @CurrentTenant() tenant: DocumentTenant,
        @Param("id") id: string,
        @Res() res: Response,
        @Query("attachment") attachment?: string,
    ) {
        const { branchId } = requireDocumentTenant(tenant);
        const doc = await this.documentService.findById(branchId, id);
        let fileBuffer: Buffer;
        try {
            fileBuffer = await this.fileStorage.download(doc.storagepath);
        } catch (error) {
            if (isMissingStorageObjectError(error)) {
                throw new NotFoundException("Document file not found");
            }

            throw error;
        }
         
         // Helper to get extension from mimetype
         const getExtension = (mimetype: string): string => {
             const mimeToExt: Record<string, string> = {
                 "application/pdf": ".pdf",
                 "image/jpeg": ".jpg",
                 "image/png": ".png",
                 "image/gif": ".gif",
                 "image/webp": ".webp",
                 "application/msword": ".doc",
                 "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
                 "application/vnd.ms-excel": ".xls",
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
                 "application/hwp": ".hwp",
                 "application/haansofthwp": ".hwp",
                 "application/vnd.hancom.hwp": ".hwp",
                 "application/vnd.hancom.hwpx": ".hwpx",
                 "application/x-hwp": ".hwp",
                 "application/x-hwpx": ".hwpx",
             };
             return mimeToExt[mimetype] || "";
         };

         const getStorageExtension = (storagePath: string): string => {
             const cleanPath = storagePath.split(/[?#]/)[0] ?? "";
             const extensionMatch = cleanPath.match(/\.([a-z0-9]+)$/i);
             return extensionMatch?.[1] ? `.${extensionMatch[1].toLowerCase()}` : "";
         };
         
         // Ensure filename has extension
         let filename = doc.name;
         if (!filename.includes(".")) {
             filename += getExtension(doc.mimetype) || getStorageExtension(doc.storagepath);
         }
         
         // Only MIME types the preview UI renders may be displayed inline;
         // everything else becomes an opaque attachment regardless of what the
         // caller asked for, so stored browser-scriptable content can never
         // execute on this origin. nosniff stops an allowlisted Content-Type
         // from being re-sniffed into something executable.
         const normalizedMimeType = normalizeDocumentMimeType(doc.mimetype);
         const isInlineSafe = DOCUMENT_INLINE_SAFE_MIME_TYPE_SET.has(normalizedMimeType);
         const asAttachment = attachment === "true" || !isInlineSafe;

         res.set({
             "Content-Type": isInlineSafe ? normalizedMimeType : "application/octet-stream",
             "Content-Disposition": buildContentDisposition(
                 asAttachment ? "attachment" : "inline",
                 filename,
             ),
             "X-Content-Type-Options": "nosniff",
             "Content-Length": fileBuffer.length,
         });
         res.send(fileBuffer);
     }

    private async toResponse(
        entity: DocumentEntity,
        currentBranchId: string,
        storageUrl?: string,
    ) {
        let resolvedStorageUrl = storageUrl;
        if (resolvedStorageUrl === undefined) {
            try {
                resolvedStorageUrl = await this.fileStorage.createSignedUrl(entity.storagepath);
            } catch (error) {
                if (isMissingStorageObjectError(error)) {
                    throw new NotFoundException("Document file not found");
                }

                throw error;
            }
        }

        return this.serializeDocument(entity, resolvedStorageUrl, currentBranchId);
    }

    private toListResponse(entity: DocumentEntity, currentBranchId: string) {
        return this.serializeDocument(entity, null, currentBranchId);
    }

    private serializeDocument(
        entity: DocumentEntity,
        storageUrl: string | null,
        currentBranchId: string,
    ) {
        return {
            id: entity.id,
            name: entity.name,
            description: entity.description,
            categoryId: entity.categoryId,
            categoryLabel: entity.categoryLabel,
            tags: entity.tags,
            mimeType: entity.mimetype,
            fileSize: entity.filesize,
            storagePath: entity.storagepath,
            storageUrl,
            orgId: entity.branchid,
            uploadedBy: entity.uploadedby,
            visibilityScope: entity.visibilityScope,
            canManage: entity.branchId === currentBranchId,
            createdAt: entity.createdat,
            updatedAt: entity.updatedat,
        };
    }
}
