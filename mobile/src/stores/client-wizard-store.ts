import { create } from "zustand";
import type { ServiceStatus } from "@/lib/client/types";

interface ClientWizardFormData {
  name: string;
  birthday: string;
  dueDate: string;
  /** Actual delivery date, set once the baby has arrived. */
  birthDate: string;
  address: string;
  phone: string;
  primaryEmployeeId: number | null;
  secondaryEmployeeId: number | null;
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
  areaId: string;
}

interface ClientWizardStore extends ClientWizardFormData {
  currentStep: number;
  pricesManuallyEdited: boolean;

  setField: <K extends keyof ClientWizardFormData>(key: K, value: ClientWizardFormData[K]) => void;
  setCurrentStep: (step: number) => void;
  setPricesManuallyEdited: (edited: boolean) => void;
  reset: () => void;
}

const INITIAL_FORM: ClientWizardFormData = {
  name: "",
  birthday: "",
  dueDate: "",
  birthDate: "",
  address: "",
  phone: "",
  primaryEmployeeId: null,
  secondaryEmployeeId: null,
  type: "",
  duration: null,
  fullPrice: "",
  grant: "",
  actualPrice: "",
  startDate: "",
  endDate: "",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking",
  areaId: "",
};

export const useClientWizardStore = create<ClientWizardStore>((set) => ({
  ...INITIAL_FORM,
  currentStep: 0,
  pricesManuallyEdited: false,

  setField: (key, value) => set({ [key]: value }),
  setCurrentStep: (step) => set({ currentStep: step }),
  setPricesManuallyEdited: (edited) => set({ pricesManuallyEdited: edited }),
  reset: () => set({ ...INITIAL_FORM, currentStep: 0, pricesManuallyEdited: false }),
}));
