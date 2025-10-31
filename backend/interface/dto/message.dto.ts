import { IsString } from "class-validator";

export class CreateMessageDto {
    @IsString()
    title!: string;

    @IsString()
    text!: string;
}

export class UpdateMessageDto {
    @IsString()
    title!: string;

    @IsString()
    text!: string;
}

