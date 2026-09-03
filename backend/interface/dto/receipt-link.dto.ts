import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class VerifyReceiptBirthdayDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(12)
    birthday!: string;
}

export class SendReceiptLinkDto {
    @IsString()
    @IsNotEmpty()
    documentId!: string;
}
