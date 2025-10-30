import { Inject, Injectable } from "@nestjs/common";
import { IUserRepository, USER_REPOSITORY } from "domain/repositories/user.repository.interface";

@Injectable()
export class DeleteUserUsecase {
    constructor(
        @Inject(USER_REPOSITORY)
        private readonly userRepository: IUserRepository,
    ) {}

    async execute(id: string): Promise<void> {
        await this.userRepository.delete(id);
    }
}

