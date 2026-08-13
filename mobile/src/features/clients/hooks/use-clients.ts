'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

function isValidClientId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
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
    enabled: isValidClientId(id),
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
    onSuccess: async (_, { id }) => {
      // Invalidate all client queries
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      // Also invalidate the specific detail query
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
    },
  });
}

/**
 * Delete client mutation
 */
export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => clientsApi.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
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
    },
  });
}
