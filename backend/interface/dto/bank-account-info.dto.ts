import { IsString, IsOptional } from "class-validator";

export class CreateBankAccountInfoDto {
    @IsString()
    area!: string;

    @IsString()
    bankName!: string;

    @IsString()
    accNum!: string;
}

export class UpdateBankAccountInfoDto {
    @IsString()
    @IsOptional()
    bankName?: string | null;

    @IsString()
    @IsOptional()
    accNum?: string | null;
}