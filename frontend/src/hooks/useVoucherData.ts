"use client";

import { useQuery } from "@tanstack/react-query";
import type { OutOfPocketPriceInfo } from "@babyjamjam/shared";
import { api } from "@/lib/api/client";

// Types
export interface BankAccountInfo {
  area: string;
  bankName: string;
  accNum: string;
}

export interface VoucherPriceInfo {
  id: number;
  type: string | null;
  duration: string;
  fullPrice: string | null;
  grant: string | null;
  actualPrice: string | null;
}

export interface AreaTemplate {
  id: string;
  areaId: string;
  templateId: string;
  templateName: string | null;
}

export interface AvailableClientArea {
  id: string;
  name: string;
  koreanName: string;
}

// Query keys - centralized for consistency
export const voucherQueryKeys = {
  bankAccountInfos: ["bank-account-infos"] as const,
  voucherPriceInfos: (type: string, year?: number) => ["voucher-price-infos", type, year] as const,
  allVoucherPriceInfos: (year: number) => ["all-voucher-price-infos", year] as const,
  voucherYears: ["voucher-years"] as const,
  outOfPocketPriceInfos: ["out-of-pocket-price-infos"] as const,
  areaTemplates: ["area-templates"] as const,
  availableClientAreas: ["area-templates", "available-areas"] as const,
};

// Hooks
export function useBankAccountInfos() {
  return useQuery<BankAccountInfo[]>({
    queryKey: voucherQueryKeys.bankAccountInfos,
    queryFn: async () => {
      const { data } = await api.get("/bank-account-infos");
      return data as BankAccountInfo[];
    },
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

export function useVoucherPriceInfos(type: string, year?: number) {
  return useQuery<VoucherPriceInfo[]>({
    queryKey: voucherQueryKeys.voucherPriceInfos(type, year),
    queryFn: async () => {
      const { data } = await api.get("/voucher-price-infos/type", {
        params: { type, year },
      });
      return data as VoucherPriceInfo[];
    },
    enabled: !!type,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

export function useAllVoucherPriceInfos(year: number) {
  return useQuery<VoucherPriceInfo[]>({
    queryKey: voucherQueryKeys.allVoucherPriceInfos(year),
    queryFn: async () => {
      const { data } = await api.get("/voucher-price-infos/type", {
        params: { year },
      });
      return data as VoucherPriceInfo[];
    },
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

export function useVoucherYears() {
  return useQuery<number[]>({
    queryKey: voucherQueryKeys.voucherYears,
    queryFn: async () => {
      const { data } = await api.get("/voucher-price-infos/years");
      return data as number[];
    },
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

export function useOutOfPocketPriceInfos() {
  return useQuery<OutOfPocketPriceInfo[]>({
    queryKey: voucherQueryKeys.outOfPocketPriceInfos,
    queryFn: async () => {
      const { data } = await api.get("/out-of-pocket-price-infos");
      return data as OutOfPocketPriceInfo[];
    },
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24,
  });
}

export function useAreaTemplates() {
  return useQuery<AreaTemplate[]>({
    queryKey: voucherQueryKeys.areaTemplates,
    queryFn: async () => {
      const { data } = await api.get("/area-templates");
      return data as AreaTemplate[];
    },
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

export function useAvailableClientAreas() {
  return useQuery<AvailableClientArea[]>({
    queryKey: voucherQueryKeys.availableClientAreas,
    queryFn: async () => {
      const { data } = await api.get("/area-templates/available-areas");
      return data as AvailableClientArea[];
    },
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}
