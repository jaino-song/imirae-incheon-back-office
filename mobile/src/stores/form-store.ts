import { create } from "zustand";

import { todayIsoDate } from "@/lib/contracts/date-input";
import { formatKoreanPhoneNumber } from "@/lib/phone";

export interface ContractCreationPrefill {
    clientId?: number | null;
    name?: string;
    phone?: string;
    birthday?: string;
    dueDate?: string;
    address?: string;
    employeeId?: number | null;
    employeeName?: string;
    employeePhone?: string;
    startDate?: string;
    endDate?: string;
    fullPrice?: string;
    grant?: string;
    actualPrice?: string;
    paymentDate?: string;
    voucherType?: string;
    voucherDuration?: string;
    voucherYear?: number;
    area?: string;
}

interface FormStore {
    // Client selection
    clientId: number | null;
    isManualEntry: boolean;
    name: string;
    phone: string;
    birthday: string;
    dueDate: string;
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
    preservePrefilledPrices: boolean;
    // Client selection setters
    setClientId: (clientId: number | null) => void;
    setIsManualEntry: (isManualEntry: boolean) => void;
    setName: (name: string) => void;
    setPhone: (phone: string) => void;
    setBirthday: (birthday: string) => void;
    setDueDate: (dueDate: string) => void;
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
    setPreservePrefilledPrices: (preservePrefilledPrices: boolean) => void;
    prefillFromClient: (client: {
        id: number;
        name: string;
        phone?: string | null;
        birthday?: string | null;
        dueDate?: string | null;
        address?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        primaryEmployee?: { id: number; name: string } | null;
        secondaryEmployee?: { id: number; name: string } | null;
    }) => void;
    prefillFromContract: (prefill: ContractCreationPrefill) => void;
    resetAll: () => void;
}

// 현재 연도를 기본값으로 사용
const currentYear = new Date().getFullYear();

export const useFormStore = create<FormStore>((set) => {
    return {
        // Client selection
        clientId: null,
        isManualEntry: false,
        name: "",
        phone: "",
        birthday: "",
        dueDate: "",
        address: "",
        // Employee 1 selection
        employeeId: null,
        isEmployeeManualEntry: false,
        employeeName: "",
        employeePhone: "",
        // Employee 2 selection
        showEmployee2: false,
        employee2Id: null,
        isEmployee2ManualEntry: false,
        employee2Name: "",
        employee2Phone: "",
        // Contract details
        startDate: "",
        endDate: "",
        fullPrice: "",
        grant: "",
        actualPrice: "",
        paymentDate: todayIsoDate(),
        voucherType: "",
        voucherDuration: "",
        voucherYear: currentYear,
        area: "",
        preservePrefilledPrices: false,
        // Client selection setters
        setClientId: (clientId: number | null) => set({ clientId }),
        setIsManualEntry: (isManualEntry: boolean) => set({ isManualEntry }),
        setName: (name: string) => set({ name }),
        setPhone: (phone: string) => set({ phone: formatKoreanPhoneNumber(phone) }),
        setBirthday: (birthday: string) => set({ birthday }),
        setDueDate: (dueDate: string) => set({ dueDate }),
        setAddress: (address: string) => set({ address }),
        resetClientFields: () => set({
            clientId: null,
            isManualEntry: false,
            name: "",
            phone: "",
            birthday: "",
            dueDate: "",
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
        setPreservePrefilledPrices: (preservePrefilledPrices: boolean) => set({ preservePrefilledPrices }),
        prefillFromClient: (client) => set({
            clientId: client.id,
            isManualEntry: false,
            name: client.name,
            phone: formatKoreanPhoneNumber(client.phone),
            birthday: client.birthday || "",
            dueDate: client.dueDate || "",
            address: client.address || "",
            voucherType: client.type || "",
            voucherDuration: client.duration ? String(client.duration) : "",
            fullPrice: client.fullPrice || "",
            grant: client.grant || "",
            actualPrice: client.actualPrice || "",
            startDate: client.startDate || "",
            endDate: client.endDate || "",
            paymentDate: todayIsoDate(),
            employeeId: client.primaryEmployee?.id ?? null,
            employeeName: client.primaryEmployee?.name ?? "",
            employee2Id: client.secondaryEmployee?.id ?? null,
            employee2Name: client.secondaryEmployee?.name ?? "",
            preservePrefilledPrices: false,
        }),
        prefillFromContract: (prefill) => set({
            clientId: prefill.clientId ?? null,
            isManualEntry: prefill.clientId == null,
            name: prefill.name ?? "",
            phone: formatKoreanPhoneNumber(prefill.phone),
            birthday: prefill.birthday ?? "",
            dueDate: prefill.dueDate ?? "",
            address: prefill.address ?? "",
            employeeId: prefill.employeeId ?? null,
            isEmployeeManualEntry: prefill.employeeId == null,
            employeeName: prefill.employeeName ?? "",
            employeePhone: prefill.employeePhone ?? "",
            showEmployee2: false,
            employee2Id: null,
            isEmployee2ManualEntry: false,
            employee2Name: "",
            employee2Phone: "",
            startDate: prefill.startDate ?? "",
            endDate: prefill.endDate ?? "",
            fullPrice: prefill.fullPrice ?? "",
            grant: prefill.grant ?? "",
            actualPrice: prefill.actualPrice ?? "",
            paymentDate: prefill.paymentDate || todayIsoDate(),
            voucherType: prefill.voucherType ?? "",
            voucherDuration: prefill.voucherDuration ?? "",
            voucherYear: prefill.voucherYear ?? currentYear,
            area: "",
            preservePrefilledPrices: true,
        }),
        resetAll: () => set({
            clientId: null,
            isManualEntry: false,
            name: "",
            phone: "",
            birthday: "",
            dueDate: "",
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
            paymentDate: todayIsoDate(),
            voucherType: "",
            voucherDuration: "",
            voucherYear: currentYear,
            area: "",
            preservePrefilledPrices: false,
        }),
    }
})
