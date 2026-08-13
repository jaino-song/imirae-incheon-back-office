'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi } from '../api/employees.api';
import { employeeKeys } from './keys';
import type { Employee, CreateEmployeeDto, UpdateEmployeeDto } from '../types';

// Fetch all employees
export function useEmployees() {
    return useQuery<Employee[]>({
        queryKey: employeeKeys.lists(),
        queryFn: () => employeesApi.list().then(r => r.data),
        staleTime: 1000 * 60 * 10, // 10 minutes
    });
}

// Fetch single employee
export function useEmployee(id: number) {
    return useQuery<Employee>({
        queryKey: employeeKeys.detail(id),
        queryFn: () => employeesApi.getById(id).then(r => r.data),
        enabled: !!id,
    });
}

// Create employee
export function useCreateEmployee() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: CreateEmployeeDto) =>
            employeesApi.create(dto).then(r => r.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: employeeKeys.all });
        },
    });
}

// Update employee
export function useUpdateEmployee() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: number; dto: UpdateEmployeeDto }) =>
            employeesApi.update(id, dto).then(r => r.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: employeeKeys.all });
        },
    });
}

// Delete employee
export function useDeleteEmployee() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: number) => employeesApi.delete(id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: employeeKeys.all });
        },
    });
}

// Toggle open status
export function useToggleEmployeeOpenStatus() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, openToNextWork }: { id: number; openToNextWork: boolean }) =>
            employeesApi.toggleOpenStatus(id, openToNextWork).then(r => r.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: employeeKeys.all });
        },
    });
}
