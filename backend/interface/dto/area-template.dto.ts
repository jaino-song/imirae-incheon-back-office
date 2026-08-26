import { Transform } from "class-transformer";
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    ValidateIf,
} from "class-validator";

const trimString = ({ value }: { value: unknown }): unknown =>
    typeof value === "string" ? value.trim() : value;

export class CreateAreaTemplateDto {
    @IsString()
    @IsNotEmpty()
    area!: string;

    @Transform(trimString)
    @IsString()
    @IsNotEmpty()
    templateId!: string;

    @IsOptional()
    @IsString()
    templateName?: string | null;
}

export class UpdateAreaTemplateDto {
    @ValidateIf((_dto, value) => value !== undefined)
    @Transform(trimString)
    @IsString()
    @IsNotEmpty()
    templateId?: string;

    @IsOptional()
    @IsString()
    templateName?: string | null;
}
