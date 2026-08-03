import { create } from "zustand";

interface FormStore {
    // Client selection
    clientId: number | null;
    isManualEntry: boolean;
    name: string;
    phone: string;
    birthday: string;
    dueDate: string;
    birthDate: string;
    address: string;
    // Employee 1 selection
    employeeId: number | null;
    isEmployeeManualEntry: boolean;
    employeeName: string;
    employeePhone: string;
    // Employee 2 selection
    showEmployee2: boolean;
    employee2Id: number | null;
    isEmployee2ManualEntry: boolean;
    employee2Name: string;
    employee2Phone: string;
    // Contract details
    startDate: string;
    endDate: string;
    fullPrice: string;
    grant: string;
    actualPrice: string;
    paymentDate: string;
    voucherType: string;
    voucherDuration: string;
    voucherYear: number;
    area: string;
    // Client selection setters
    setClientId: (clientId: number | null) => void;
    setIsManualEntry: (isManualEntry: boolean) => void;
    setName: (name: string) => void;
    setPhone: (phone: string) => void;
    setBirthday: (birthday: string) => void;
    setDueDate: (dueDate: string) => void;
    setBirthDate: (birthDate: string) => void;
    setAddress: (address: string) => void;
    resetClientFields: () => void;
    // Employee 1 selection setters
    setEmployeeId: (employeeId: number | null) => void;
    setIsEmployeeManualEntry: (isEmployeeManualEntry: boolean) => void;
    setEmployeeName: (employeeName: string) => void;
    setEmployeePhone: (employeePhone: string) => void;
    setEmployeeSelection: (employeeId: number | null, employeeName: string, employeePhone: string) => void;
    resetEmployeeFields: () => void;
    // Employee 2 selection setters
    setShowEmployee2: (showEmployee2: boolean) => void;
    setEmployee2Id: (employee2Id: number | null) => void;
    setIsEmployee2ManualEntry: (isEmployee2ManualEntry: boolean) => void;
    setEmployee2Name: (employee2Name: string) => void;
    setEmployee2Phone: (employee2Phone: string) => void;
    setEmployee2Selection: (employee2Id: number | null, employee2Name: string, employee2Phone: string) => void;
    resetEmployee2Fields: () => void;
    // Contract details setters
    setStartDate: (startDate: string) => void;
    setEndDate: (endDate: string) => void;
    setFullPrice: (fullPrice: string) => void;
    setGrant: (grant: string) => void;
    setActualPrice: (actualPrice: string) => void;
    setPaymentDate: (paymentDate: string) => void;
    setVoucherType: (voucherType: string) => void;
    setVoucherDuration: (voucherDuration: string) => void;
    setVoucherYear: (voucherYear: number) => void;
    setArea: (area: string) => void;
    // Reset all fields to initial state (for cancel/successful submission)
    resetAll: () => void;
}

// 현재 연도를 기본값으로 사용
const currentYear = new Date().getFullYear();

const INITIAL_STATE = {
    clientId: null,
    isManualEntry: false,
    name: "",
    phone: "",
    birthday: "",
    dueDate: "",
    birthDate: "",
    address: "",
    employeeId: null,
    isEmployeeManualEntry: false,
    employeeName: "",
    employeePhone: "",
    showEmployee2: false,
    employee2Id: null,
    isEmployee2ManualEntry: false,
    employee2Name: "",
    employee2Phone: "",
    startDate: "",
    endDate: "",
    fullPrice: "",
    grant: "",
    actualPrice: "",
    paymentDate: "",
    voucherType: "",
    voucherDuration: "",
    voucherYear: currentYear,
    area: "",
};

export const useFormStore = create<FormStore>((set) => {
    return {
        ...INITIAL_STATE,
        // Client selection setters
        setClientId: (clientId: number | null) => set({ clientId }),
        setIsManualEntry: (isManualEntry: boolean) => set({ isManualEntry }),
        setName: (name: string) => set({ name }),
        setPhone: (phone: string) => set({ phone }),
        setBirthday: (birthday: string) => set({ birthday }),
        setDueDate: (dueDate: string) => set({ dueDate }),
        setBirthDate: (birthDate: string) => set({ birthDate }),
        setAddress: (address: string) => set({ address }),
        resetClientFields: () => set({
            clientId: null,
            isManualEntry: false,
            name: "",
            phone: "",
            birthday: "",
            dueDate: "",
            birthDate: "",
            address: "",
        }),
        // Employee 1 selection setters
        setEmployeeId: (employeeId: number | null) => set({ employeeId }),
        setIsEmployeeManualEntry: (isEmployeeManualEntry: boolean) => set({ isEmployeeManualEntry }),
        setEmployeeName: (employeeName: string) => set({ employeeName }),
        setEmployeePhone: (employeePhone: string) => set({ employeePhone }),
        // Batch update to prevent intermediate render states
        setEmployeeSelection: (employeeId: number | null, employeeName: string, employeePhone: string) => set({
            employeeId,
            employeeName,
            employeePhone,
        }),
        resetEmployeeFields: () => set({
            employeeId: null,
            isEmployeeManualEntry: false,
            employeeName: "",
            employeePhone: "",
        }),
        // Employee 2 selection setters
        setShowEmployee2: (showEmployee2: boolean) => set({ showEmployee2 }),
        setEmployee2Id: (employee2Id: number | null) => set({ employee2Id }),
        setIsEmployee2ManualEntry: (isEmployee2ManualEntry: boolean) => set({ isEmployee2ManualEntry }),
        setEmployee2Name: (employee2Name: string) => set({ employee2Name }),
        setEmployee2Phone: (employee2Phone: string) => set({ employee2Phone }),
        // Batch update to prevent intermediate render states
        setEmployee2Selection: (employee2Id: number | null, employee2Name: string, employee2Phone: string) => set({
            employee2Id,
            employee2Name,
            employee2Phone,
        }),
        resetEmployee2Fields: () => set({
            showEmployee2: false,
            employee2Id: null,
            isEmployee2ManualEntry: false,
            employee2Name: "",
            employee2Phone: "",
        }),
        // Contract details setters
        setStartDate: (startDate: string) => set({ startDate }),
        setEndDate: (endDate: string) => set({ endDate }),
        setFullPrice: (fullPrice: string) => set({ fullPrice }),
        setGrant: (grant: string) => set({ grant }),
        setActualPrice: (actualPrice: string) => set({ actualPrice }),
        setPaymentDate: (paymentDate: string) => set({ paymentDate }),
        setVoucherType: (voucherType: string) => set({ voucherType }),
        setVoucherDuration: (voucherDuration: string) => set({ voucherDuration }),
        setVoucherYear: (voucherYear: number) => set({ voucherYear }),
        setArea: (area: string) => set({ area }),
        resetAll: () => set(INITIAL_STATE),
    }
})
