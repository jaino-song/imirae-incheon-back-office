import { IsBoolean, IsDateString, IsInt, IsOptional, IsString } from "class-validator";

export class CreateEmployeeScheduleDto {
    @IsInt()
    employeeId!: number;

    @IsString()
    workAddress!: string;

    @IsDateString()
    startDate!: string;

    @IsDateString()
    endDate!: string;

    @IsOptional()
    @IsBoolean()
    replaced?: boolean;
}

export class UpdateEmployeeScheduleDto {
    @IsOptional()
    @IsString()
    workAddress?: string;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;

    @IsOptional()
    @IsBoolean()
    replaced?: boolean;
}
