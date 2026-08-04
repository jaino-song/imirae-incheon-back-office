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

@Controller("documents")
@UseGuards(JwtGuard, TenantGuard)
export class DocumentController {
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

        // generate unique storage path
        const lastDotIndex = file.originalname.lastIndexOf(".");
        const fileExtension =
            lastDotIndex >= 0 ? file.originalname.slice(lastDotIndex + 1) : "";
        const storagePath = fileExtension
            ? `${randomUUID()}.${fileExtension}`
            : randomUUID();
        const mimeType = file.mimetype || "application/octet-stream";
        const tags = parseDocumentTags(dto.tags);

        // upload to storage
        const storageUrl = await this.fileStorage.upload(
            file.buffer,
            storagePath,
            mimeType,
        );
        const branchId = tenant.branchId ?? "";

        const entity = await this.documentService.create(branchId, {
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
        return this.toResponse(entity, storageUrl);
    }

    @Post()
    async create(@CurrentTenant() tenant: { branchId?: string }, @Body() dto: CreateDocumentDto) {
        const branchId = tenant.branchId ?? "";

        const entity = await this.documentService.create(branchId, {
            name: dto.name,
            description: dto.description,
            categoryId: dto.categoryId,
            tags: dto.tags,
            mimetype: dto.mimetype,
            filesize: dto.filesize,
            storagepath: dto.storagepath,
            branchid: branchId,
            uploadedby: dto.uploadedby,
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
         
         const disposition = attachment === "true" 
             ? `attachment; filename="${encodeURIComponent(filename)}"` 
             : "inline";
         
         res.set({
             "Content-Type": doc.mimetype,
             "Content-Disposition": disposition,
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
