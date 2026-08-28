import { IsOptional, IsString } from "class-validator";

export class LogoutDto {
    @IsString()
    @IsOptional()
    refreshToken?: string;

    /**
     * Browser PushSubscription endpoint for this logout. When supplied, only
     * this device's endpoint is removed; legacy callers without it fall back
     * to clearing all endpoints owned by the revoked user.
     */
    @IsString()
    @IsOptional()
    pushEndpoint?: string;
}
