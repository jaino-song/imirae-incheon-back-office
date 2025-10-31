import { IsNumberString, IsOptional, IsString } from "class-validator";

export class CreateVoucherPriceInfoDto {
    @IsString()
    type!: string;

    @IsNumberString()
    duration!: string;

    @IsString()
    fullPrice!: string;

    @IsString()
    grant!: string;

    @IsString()
    actualPrice!: string;
}

export class UpdateVoucherPriceInfoDto {
    @IsOptional()
    @IsString()
    type?: string | null;

    @IsOptional()
    @IsNumberString()
    duration?: string | null;

    @IsOptional()
    @IsString()
    fullPrice?: string | null;

    @IsOptional()
    @IsString()
    grant?: string | null;

    @IsOptional()
    @IsString()
    actualPrice?: string | null;
}

