import { Type } from "class-transformer";
import {
    ArrayNotEmpty,
    IsArray,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from "class-validator";
import { IsCanonicalPhone } from "./canonical-phone.validator";

export class GenerateSignatureRequestDto {
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    executionTime!: number;
}

export class DeleteDocumentsRequestDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    document_ids!: string[];
}

class RecipientPhoneDto {
    @IsString()
    @IsNotEmpty()
    countryCode!: string;

    @IsString()
    @IsNotEmpty()
    @IsCanonicalPhone()
    phoneNumber!: string;
}

export class ReRequestOutsiderDocumentRequestDto {
    @IsString()
    @IsNotEmpty()
    stepType!: string;

    @IsString()
    @IsNotEmpty()
    stepSeq!: string;

    @IsOptional()
    @IsString()
    comment?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => RecipientPhoneDto)
    recipientPhone?: RecipientPhoneDto;
}
