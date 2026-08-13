"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
    consultationInquiriesApi,
    ConsultationInquiryListParams,
    ConsultationInquiryListResponse,
} from "@/services/api";

export const consultationInquiryQueryKeys = {
    all: ["consultation-inquiries"] as const,
    list: (params: ConsultationInquiryListParams) =>
        [...consultationInquiryQueryKeys.all, "list", params] as const,
    allPages: (params: ConsultationInquiryListParams) =>
        [...consultationInquiryQueryKeys.all, "all-pages", params] as const,
};

const CONSULTATION_INQUIRY_SEARCH_PAGE_SIZE = 100;

export async function fetchAllConsultationInquiries(
    params: ConsultationInquiryListParams,
): Promise<ConsultationInquiryListResponse> {
    const firstPage = await consultationInquiriesApi.list({
        ...params,
        page: 1,
        limit: CONSULTATION_INQUIRY_SEARCH_PAGE_SIZE,
    });
    const data = [...firstPage.data];

    for (let page = 2; page <= firstPage.totalPages; page += 1) {
        const nextPage = await consultationInquiriesApi.list({
            ...params,
            page,
            limit: CONSULTATION_INQUIRY_SEARCH_PAGE_SIZE,
        });
        data.push(...nextPage.data);
    }

    return { ...firstPage, data };
}

export function useConsultationInquiries(params: ConsultationInquiryListParams, enabled = true) {
    return useQuery<ConsultationInquiryListResponse>({
        queryKey: consultationInquiryQueryKeys.list(params),
        queryFn: () => consultationInquiriesApi.list(params),
        enabled,
        staleTime: 1000 * 60,
    });
}

export function useAllConsultationInquiries(
    params: ConsultationInquiryListParams,
    enabled = true,
) {
    return useQuery<ConsultationInquiryListResponse>({
        queryKey: consultationInquiryQueryKeys.allPages(params),
        queryFn: () => fetchAllConsultationInquiries(params),
        enabled,
        staleTime: 1000 * 60,
    });
}

export function useMarkConsultationInquiryRead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => consultationInquiriesApi.markRead(id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: consultationInquiryQueryKeys.all });
        },
    });
}
