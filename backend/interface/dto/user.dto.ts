import { IsString, IsOptional } from "class-validator";

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

    @IsString()
    @IsOptional()
    role?: string | null;
}