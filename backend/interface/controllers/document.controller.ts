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
import { CreateDocumentDto, UpdateDocumentDto, UploadDocumentDto } from "interface/dto/document.dto";
import {
    DocumentEntity,
    max_file_size,
} from "domain/entities/document.entity";
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

/**
 * Lowercased media-type "essence" with any parameters (`; charset=...`)
 * stripped, so MIME checks cannot be bypassed with variants such as
 * `TEXT/HTML; charset=utf-8`.
 */
function normalizeMimeType(mimetype: string | undefined | null): string {
    return (mimetype ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * MIME types that may be rendered inline on this origin: PDF plus the raster
 * image types the preview UI actually displays. Everything else is forced into
 * an opaque attachment download so browser-scriptable content (text/html,
 * image/svg+xml, XML, ...) stored under any historical row can never execute
 * with a staff session. image/svg+xml is deliberately absent - SVG can carry
 * script, and the preview UI's image check matches every image/* type.
 * image/jpg is a nonstandard alias of image/jpeg that the mobile upload page
 * has always accepted; it is a harmless raster type, kept so such rows keep
 * previewing.
 */
const INLINE_SAFE_MIME_TYPES: ReadonlySet<string> = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
]);

/**
 * Defence-in-depth allowlist for uploads, deliberately broader than
 * INLINE_SAFE_MIME_TYPES: it covers every MIME type the product itself models
 * (the download extension map below, frontend document-preview-utils, the
 * mobile upload page) plus office/archive/text formats staff plausibly upload
 * through the desktop dropzone, which historically accepted any type.
 * application/octet-stream must stay allowed: browsers derive a file's type
 * from OS registry data, so .hwp/.hwpx - the product's flagship document
 * format - and other locally unregistered extensions frequently arrive as
 * application/octet-stream (or with no type at all). That is safe because
 * nothing outside INLINE_SAFE_MIME_TYPES is ever served inline, so a
 * mislabelled upload can only ever be downloaded, never rendered. What this
 * list is really for is keeping browser-scriptable types (text/html,
 * image/svg+xml, XML, JavaScript) out of storage entirely.
 */
