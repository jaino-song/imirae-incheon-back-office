"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type {
    ConsultationInquiry,
    ConsultationInquiryListParams,
    PaginatedConsultationInquiries,
} from "@/lib/consultation-inquiry/types";

export const consultationInquiryQueryKeys = {
    all: ["consultation-inquiries"] as const,
    lists: () => [...consultationInquiryQueryKeys.all, "list"] as const,
    list: (params: ConsultationInquiryListParams) =>
        [...consultationInquiryQueryKeys.lists(), params] as const,
};

export function useConsultationInquiries(params: ConsultationInquiryListParams = {}) {
    return useQuery<PaginatedConsultationInquiries>({
        queryKey: consultationInquiryQueryKeys.list(params),
        queryFn: async () => {
            const search = new URLSearchParams();
            if (params.page !== undefined) search.set("page", String(params.page));
            if (params.limit !== undefined) search.set("limit", String(params.limit));
            if (params.search) search.set("search", params.search);
            if (params.phone) search.set("phone", params.phone);
            if (params.status) search.set("status", params.status);
            if (params.readState) search.set("readState", params.readState);
            const qs = search.toString();
            const url = qs ? `/consultation-inquiries?${qs}` : "/consultation-inquiries";
            const { data } = await api.get<PaginatedConsultationInquiries>(url);
            return data;
        },
        staleTime: 1000 * 60,
    });
}

export function useMarkConsultationInquiryAsRead() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            const { data } = await api.patch<ConsultationInquiry>(
                `/consultation-inquiries/${id}/read`
            );
            return data;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: consultationInquiryQueryKeys.all });
        },
    });
}
