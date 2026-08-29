import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class SmsProviderReconciliationDto {
    @IsIn(["delivered", "not-delivered"])
    outcome!: "delivered" | "not-delivered";

    @IsString()
    @IsNotEmpty()
    @MaxLength(1000)
    reason!: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    providerMessageId?: string;
}
