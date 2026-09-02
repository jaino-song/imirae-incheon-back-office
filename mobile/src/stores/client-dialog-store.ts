import { create } from "zustand";

import type { ServiceStatus } from "@/lib/client/types";

export type ClientWizardPrefill = Partial<{
  name: string;
  birthday: string;
  dueDate: string;
  address: string;
  phone: string;
  type: string;
  duration: number | null;
  fullPrice: string;
  grant: string;
  actualPrice: string;
  startDate: string;
  endDate: string;
  careCenter: boolean;
  voucherClient: boolean;
  breastPump: boolean;
  serviceStatus: ServiceStatus;
  areaId: string | null;
}>;

interface ClientDialogStore {
  prefillName: string;
  prefillClient: ClientWizardPrefill | null;
  setPrefillName: (name: string) => void;
  setPrefillClient: (client: ClientWizardPrefill) => void;
  clearPrefillName: () => void;
  clearPrefillClient: () => void;
  reset: () => void;
}

export const useClientDialogStore = create<ClientDialogStore>((set) => ({
  prefillName: "",
  prefillClient: null,
  setPrefillName: (name) => set({ prefillName: name }),
  setPrefillClient: (client) => set({ prefillClient: client }),
  clearPrefillName: () => set({ prefillName: "" }),
  clearPrefillClient: () => set({ prefillClient: null }),
  reset: () => set({ prefillName: "", prefillClient: null }),
}));
