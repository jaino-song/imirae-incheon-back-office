import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { IUserRepository, USER_REPOSITORY } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";

export type UpdateUserParams = {
    name?: string | null;
    email?: string | null;
    profileImage?: string | null;
    role?: string | null;
};

@Injectable()
export class UpdateUserUsecase {
    constructor(
        @Inject(USER_REPOSITORY)
        private readonly userRepository: IUserRepository,
    ) {}

    async execute(id: string, updates: UpdateUserParams): Promise<UserEntity> {
        const user = await this.userRepository.findById(id);
        if (!user) {
            throw new NotFoundException(`User with id ${id} not found`);
        }

        if (updates.name !== undefined) {
            user.name = updates.name;
        }
        if (updates.email !== undefined) {
            user.email = updates.email;
        }
        if (updates.profileImage !== undefined) {
            user.profileImage = updates.profileImage;
        }
        if (updates.role !== undefined) {
            user.role = updates.role;
        }

        return this.userRepository.update(user);
    }
}

