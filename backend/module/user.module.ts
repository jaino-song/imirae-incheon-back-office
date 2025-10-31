import { Module } from "@nestjs/common";
import {
    CreateUserUsecase,
    FindUserByIdUsecase,
    FindUserByKakaoIdUsecase,
    UpdateUserUsecase,
    DeleteUserUsecase,
} from "application/usecases/user";
import {
    SbUserRepository,
} from "infrastructure/database/repositories/sb.user.repository";
import { UserService } from "application/services/user.service";
import { UserController } from "interface/controllers/user.controller";
import { USER_REPOSITORY } from "domain/repositories/user.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

@Module({
    controllers: [UserController],
    providers: [
        CreateUserUsecase,
        FindUserByIdUsecase,
        FindUserByKakaoIdUsecase,
        UpdateUserUsecase,
        DeleteUserUsecase,
        UserService,
        PrismaService,
        {
            provide: USER_REPOSITORY,
            useClass: SbUserRepository,
        },
    ],
    exports: [UserService],
})
export class UserModule {}