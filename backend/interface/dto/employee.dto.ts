import { Transform } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from "class-validator";
import { EMPLOYEE_GRADES, normalizeEmployeeGrade } from "domain/constants/employee-grade.constants";
import { IsCanonicalPhone } from "./canonical-phone.validator";

export class CreateEmployeeDto {
    @IsString()
    name!: string;

    @IsArray()
    @IsString({ each: true })
    workArea!: string[];

    @IsString()
    @IsNotEmpty()
    @IsCanonicalPhone()
    phone!: string;

    @IsString()
    @Transform(({ value }) => typeof value === "string" ? normalizeEmployeeGrade(value) : value)
    @IsIn(EMPLOYEE_GRADES)
    grade!: string;

    @IsBoolean()
    openToNextWork!: boolean;

    @IsOptional()
    @IsDateString()
    registeredDate?: string;

    @IsOptional()
    @IsString()
    birthday?: string;
}

export class UpdateEmployeeDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    workArea?: string[];

    @ValidateIf((_, value) => value !== undefined)
    @IsString()
    @IsNotEmpty()
    @IsCanonicalPhone()
    phone?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => typeof value === "string" ? normalizeEmployeeGrade(value) : value)
    @IsIn(EMPLOYEE_GRADES)
    grade?: string;

    @IsOptional()
    @IsBoolean()
    openToNextWork?: boolean;

    @IsOptional()
    @IsString()
    birthday?: string;
}

export class ChangeEmployeeOpenStatusDto {
    @IsBoolean()
    openToNextWork!: boolean;
}

export class EmployeesByRegisteredDateDto {
    @IsDateString()
    date!: string;
}

export class EmployeesByRegisteredRangeDto {
    @IsDateString()
    startDate!: string;

    @IsDateString()
    endDate!: string;
}
