"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

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
    registeredDate: string;
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

export interface EmployeeActiveClient {
    clientId: number;
    clientName: string;
    role: "primary" | "secondary";
    startDate: string;
    endDate: string;
    serviceStatus: string;
}

// Query key factory pattern
export const employeeQueryKeys = {
    all: ["employees"] as const,
    lists: () => [...employeeQueryKeys.all, "list"] as const,
    list: (filters: Record<string, unknown>) => [...employeeQueryKeys.lists(), filters] as const,
    details: () => [...employeeQueryKeys.all, "detail"] as const,
    detail: (id: number) => [...employeeQueryKeys.details(), id] as const,
    activeClients: (id: number) => [...employeeQueryKeys.detail(id), "active-clients"] as const,
};

// Fetch all employees
export function useEmployees() {
    return useQuery<Employee[]>({
        queryKey: employeeQueryKeys.lists(),
        queryFn: async () => {
            const { data } = await api.get("/employees");
            if (Array.isArray(data)) return data as Employee[];
            if (data && typeof data === "object") {
                if (Array.isArray((data as Record<string, unknown>).data)) return (data as Record<string, unknown>).data as Employee[];
                if (Array.isArray((data as Record<string, unknown>).items)) return (data as Record<string, unknown>).items as Employee[];
            }
            return [];
        },
        staleTime: 1000 * 60 * 10, // 10 minutes
    });
}

export function useEmployeeActiveClients(employeeId: number) {
    return useQuery<EmployeeActiveClient[]>({
        queryKey: employeeQueryKeys.activeClients(employeeId),
        queryFn: async () => {
            const { data } = await api.get<EmployeeActiveClient[]>(
                `/employees/${employeeId}/active-clients`,
            );
            return data;
        },
        enabled: employeeId > 0,
        staleTime: 1000 * 60 * 5,
    });
}

// Create employee
export function useCreateEmployee() {
    const queryClient = useQueryClient();

    return useMutation<Employee, Error, CreateEmployeeDto>({
        mutationFn: async (dto: CreateEmployeeDto) => {
            console.log("[useCreateEmployee] Creating employee with dto:", dto);
            const { data } = await api.post<Employee>("/employees", dto);
            console.log("[useCreateEmployee] Created employee response:", data);
            return data;
        },
        onSuccess: (data) => {
            console.log("[useCreateEmployee] onSuccess called with:", data);
            queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
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
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
    });
}

// Delete employee
export function useDeleteEmployee() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete("/employees", { params: { id } });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
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
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
    });
}
