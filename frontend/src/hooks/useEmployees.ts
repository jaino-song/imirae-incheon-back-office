"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import {
    removeById,
    restoreQueries,
    snapshotAndTransformQueries,
    type QuerySnapshot,
} from "@/lib/query/optimistic-list-cache";

// Employee status type
export type EmployeeStatus = 'available' | 'working' | 'unavailable';

// Employee type
export interface Employee {
    id: number;
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    registeredDate: string | null;
    status: EmployeeStatus;
    birthday?: string;
}

export interface CreateEmployeeDto {
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    birthday?: string;
}

export interface UpdateEmployeeDto {
    name?: string;
    workArea?: string[];
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
    birthday?: string;
}

// Query key factory pattern
export const employeeQueryKeys = {
    all: ["employees"] as const,
    lists: () => [...employeeQueryKeys.all, "list"] as const,
    list: (filters: Record<string, unknown>) => [...employeeQueryKeys.lists(), filters] as const,
    details: () => [...employeeQueryKeys.all, "detail"] as const,
    detail: (id: number) => [...employeeQueryKeys.details(), id] as const,
};

// Fetch all employees
export function useEmployees() {
    return useQuery<Employee[]>({
        queryKey: employeeQueryKeys.lists(),
        queryFn: async () => {
            const { data } = await api.get("/employees");
            return data;
        },
        staleTime: 1000 * 60 * 10, // 10 minutes
    });
}

// Create employee
export function useCreateEmployee() {
    const queryClient = useQueryClient();

    return useMutation<Employee, Error, CreateEmployeeDto>({
        mutationFn: async (dto: CreateEmployeeDto) => {
            const { data } = await api.post<Employee>("/employees", dto);
            return data;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
        onError: (error) => {
            console.error("[useCreateEmployee] onError called:", error);
        },
    });
}

// Update employee
export function useUpdateEmployee() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, dto }: { id: number; dto: UpdateEmployeeDto }) => {
            const { data } = await api.patch("/employees", dto, { params: { id } });
            return data;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
    });
}

// Removes an employee from a cached list. Non-list shapes pass through unchanged.
function removeEmployeeFromCacheData(current: unknown, id: number): unknown {
    if (!Array.isArray(current)) return current;
    return removeById(current as Employee[], id);
}

// Delete employee
export function useDeleteEmployee() {
    const queryClient = useQueryClient();

    return useMutation<void, Error, number, { previous: QuerySnapshot }>({
        mutationFn: async (id: number) => {
            await api.delete("/employees", { params: { id } });
        },
        onMutate: async (id) => {
            // Scope to list keys so detail caches are never optimistically edited.
            const previous = await snapshotAndTransformQueries(
                queryClient,
                { queryKey: employeeQueryKeys.lists() },
                (current) => removeEmployeeFromCacheData(current, id),
            );
            return { previous };
        },
        onError: (_error, _id, context) => {
            if (context?.previous) restoreQueries(queryClient, context.previous);
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
    });
}

// Toggle open status
export function useToggleEmployeeOpenStatus() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, openToNextWork }: { id: number; openToNextWork: boolean }) => {
            const { data } = await api.patch("/employees/open-status", { openToNextWork }, { params: { id } });
            return data;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
    });
}
