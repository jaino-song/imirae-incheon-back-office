import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class VerifyReceiptBirthdayDto {
    // Optional, not required: an absent/empty birthday must reach the service's
    // invalid_format path (400 { reason: "invalid_format" }) rather than being
    // rejected by the global pipe as a bare class-validator message array with no
    // `reason` field — see receipt-link.controller.ts's receiptVerify(). MaxLength is
    // deliberately generous (64, not the birthday's real 6/8-digit length): the service already
    // normalizes/rejects any length it doesn't recognize with the proper { reason:
    // "invalid_format" } shape, so this exists only as a defense-in-depth cap against a
    // pathological payload, not as the primary validation.
    @IsOptional()
    @IsString()
    @MaxLength(64)
    birthday?: string;
}

export class SendReceiptLinkDto {
    @IsString()
    @IsNotEmpty()
    documentId!: string;
}
