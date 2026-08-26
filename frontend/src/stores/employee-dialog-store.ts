import { create } from "zustand";

interface EmployeeDialogStore {
    prefillName: string;
    setPrefillName: (name: string) => void;
    clearPrefillName: () => void;
    reset: () => void;
}

export const useEmployeeDialogStore = create<EmployeeDialogStore>((set) => ({
    prefillName: "",
    setPrefillName: (name) => set({ prefillName: name }),
    clearPrefillName: () => set({ prefillName: "" }),
    reset: () => set({ prefillName: "" }),
}));
