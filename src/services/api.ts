import { api } from "@/src/lib/axios";
import type { ContractDataDto } from '@/backend/application/dto/contract.dto';

// Auth API
export const authApi = {
    kakaoLogin: () => {
        window.location.href = "http://localhost:3001/auth/kakao";
    },
};

// eformsign APIs
export const eformsignApi = {
    generateSignature: async (executionTime: number) => {
        const { data } = await api.post('api/generate-signature', { executionTime });
        return data;
    },
    getAccessToken: async (executionTime: number, memberEmail?: string) => {
        const { data } = await api.post('api/access-token', { executionTime, memberEmail });
        return data;
    },
    refreshAccessToken: async (executionTime: number, refreshToken: string) => {
        const { data } = await api.post('api/refresh-access-token', { executionTime, refreshToken });
        return data;
    },
    generateDocument: async (contractData: ContractDataDto, accessToken: string, refreshToken: string) => {
        const { data } = await api.post('api/generate-document', { contractData, accessToken, refreshToken });
        return data;
    },
}