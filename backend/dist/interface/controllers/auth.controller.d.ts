import { AuthService } from "../../application/services/auth.service";
import { UserValidationResult } from "../../application/services/auth.service";
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    kakaoLogin(): Promise<void>;
    kakaoCallback(req: any): Promise<UserValidationResult>;
}
