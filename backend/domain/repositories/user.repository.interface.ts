import { UserEntity } from "../entities/user.entity";

export interface IUserRepository {
    findById(id: string): Promise<UserEntity | null>;
    findByKakaoId(kakaoId: string): Promise<UserEntity | null>;
    create(user: UserEntity): Promise<UserEntity>;
    update(user: UserEntity): Promise<UserEntity>;
    delete(id: string): Promise<void>;
}

export const USER_REPOSITORY = 'USER_REPOSITORY';