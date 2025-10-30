import { IUserRepository, USER_REPOSITORY } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";
import { Injectable, Inject } from "@nestjs/common";

@Injectable()
export class CreateUserUsecase {
    constructor(
        @Inject(USER_REPOSITORY)
        private userRepository: IUserRepository,
    ) {}

    async execute(kakaoId: string, name?: string, email?: string, profileImage?: string): Promise<UserEntity> {
        const existingUser = await this.userRepository.findByKakaoId(kakaoId);
        if (existingUser) {
            return existingUser;
        }

        const user = UserEntity.create(kakaoId, name, profileImage, email);
        return this.userRepository.create(user);
    }
}