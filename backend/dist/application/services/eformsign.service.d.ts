import { ConfigService } from "@nestjs/config";
import { ContractDataDto } from "../dto/contract.dto";
export interface EformsignTokenResponse {
    oauth_token: {
        access_token: string;
        refresh_token: string;
    };
}
export declare class EformsignService {
    private configService;
    private readonly USER_EMAIL;
    private readonly EFORMSIGN_API_URL;
    private readonly EFORMSIGN_API_KEY;
    private readonly EFORMSIGN_PRIVATE_KEY;
    private readonly EFORMSIGN_COMPANY_ID;
    private readonly EFORMSIGN_TEMPLATE_ID;
    constructor(configService: ConfigService);
    generateSignature(executionTime: number): string;
    getAccessToken(executionTime: number, memberEmail?: string): Promise<EformsignTokenResponse>;
    refreshAccessToken(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse>;
    generateDocumentOptions(contractData: ContractDataDto, accessToken: string, refreshToken: string): {
        company: {
            id: string;
            country_code: string;
            user_key: string;
        };
        user: {
            type: string;
            id: string;
            access_token: string;
            refresh_token: string;
        };
        mode: {
            type: string;
            template_id: string;
        };
        prefill: {
            document_name: string;
            fields: {
                id: string;
                value: string;
            }[];
            recipients: {
                step_idx: string;
                step_type: string;
                name: string;
                id: string;
                sms: string;
                use_sms: boolean;
            }[];
        };
        return_fields: string[];
    };
}