const UPLOAD_ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
    ...INLINE_SAFE_MIME_TYPES,
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/hwp",
    "application/haansofthwp",
    "application/vnd.hancom.hwp",
    "application/vnd.hancom.hwpx",
    "application/x-hwp",
    "application/x-hwpx",
    "image/heic",
    "image/heif",
    "application/zip",
    "application/x-zip-compressed",
    "text/plain",
    "text/csv",
    "application/octet-stream",
]);

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
        @CurrentTenant() tenant: { branchId?: string; userId?: string },
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: UploadDocumentDto,
    ) {
        if (!file) {
            throw new BadRequestException("file is required");
        }

        // validate file size
        if (!DocumentEntity.validatefilesize(file.size)) {
            throw new BadRequestException(
                `file size exceeds maximum limit of ${max_file_size / (1024 * 1024)}mb`,
            );
        }

        // Multer forwards the client-supplied multipart Content-Type verbatim,
        // so gate it against the upload allowlist before anything is stored.
        const mimeType = normalizeMimeType(file.mimetype) || "application/octet-stream";
        if (!UPLOAD_ALLOWED_MIME_TYPES.has(mimeType)) {
            throw new BadRequestException(`unsupported file type: ${mimeType}`);
        }

        // generate unique storage path
        const lastDotIndex = file.originalname.lastIndexOf(".");
        const fileExtension =
            lastDotIndex >= 0 ? file.originalname.slice(lastDotIndex + 1) : "";
        const storagePath = fileExtension
            ? `${randomUUID()}.${fileExtension}`
            : randomUUID();
        const tags = parseDocumentTags(dto.tags);

        // upload to storage
        const storageUrl = await this.fileStorage.upload(
            file.buffer,
            storagePath,
            mimeType,
        );
        const branchId = tenant.branchId ?? "";

        let entity: DocumentEntity;
        try {
            entity = await this.documentService.create(branchId, {
                name: dto.name || file.originalname,
                description: dto.description,
                categoryId: dto.categoryId,
                tags,
                mimetype: mimeType,
                filesize: file.size,
                storagepath: storagePath,
                branchid: branchId,
                uploadedby: tenant.userId || "system",
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
        return this.toResponse(entity, storageUrl);
    }

    /**
     * Registers a row against a storage object that is already there. No client
     * calls it — both apps upload through POST /upload — but it is reachable by
     * anyone holding a token, so it derives what it can rather than believing
     * the body. The storage path is still the caller's claim; that is safe
     * because DocumentService.create refuses a path another branch owns.
     */
    @Post()
    async create(
        @CurrentTenant() tenant: { branchId?: string; userId?: string },
        @Body() dto: CreateDocumentDto,
    ) {
        const branchId = tenant.branchId ?? "";
        // Same gate as the upload route: this row's mimetype decides how the
        // download serves it, so an unfiltered one would be the way around the
        // inline allowlist.
        const mimeType = normalizeMimeType(dto.mimetype) || "application/octet-stream";
        if (!UPLOAD_ALLOWED_MIME_TYPES.has(mimeType)) {
            throw new BadRequestException(`unsupported file type: ${mimeType}`);
        }

        const entity = await this.documentService.create(branchId, {
            name: dto.name,
            description: dto.description,
            categoryId: dto.categoryId,
            tags: dto.tags,
            mimetype: mimeType,
            filesize: dto.filesize,
            storagepath: dto.storagepath,
            branchid: branchId,
            // Taken from the verified tenant, never the body — otherwise the
            // audit trail is whatever the caller typed.
            uploadedby: tenant.userId || "system",
        });
        return this.toResponse(entity);
    }

    @Get()
    async findAll(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("categoryId") categoryId?: string
    ) {
        const entities = categoryId 
            ? await this.documentService.findByCategoryId(tenant.branchId ?? "", categoryId) 
            : await this.documentService.findAll(tenant.branchId ?? "");
        return entities.map((entity) => this.toListResponse(entity));
    }

    @Get(":id")
    async findById(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string) {
        const entity = await this.documentService.findById(tenant.branchId ?? "", id);
        return this.toResponse(entity);
    }

    /**
     * GET /documents/org/:branchid
     * Find documents by branch ID
     */
    @Get("org/:branchid")
    async findByOrgId(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("branchid") branchid: string
    ) {
        const entities = await this.documentService.findByOrgId(tenant.branchId ?? "", branchid);
        return entities.map((entity) => this.toListResponse(entity));
    }

    @Get("category/:categoryId")
    async findByCategoryId(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("categoryId") categoryId: string
    ) {
        const entities = await this.documentService.findByCategoryId(
            tenant.branchId ?? "",
            categoryId
        );
        return entities.map((entity) => this.toListResponse(entity));
    }

    @Put(":id")
    async update(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Body() dto: UpdateDocumentDto
    ) {
        const entity = await this.documentService.update(tenant.branchId ?? "", id, {
            name: dto.name,
            description: dto.description,
            categoryId: dto.categoryId,
            tags: dto.tags,
        });
        return this.toResponse(entity);
    }

    /**
     * DELETE /documents/:id
     * Delete a document (also deletes from storage)
     */
    @Delete(":id")
    async delete(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string) {
        await this.documentService.deleteWithStorage(tenant.branchId ?? "", id);
        return { message: "Document deleted successfully" };
    }

     /**
      * GET /documents/:id/download
      * Download a document file
      */
     @Get(":id/download")
     async download(
         @CurrentTenant() tenant: { branchId?: string },
         @Param("id") id: string,
         @Res() res: Response,
         @Query("attachment") attachment?: string,
     ) {
         const doc = await this.documentService.findById(tenant.branchId ?? "", id);
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
         const normalizedMimeType = normalizeMimeType(doc.mimetype);
         const isInlineSafe = INLINE_SAFE_MIME_TYPES.has(normalizedMimeType);
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

    private async toResponse(entity: DocumentEntity, storageUrl?: string) {
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

        return this.serializeDocument(entity, resolvedStorageUrl);
    }

    private toListResponse(entity: DocumentEntity) {
        return this.serializeDocument(entity, null);
    }

    private serializeDocument(entity: DocumentEntity, storageUrl: string | null) {
        return {
            id: entity.id,
            name: entity.name,
            description: entity.description,
            categoryId: entity.categoryId,
            tags: entity.tags,
            mimeType: entity.mimetype,
            fileSize: entity.filesize,
            storagePath: entity.storagepath,
            storageUrl,
            orgId: entity.branchid,
            uploadedBy: entity.uploadedby,
            createdAt: entity.createdat,
            updatedAt: entity.updatedat,
        };
    }
}
