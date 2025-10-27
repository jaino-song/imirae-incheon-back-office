import { Strategy } from "passport-jwt";
interface JwtPayload {
    userId: string;
    kakaoId: string;
    name: string;
    profileImageUrl: string;
    role: string;
}
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    constructor();
    validate(payload: JwtPayload): Promise<{
        userId: string;
        kakaoId: string;
        name: string;
        profileImageUrl: string;
        role: string;
    }>;
}
export {};
