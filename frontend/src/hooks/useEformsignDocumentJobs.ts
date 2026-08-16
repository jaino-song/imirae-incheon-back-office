"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
    eformsignApi,
    type CreateEformsignDocumentJobRequest,
    type EformsignDocumentJobList,
    type EformsignDocumentJobSummary,
    type EnqueueEformsignDocumentJobResponse,
    type FinalizeEformsignDocumentJobRequest,
} from "@/services/api";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";

export type {
    CreateEformsignDocumentJobRequest,
    EformsignDocumentJobList,
    EformsignDocumentJobResponse,
    EformsignDocumentJobStatus,
    EformsignDocumentJobSummary,
    EnqueueEformsignDocumentJobResponse,
    FinalizeEformsignDocumentJobRequest,
} from "@/services/api";

const JOB_SUMMARY_REFETCH_INTERVAL_MS = 10_000;
const JOB_LIST_REFETCH_INTERVAL_MS = 3_000;

export const eformsignDocumentJobsQueryKeys = {
    all: ["eformsign-document-jobs"] as const,
    summary: () => [...eformsignDocumentJobsQueryKeys.all, "summary"] as const,
    list: () => [...eformsignDocumentJobsQueryKeys.all, "list"] as const,
};

// Singular alias keeps the factory discoverable alongside other eformsign keys.
export const eformsignDocumentJobQueryKeys = eformsignDocumentJobsQueryKeys;

export function useEformsignDocumentJobsSummary(isAuthenticated = true) {
    return useQuery<EformsignDocumentJobSummary>({
        queryKey: eformsignDocumentJobsQueryKeys.summary(),
        queryFn: () => eformsignApi.getDocumentJobSummary(),
        enabled: isAuthenticated,
        refetchInterval: JOB_SUMMARY_REFETCH_INTERVAL_MS,
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: false,
    });
}

export interface UseEformsignDocumentJobsOptions {
    isAuthenticated?: boolean;
    isPopoverOpen?: boolean;
}

export function useEformsignDocumentJobs({
    isAuthenticated = true,
    isPopoverOpen = false,
}: UseEformsignDocumentJobsOptions = {}) {
    const summaryQuery = useEformsignDocumentJobsSummary(isAuthenticated);
    const hasActiveJobs = (summaryQuery.data?.activeCount ?? 0) > 0;
    const shouldFetchList = isAuthenticated && (isPopoverOpen || hasActiveJobs);

    const listQuery = useQuery<EformsignDocumentJobList>({
        queryKey: eformsignDocumentJobsQueryKeys.list(),
        queryFn: () => eformsignApi.getDocumentJobs(),
        enabled: shouldFetchList,
        refetchInterval: shouldFetchList ? JOB_LIST_REFETCH_INTERVAL_MS : false,
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: false,
    });

    return {
        ...listQuery,
        summary: summaryQuery.data,
        summaryQuery,
    };
}

async function invalidateDocumentJobQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    documentId?: string,
    clientId?: number,
): Promise<void> {
    const invalidations = [
        queryClient.invalidateQueries({ queryKey: eformsignDocumentJobsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() }),
    ];

    if (documentId) {
        invalidations.push(
            queryClient.invalidateQueries({
                queryKey: ["eformsign-documents", "detail", documentId],
            }),
        );
    }

    if (clientId !== undefined) {
        invalidations.push(
            queryClient.invalidateQueries({
                queryKey: ["eformsign-docs", "client", clientId],
            }),
        );
    }

    await Promise.all(invalidations);
}

export function useEnqueueEformsignDocumentCreation() {
    const queryClient = useQueryClient();

    return useMutation<
        EnqueueEformsignDocumentJobResponse,
        Error,
        CreateEformsignDocumentJobRequest
    >({
        mutationFn: (params) => eformsignApi.enqueueDocumentCreation(params),
        onSuccess: async (_response, params) => {
            await invalidateDocumentJobQueries(queryClient, undefined, params.clientId);
        },
    });
}

export function useEnqueueEformsignDocumentFinalization() {
    const queryClient = useQueryClient();

    return useMutation<
        EnqueueEformsignDocumentJobResponse,
        Error,
        FinalizeEformsignDocumentJobRequest
    >({
        mutationFn: (params) => eformsignApi.enqueueDocumentFinalization(params),
        onSuccess: async (_response, params) => {
            await invalidateDocumentJobQueries(queryClient, params.documentId);
        },
    });
}
