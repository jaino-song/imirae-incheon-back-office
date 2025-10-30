import { Inject, Injectable } from "@nestjs/common";
import { USER_REPOSITORY, IUserRepository } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";

@Injectable()
export class FindUserByKakaoIdUsecase {
    constructor(
        @Inject(USER_REPOSITORY)
        private readonly userRepository: IUserRepository,
    ) {}

    execute(kakaoId: string): Promise<UserEntity | null> {
        return this.userRepository.findByKakaoId(kakaoId);
    }
}

