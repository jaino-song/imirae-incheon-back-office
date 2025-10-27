import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { ContractDataDto } from "../dto/contract.dto";

export interface EformsignTokenResponse {
    oauth_token: {
        access_token: string;
        refresh_token: string;
    };
}

@Injectable()
export class EformsignService {
    private readonly USER_EMAIL: string;
    private readonly EFORMSIGN_API_URL: string;
    private readonly EFORMSIGN_API_KEY: string;
    private readonly EFORMSIGN_PRIVATE_KEY: string;
    private readonly EFORMSIGN_COMPANY_ID: string;
    private readonly EFORMSIGN_TEMPLATE_ID: string;

    constructor(private configService: ConfigService) {
        this.USER_EMAIL = this.configService.get("EFORMSIGN_USER_EMAIL");
        this.EFORMSIGN_API_URL = this.configService.get("EFORMSIGN_API_URL");
        this.EFORMSIGN_API_KEY = this.configService.get("EFORMSIGN_API_KEY");
        this.EFORMSIGN_PRIVATE_KEY = this.configService.get("EFORMSIGN_PRIVATE_KEY");
        this.EFORMSIGN_COMPANY_ID = this.configService.get("EFORMSIGN_COMPANY_ID");
        this.EFORMSIGN_TEMPLATE_ID = this.configService.get("EFORMSIGN_TEMPLATE_ID");
    }

    generateSignature(executionTime: number): string {
        const message = `${executionTime}.${this.EFORMSIGN_API_KEY}`;
        const signature = crypto
            .createHmac("sha256", this.EFORMSIGN_PRIVATE_KEY)
            .update(message)
            .digest("base64");
        return signature;
    }

    async getAccessToken(executionTime: number, memberEmail?: string): Promise<EformsignTokenResponse> {
        const signature = this.generateSignature(executionTime);
        const email = memberEmail || this.USER_EMAIL;

        const response = await fetch(`${this.EFORMSIGN_API_URL}/v2.0/api_auth/access_token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "eformsign_signature": signature,
                "Authorization": `Bearer ${this.EFORMSIGN_API_KEY}`,
            },
            body: JSON.stringify({
                execution_time: executionTime,
                member_id: email,
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get access token: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    async refreshAccessToken(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse> {
        const signature = this.generateSignature(executionTime);

        const response = await fetch(`${this.EFORMSIGN_API_URL}/v2.0/api_auth/refresh_token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "eformsign_signature": signature,
                "Authorization": `Bearer ${this.EFORMSIGN_API_KEY}`,
            },
            body: JSON.stringify({
                execution_time: executionTime,
                refresh_token: refreshToken,
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to refresh token: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    generateDocumentOptions(contractData: ContractDataDto, accessToken: string, refreshToken: string) {
        return {
            company: {
                id: this.EFORMSIGN_COMPANY_ID,
                country_code: "kr",
                user_key: this.USER_EMAIL,
            },
            user: {
                type: "01",
                id: this.USER_EMAIL,
                access_token: accessToken,
                refresh_token: refreshToken,
            },
            mode: {
                type: "01",
                template_id: this.EFORMSIGN_TEMPLATE_ID,
            },
            prefill: {
                document_name: "산모신생아건강관리서비스 계약서",
                fields: [
                    { id: "이용자 성명", value: contractData.customerName },
                    { id: "이용자 생년월일", value: contractData.customerDOB },
                    { id: "이용자 주소", value: contractData.customerAddress },
                    { id: "계약 시작 년도", value: contractData.startYear },
                    { id: "계약 시작 월", value: contractData.startMonth },
                    { id: "계약 시작 일", value: contractData.startDay },
                    { id: "계약 종료 년도", value: contractData.endYear },
                    { id: "계약 종료 월", value: contractData.endMonth },
                    { id: "계약 종료 일", value: contractData.endDay },
                    { id: "서비스 비용", value: contractData.fullPrice },
                    { id: "정부지원금", value: contractData.grant },
                    { id: "본인부담금", value: contractData.actualPrice },
                    { id: "서비스 기간", value: contractData.days },
                    { id: "제공인력 1 성명", value: contractData.caretaker1Name },
                    { id: "제공인력 1 연락처", value: contractData.caretaker1Contact },
                    { id: "서비스 가격", value: contractData.fullPrice },
                    { id: "본인부담금 수령 년도", value: contractData.paymentYear },
                    { id: "본인부담금 수령 월", value: contractData.paymentMonth },
                    { id: "본인부담금 수령 일", value: contractData.paymentDay },
                    { id: "영수증 년도", value: contractData.receiptYear },
                    { id: "영수증 월", value: contractData.receiptMonth },
                    { id: "영수증 일", value: contractData.receiptDay },
                    { id: "서비스 기간", value: contractData.contractDuration },
                ],
                recipients: [
                    {
                        step_idx: "2",
                        step_type: "05",
                        name: contractData.customerName,
                        id: "",
                        sms: contractData.customerContact,
                        use_sms: true,
                    },
                ],
            },
            return_fields: [contractData.customerName],
        };
    }
}

