import {
    ArrayNotEmpty,
    ArrayUnique,
    IsArray,
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    ValidateIf,
} from "class-validator";

export class CreateUserDto {
    @IsString()
    kakaoId!: string;

    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    profileImage?: string;
}

export class UpdateUserDto {
    @IsString()
    @IsOptional()
    name?: string | null;

    @IsString()
    @IsOptional()
    email?: string | null;

    @IsString()
    @IsOptional()
    profileImage?: string | null;

    @IsIn(["manager", "user"])
    @IsOptional()
    role?: string | null;
}

export class UpdateUserAccountDto {
    @IsIn(["admin", "manager", "user"])
    role!: "admin" | "manager" | "user";

    @IsArray()
    @ArrayNotEmpty()
    @ArrayUnique()
    @IsUUID("4", { each: true })
    branchIds!: string[];

    @IsIn(["admin", "manager", "user"])
    expectedRole!: "admin" | "manager" | "user";

    @IsArray()
    @ArrayUnique()
    @IsUUID("4", { each: true })
    expectedBranchIds!: string[];
}

export class UpdateBranchUserDto {
    @IsIn(["admin", "manager", "user"])
    branchRole!: "admin" | "manager" | "user";
}

export class ApproveUserDto {
    @IsIn(["admin", "manager", "user"])
    role!: "admin" | "manager" | "user";

    @IsUUID("4")
    branchId!: string;

    @ValidateIf((dto: ApproveUserDto) => dto.role === "admin")
    @IsUUID("4")
    ownerBranchId?: string;
}
