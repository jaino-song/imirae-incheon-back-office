import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class GenerateStaffDocumentRequestDto {
    @IsString()
    @IsNotEmpty()
    documentId!: string;

    @IsOptional()
    @IsString()
    prefillEndDate?: string;
}
