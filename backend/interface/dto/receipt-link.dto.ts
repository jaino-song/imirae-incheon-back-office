import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class VerifyReceiptBirthdayDto {
    // Optional, not required: an absent/empty birthday must reach the service's
    // invalid_format path (400 { reason: "invalid_format" }) rather than being
    // rejected by the global pipe as a bare class-validator message array with no
    // `reason` field — see receipt-link.controller.ts's receiptVerify(). No @MaxLength either,
    // for the same reason: the service already normalizes/rejects any length it doesn't
    // recognize, and a class-validator 400 here would carry no `reason` field.
    @IsOptional()
    @IsString()
    birthday?: string;
}

export class SendReceiptLinkDto {
    @IsString()
    @IsNotEmpty()
    documentId!: string;
}
