import { IsString, IsArray, IsBoolean, ValidateNested, IsOptional, IsEnum, IsNumber } from "class-validator";
import { Type } from "class-transformer";

export class TemplateVariableDto {
    @IsString()
    key!: string;

    @IsEnum(["text", "phone", "select", "date", "number", "textarea"])
    type!: "text" | "phone" | "select" | "date" | "number" | "textarea";

    @IsString()
    label!: string;

    @IsString()
    @IsOptional()
    placeholder?: string;

    @IsBoolean()
    required!: boolean;

    @IsOptional()
    @IsEnum(["custom", "dataSource"])
    optionType?: "custom" | "dataSource";

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    options?: string[];

    @IsOptional()
    @IsString()
    dataSource?: string;

    @IsOptional()
    @IsString()
    fallback?: string;

    @IsOptional()
    @IsNumber()
    min?: number;

    @IsOptional()
    @IsNumber()
    max?: number;
}

export class CreateMessageTemplateDto {
    @IsString()
    name!: string;

    @IsString()
    content!: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TemplateVariableDto)
    variables!: TemplateVariableDto[];
}

export class UpdateMessageTemplateDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    content?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TemplateVariableDto)
    @IsOptional()
    variables?: TemplateVariableDto[];
}
