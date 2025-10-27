import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

interface JwtPayload {
    userId: string;
    kakaoId: string;
    name: string;
    profileImageUrl: string;
    role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor() {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_SECRET,
        });
    }

    async validate(payload: JwtPayload) {
        return {
            userId: payload.userId,
            kakaoId: payload.kakaoId,
            name: payload.name,
            profileImageUrl: payload.profileImageUrl,
            role: payload.role,
        };
    }
}