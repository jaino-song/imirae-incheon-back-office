import { EformsignService } from "../../application/services/eformsign.service";
import { ContractDataDto } from "../../application/dto/contract.dto";
export declare class EformsignController {
    private readonly eformsignService;
    constructor(eformsignService: EformsignService);
    generateSignature(body: {
        executionTime: number;
    }): Promise<{
        signature: string;
    }>;
    getAccessToken(body: {
        executionTime: number;
        memberEmail?: string;
    }): Promise<import("../../application/services/eformsign.service").EformsignTokenResponse>;
    refreshAccessToken(body: {
        executionTime: number;
        refreshToken: string;
    }): Promise<import("../../application/services/eformsign.service").EformsignTokenResponse>;
    generateDocument(body: {
        contractData: ContractDataDto;
        accessToken: string;
        refreshToken: string;
    }): Promise<{
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
    }>;
}
