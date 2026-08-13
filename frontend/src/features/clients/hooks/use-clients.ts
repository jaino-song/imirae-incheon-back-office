'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messageTriggerKeys } from '@/features/message-triggers/hooks/keys';
import { serviceRecordKeys } from '@/features/service-records/hooks/keys';
import {
  removeById,
  restoreQueries,
  snapshotAndTransformQueries,
  type QuerySnapshot,
} from '@/lib/query/optimistic-list-cache';

import { clientsApi } from '../api/clients.api';
import { clientKeys } from './keys';
import type {
  Client,
  CreateClientDto,
  UpdateClientDto,
  TerminateServiceDto,
  RequestReplacementDto,
  PaginatedResponse
} from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isClientRecord = (value: unknown): value is Client =>
  isRecord(value) && typeof value.id === 'number';

const isPaginatedClientResponse = (value: unknown): value is PaginatedResponse<Client> =>
  isRecord(value) && Array.isArray(value.data);

const mergeUpdatedClient = (client: Client, updatedClient: Client): Client =>
  client.id === updatedClient.id ? { ...client, ...updatedClient } : client;

const mergeUpdatedClientList = (clients: Client[], updatedClient: Client): Client[] =>
  clients.map((client) => mergeUpdatedClient(client, updatedClient));

const updateClientCacheData = (currentData: unknown, updatedClient: Client): unknown => {
  if (!currentData) return currentData;

  if (Array.isArray(currentData)) {
    return mergeUpdatedClientList(currentData, updatedClient);
  }

  if (isPaginatedClientResponse(currentData)) {
    return {
      ...currentData,
      data: mergeUpdatedClientList(currentData.data, updatedClient),
    };
  }

  if (isClientRecord(currentData)) {
    return mergeUpdatedClient(currentData, updatedClient);
  }

  return currentData;
};

interface ScheduleChangeMutationVariables {
  requestId: string;
  clientId: number;
}

interface RejectScheduleChangeMutationVariables extends ScheduleChangeMutationVariables {
  reason?: string;
}

/**
 * Fetch paginated clients list
 */
export function useClients(page: number = 1, limit: number = 10, search?: string) {
  return useQuery<PaginatedResponse<Client>>({
    queryKey: clientKeys.list({ page, limit, search }),
    queryFn: () => clientsApi.list({ page, limit, search }).then(r => r.data),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Fetch all clients (non-paginated, for dropdowns)
 */
export function useAllClients() {
  return useQuery<Client[]>({
    queryKey: clientKeys.all,
    queryFn: () => clientsApi.listAll().then(r => r.data),
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Fetch single client by ID
 */
export function useClient(id: number) {
  return useQuery<Client>({
    queryKey: clientKeys.detail(id),
    queryFn: () => clientsApi.getById(id).then(r => r.data),
    enabled: !!id,
  });
}

/**
 * Create new client mutation
 */
export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateClientDto) => clientsApi.create(dto).then(r => r.data),
    onSuccess: async () => {
      // Invalidate all client queries to refresh lists
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Update existing client mutation
 */
export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: UpdateClientDto }) =>
      clientsApi.update(id, dto).then(r => r.data),
    onSuccess: async (updatedClient, { id }) => {
      queryClient.setQueriesData(
        { queryKey: clientKeys.all },
        (currentData) => updateClientCacheData(currentData, updatedClient)
      );
      queryClient.setQueryData(clientKeys.detail(id), updatedClient);

      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
      await queryClient.invalidateQueries({ queryKey: serviceRecordKeys.clientOverview(id) });
    },
  });
}

/**
 * Delete client mutation
 */
// Removes a client from a cached list, adjusting the count only when the client
// was actually present. Detail records and unknown shapes pass through unchanged.
const removeClientFromCacheData = (currentData: unknown, id: number): unknown => {
  if (!currentData) return currentData;

  if (Array.isArray(currentData)) {
    return removeById(currentData as Client[], id);
  }

  if (isPaginatedClientResponse(currentData)) {
    const data = removeById(currentData.data, id);
    if (data === currentData.data) return currentData;

    const total = Math.max(0, currentData.total - 1);
    return {
      ...currentData,
      data,
      total,
      totalPages:
        currentData.limit > 0 ? Math.ceil(total / currentData.limit) : currentData.totalPages,
    };
  }

  return currentData;
};

export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, number, { previous: QuerySnapshot }>({
    mutationFn: (id: number) => clientsApi.delete(id),
    onMutate: async (id) => {
      // Scoped to list representations so detail caches are left untouched.
      const previous = await snapshotAndTransformQueries(
        queryClient,
        {
          queryKey: clientKeys.all,
          predicate: (query) => query.queryKey[1] !== 'detail',
        },
        (current) => removeClientFromCacheData(current, id),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) restoreQueries(queryClient, context.previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Terminate service mutation
 * Sets serviceStatus to 'terminated'
 */
export function useTerminateService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto?: TerminateServiceDto }) =>
      clientsApi.terminateService(id, dto).then(r => r.data),
    onSuccess: async (_, { id }) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Request replacement mutation
 * Sets serviceStatus to 'replacement_requested'
 */
export function useRequestReplacement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: RequestReplacementDto }) =>
      clientsApi.requestReplacement(id, dto).then(r => r.data),
    onSuccess: async (_, { id }) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Complete replacement mutation
 * Resets serviceStatus to computed value based on dates
 */
export function useCompleteReplacement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      clientsApi.completeReplacement(id).then(r => r.data),
    onSuccess: async (_, id) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Approve a pending schedule change request
 */
export function useApproveScheduleChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId }: ScheduleChangeMutationVariables) =>
      clientsApi.approveScheduleChange(requestId).then(r => r.data),
    onSuccess: async (_, { clientId }) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Reject a pending schedule change request
 */
export function useRejectScheduleChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId, reason }: RejectScheduleChangeMutationVariables) =>
      clientsApi.rejectScheduleChange(requestId, reason).then(r => r.data),
    onSuccess: async (_, { clientId }) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
    },
  });
}
