import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsDateString,
  IsBoolean,
  IsIn,
  MaxLength,
  ArrayMaxSize,
} from "class-validator";

export class UpdateDocumentDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    categoryId?: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @IsString({ each: true })
    @MaxLength(100, { each: true })
    tags?: string[];
}

/**
 * 문서 조회 필터 DTO (쿼리 파라미터)
 */
export class DocumentFilterDto {
    @IsOptional()
    @IsString()
    category?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @IsOptional()
    @IsString()
    uploadedBy?: string;

    @IsOptional()
    @IsString()
    orgId?: string;
}

/**
 * 문서 응답 DTO
 */
export class DocumentResponseDto {
    @IsString()
    id!: string;

    @IsString()
    name!: string;

    @IsOptional()
    @IsString()
    description!: string | null;

    @IsString()
    categoryId!: string;

    @IsOptional()
    @IsString()
    categoryLabel!: string | null;

    @IsArray()
    @IsString({ each: true })
    tags!: string[];

    @IsString()
    mimeType!: string;

    @IsNumber()
    fileSize!: number;

    @IsString()
    storagePath!: string;

    @IsOptional()
    @IsString()
    storageUrl!: string | null;

    @IsOptional()
    @IsString()
    orgId!: string | null;

    @IsString()
    uploadedBy!: string;

    @IsString()
    visibilityScope!: string;

    @IsBoolean()
    canManage!: boolean;

    @IsDateString()
    createdAt!: Date;

    @IsDateString()
    updatedAt!: Date;
}

export class UploadDocumentDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string;

    @IsString()
    @MaxLength(100)
    categoryId!: string;

    @IsOptional()
    @IsIn(["branch", "all_branches"])
    visibilityScope?: "branch" | "all_branches";

    @IsOptional()
    tags?: string[] | string;
}
