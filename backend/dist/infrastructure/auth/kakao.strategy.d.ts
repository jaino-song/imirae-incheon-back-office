import { Strategy } from "passport-kakao";
import { KakaoData } from "../../application/services/auth.service";
interface KakaoProfile {
    id: string;
    username: string;
    email: string;
    profileImage: string;
    _json: {
        kakao_account: {
            email: string;
        };
        properties: {
            profile_image: string;
        };
    };
}
declare const KakaoStrategy_base: new (...args: any[]) => Strategy;
export declare class KakaoStrategy extends KakaoStrategy_base {
    constructor();
    validate(accessToken: string, refreshToken: string, profile: KakaoProfile): Promise<KakaoData>;
}
export {};
