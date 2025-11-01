import { IsBoolean, IsDateString, IsInt, IsOptional, IsString } from "class-validator";

export class CreateClientDto {
    @IsString()
    name!: string;

    @IsInt()
    primaryEmployeeId!: number;

    @IsOptional()
    @IsInt()
    secondaryEmployeeId?: number | null;

    @IsOptional()
    @IsString()
    address?: string | null;

    @IsOptional()
    @IsString()
    phone?: string | null;

    @IsOptional()
    @IsString()
    type?: string | null;

    @IsOptional()
    @IsInt()
    duration?: number | null;

    @IsOptional()
    @IsString()
    fullPrice?: string | null;

    @IsOptional()
    @IsString()
    grant?: string | null;

    @IsOptional()
    @IsString()
    actualPrice?: string | null;

    @IsOptional()
    @IsDateString()
    startDate?: string | null;

    @IsOptional()
    @IsDateString()
    endDate?: string | null;

    @IsBoolean()
    careCenter!: boolean;

    @IsBoolean()
    voucherClient!: boolean;
}

export class UpdateClientDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsInt()
    primaryEmployeeId?: number;

    @IsOptional()
    @IsInt()
    secondaryEmployeeId?: number | null;

    @IsOptional()
    @IsString()
    address?: string | null;

    @IsOptional()
    @IsString()
    phone?: string | null;

    @IsOptional()
    @IsString()
    type?: string | null;

    @IsOptional()
    @IsInt()
    duration?: number | null;

    @IsOptional()
    @IsString()
    fullPrice?: string | null;

    @IsOptional()
    @IsString()
    grant?: string | null;

    @IsOptional()
    @IsString()
    actualPrice?: string | null;

    @IsOptional()
    @IsDateString()
    startDate?: string | null;

    @IsOptional()
    @IsDateString()
    endDate?: string | null;

    @IsOptional()
    @IsBoolean()
    careCenter?: boolean;

    @IsOptional()
    @IsBoolean()
    voucherClient?: boolean;
}
