"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { serviceRecordsApi } from "../api/service-records.api";
import type { ServiceRecordOverview } from "../types";
import { serviceRecordKeys } from "./keys";

export function useClientServiceRecords(
    clientId: number | null,
    options?: { enabled?: boolean },
) {
    return useQuery<ServiceRecordOverview>({
        queryKey: serviceRecordKeys.clientOverview(clientId),
        queryFn: () => {
            if (clientId === null) {
                throw new Error("clientId is required");
            }
            return serviceRecordsApi.getClientOverview(clientId).then((response) => response.data);
        },
        enabled: clientId !== null && (options?.enabled ?? true),
    });
}

export function useSendServiceRecordLink() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ scheduleId, preparedLinkToken }: { scheduleId: number; clientId?: number; preparedLinkToken?: string }) =>
            serviceRecordsApi.sendLink(scheduleId, preparedLinkToken ? { preparedLinkToken } : {})
                .then((response) => response.data),
        onSuccess: (_, variables) => {
            if (variables.clientId !== undefined) {
                queryClient.invalidateQueries({
                    queryKey: serviceRecordKeys.clientOverview(variables.clientId),
                });
                return;
            }

            queryClient.invalidateQueries({ queryKey: serviceRecordKeys.all });
        },
    });
}

export function useCreateServiceRecordHeaderEditLink() {
    return useMutation({
        mutationFn: ({ scheduleId }: { scheduleId: number }) =>
            serviceRecordsApi.createHeaderEditLink(scheduleId)
                .then((response) => response.data),
    });
}
