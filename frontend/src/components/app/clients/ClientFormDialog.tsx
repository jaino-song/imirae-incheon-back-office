"use client";

import { Fragment, useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    findOutOfPocketPriceInfo,
    formatOutOfPocketDurationLabel,
} from "@babyjamjam/shared";
import { useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useClientPhoneDuplicateCheck } from "@/hooks/useClientPhoneDuplicateCheck";
import { useOutOfPocketPriceInfos, useVoucherPriceInfos, useVoucherYears } from "@/hooks/useVoucherData";
import { EmployeeAutocomplete } from "./EmployeeAutocomplete";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import {
    Client,
    CreateClientDto,
    UpdateClientDto,
    SERVICE_STATUS_OPTIONS
} from "@/lib/client/types";
import type { Employee } from "@/hooks/useEmployees";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/errors/prisma-error-mapper";
import { cn } from "@/lib/utils";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
import { formatIsoDateInput } from "@/lib/date/format-iso-input";
import voucherOptions from "../messages/templates/json/voucher.json";

import {
    Dialog,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import {
    FormField,
    FormGrid,
    FormHelperText,
    FormNativeSelect,
    FormSection,
    FormSwitchRow,
    FormTextInput,
} from "@/components/app/ui/form-section";
import { TogglePill } from "@/components/app/ui/toggle-pill";
import {
    SteppedWizardPanelContent,
} from "@/components/app/v3/SteppedWizardPanelLayout";
import {
    DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME,
    DETAIL_PANEL_FOOTER_CLASS_NAME,
    DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME,
} from "@/components/app/v3/DetailPanel";

export interface ClientFormDialogProps {
    /** Caller-context canonical data-component base for this form instance. */
    "data-component"?: string;
    open: boolean;
    onClose: () => void;
    client?: Client | null; // null/undefined for create mode, Client for edit mode
    onSuccess?: (client: Client) => void; // Optional callback when client is created/updated
}

export interface ClientFormPanelProps extends Omit<ClientFormDialogProps, "open"> {
    open?: boolean;
    activeStep?: number;
    onActiveStepChange?: (step: number) => void;
    renderLayout?: (parts: { content: ReactNode; footer: ReactNode }) => ReactNode;
}

type ClientFormData = Omit<CreateClientDto, "primaryEmployeeId"> & { primaryEmployeeId: number | null };

const PANEL_STEP_CONTENT_CLASS_NAME =
    "grid w-full grid-cols-1 gap-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] md:grid-cols-2";
const PANEL_FULL_FIELD_CLASS_NAME = "md:col-span-2";
export const CLIENT_FORM_STEPPER_STEPS = [
    { label: "이용자\n정보" },
    { label: "제공인력\n정보" },
    { label: "바우처\n정보" },
    { label: "계약\n정보" },
] as const;

const CLIENT_FORM_LAST_STEP_INDEX = CLIENT_FORM_STEPPER_STEPS.length - 1;

interface ClientDialogSectionProps {
    dataComponent: string;
    title: ReactNode;
    description: ReactNode;
    children: ReactNode;
}

function ClientDialogSection({ dataComponent, title, description, children }: ClientDialogSectionProps) {
    return (
        <FormSection
            data-component={dataComponent}
            title={title}
            description={description}
            headerDataComponent={`${dataComponent}-head`}
            titleDataComponent={`${dataComponent}-title`}
            descriptionDataComponent={`${dataComponent}-caption`}
            bodyDataComponent={`${dataComponent}-body`}
        >
            {children}
        </FormSection>
    );
}

// Format number with commas (handles comma-formatted strings too)
const formatPrice = (price: number | string): string => {
    if (!price && price !== 0) return "";
    // Remove existing commas before parsing
    const cleaned = typeof price === "string" ? price.replace(/,/g, "") : String(price);
    const num = parseInt(cleaned, 10);
    if (isNaN(num)) return "";
    return num.toLocaleString("ko-KR");
};

// Parse price string to raw number string (removes commas)
const parsePrice = (value: string | null | undefined): string => {
    if (!value) return "";
    return value.replace(/,/g, "");
};

// Format phone number as XXX-XXXX-XXXX
const formatPhoneNumber = (value: string): string => {
    // Remove all non-digit characters
    const digits = value.replace(/\D/g, "");

    // Apply formatting based on length
    if (digits.length <= 3) {
        return digits;
    } else if (digits.length <= 7) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    } else {
        return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
    }
};

const getPhoneDuplicateCheckFailedMessage = (locale: "ko" | "en"): string =>
    locale === "ko"
        ? "문제가 발생했어요. 새로고침 해주세요."
        : "Something went wrong. Please refresh and try again.";

const getPhoneDuplicateCheckPendingMessage = (locale: "ko" | "en"): string =>
    locale === "ko"
        ? "연락처 중복 확인 중입니다. 잠시만 기다려주세요."
        : "Checking for duplicate phone number. Please wait.";

const getPhoneAvailableMessage = (locale: "ko" | "en"): string =>
    locale === "ko" ? "등록 가능한 번호입니다." : "This phone number is available.";

// Format ISO date string to yyyy-MM-dd for HTML date input
const formatDateForInput = (dateString: string | null | undefined): string => {
    if (!dateString) return "";
    // Handle ISO format (e.g., "2025-12-26T00:00:00.000Z")
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0];
};

const formatDateForCompactInput = (dateString: string | null | undefined): string => {
    const formattedDate = formatDateForInput(dateString);
    if (!formattedDate) return "";
    return `${formattedDate.slice(2, 4)}${formattedDate.slice(5, 7)}${formattedDate.slice(8, 10)}`;
};

const parseCompactDateInput = (value: string): string => {
    return value.replace(/\D/g, "").slice(0, 6);
};

const normalizeCompactDateForSubmit = (value: string): string => {
    const compactDate = parseCompactDateInput(value);
    if (compactDate.length !== 6) return value;

    const yearPrefix = Number(compactDate.slice(0, 2)) >= 70 ? "19" : "20";
    return `${yearPrefix}${compactDate.slice(0, 2)}-${compactDate.slice(2, 4)}-${compactDate.slice(4, 6)}`;
};

const normalizeDateForCompactState = (value: string | null | undefined): string => {
    if (value && /^\d{6}$/.test(value)) return value;
    const compactDate = formatDateForCompactInput(value);
    if (compactDate) return compactDate;
    return parseCompactDateInput(value ?? "");
};

const isValidCompactDateInput = (value: string): boolean => {
    const compactDate = parseCompactDateInput(value);
    if (compactDate.length !== 6) return false;

    const normalizedDate = normalizeCompactDateForSubmit(compactDate);
    const date = new Date(`${normalizedDate}T00:00:00`);
    return (
        !Number.isNaN(date.getTime()) &&
        date.getFullYear() === Number(normalizedDate.slice(0, 4)) &&
        date.getMonth() + 1 === Number(normalizedDate.slice(5, 7)) &&
        date.getDate() === Number(normalizedDate.slice(8, 10))
    );
};

const isValidIsoDateInput = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const date = new Date(`${value}T00:00:00`);
    return (
        !Number.isNaN(date.getTime()) &&
        date.getFullYear() === Number(value.slice(0, 4)) &&
        date.getMonth() + 1 === Number(value.slice(5, 7)) &&
        date.getDate() === Number(value.slice(8, 10))
    );
};

const formatCompactDateForIsoInput = (value: string | null | undefined): string => {
    if (!value) return "";
    if (/^\d{6}$/.test(value)) return normalizeCompactDateForSubmit(value);
    return value;
};

const parseIsoDateInputToCompactState = (value: string): string => {
    const formattedValue = formatIsoDateInput(value);
    return formattedValue.length === 10 && isValidIsoDateInput(formattedValue)
        ? normalizeDateForCompactState(formattedValue)
        : formattedValue;
};

export function ClientFormPanel({
    "data-component": dataComponent,
    open = true,
    onClose,
    client,
    onSuccess,
    activeStep,
    onActiveStepChange,
    renderLayout,
}: ClientFormPanelProps) {
    return (
        <ClientFormContent
            surface="panel"
            data-component={dataComponent}
            open={open}
            onClose={onClose}
            client={client}
            onSuccess={onSuccess}
            activeStep={activeStep}
            onActiveStepChange={onActiveStepChange}
            renderLayout={renderLayout}
        />
    );
}

export function ClientFormDialog({ "data-component": dataComponent, open, onClose, client, onSuccess }: ClientFormDialogProps) {
    return (
        <ClientFormContent
            surface="dialog"
            data-component={dataComponent}
            open={open}
            onClose={onClose}
            client={client}
            onSuccess={onSuccess}
        />
    );
}

function ClientFormContent({
    surface,
    "data-component": dataComponent,
    open,
    onClose,
    client,
    onSuccess,
    activeStep: controlledActiveStep,
    onActiveStepChange,
    renderLayout,
}: ClientFormDialogProps & Pick<ClientFormPanelProps, "activeStep" | "onActiveStepChange" | "renderLayout"> & { surface: "dialog" | "panel" }) {
    const base =
        dataComponent ?? (surface === "panel" ? "desktop_clients_form-panel" : "desktop_clients_form-dialog");
    const router = useRouter();
    const searchParams = useSearchParams();
    const locale = useLocale();
    const isEditMode = !!client;

    // Read pre-filled name from Zustand store (when opened from ClientAutocomplete)
    const prefillName = useClientDialogStore((state) => state.prefillName);
    const clearPrefillName = useClientDialogStore((state) => state.clearPrefillName);

    const createClient = useCreateClient();
    const updateClient = useUpdateClient();

    // Form state - use extended type to allow null for primaryEmployeeId during form editing
    const [formData, setFormData] = useState<ClientFormData>({
        name: "",
        birthday: "",
        dueDate: "",
        birthDate: "",
        address: "",
        phone: "",
        primaryEmployeeId: null, // null means "not selected yet"
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
        applyMessageAutomation: true,
    });

    const {
        phoneDigits,
        isCheckingPhoneDuplicate,
        isPhoneDuplicate,
        hasPhoneDuplicateCheckFailed,
        lastCheckedPhoneDigits,
        isUsingOriginalPhone,
        isPhoneCheckReady,
    } = useClientPhoneDuplicateCheck({
        phone: formData.phone,
        originalPhone: client?.phone,
        enabled: open,
    });
    const phoneInlineMessage = phoneDigits.length === 11
        ? isUsingOriginalPhone || isPhoneCheckReady
            ? getPhoneAvailableMessage(locale)
            : isCheckingPhoneDuplicate
                ? getPhoneDuplicateCheckPendingMessage(locale)
                : hasPhoneDuplicateCheckFailed
                    ? getPhoneDuplicateCheckFailedMessage(locale)
                    : lastCheckedPhoneDigits !== phoneDigits
                        ? getPhoneDuplicateCheckPendingMessage(locale)
                        : isPhoneDuplicate
                            ? t(locale, "clients.form.error-phone-duplicate")
                            : null
        : null;
    const hasPhoneStatusError =
        phoneDigits.length === 11 &&
        !isUsingOriginalPhone &&
        (hasPhoneDuplicateCheckFailed ||
            (lastCheckedPhoneDigits === phoneDigits && isPhoneDuplicate));
    const isPhoneCheckBlockingSubmit = phoneDigits.length === 11 && !isPhoneCheckReady;

    const [error, setError] = useState<string | null>(null);
    const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
    const [employeeDialogTarget, setEmployeeDialogTarget] = useState<"primary" | "secondary" | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [initializedEditClientId, setInitializedEditClientId] = useState<number | null>(null);
    const [hasUserEditedSinceOpen, setHasUserEditedSinceOpen] = useState(false);
    const [internalActiveStep, setInternalActiveStep] = useState(0);
    const activeStep = controlledActiveStep ?? internalActiveStep;
    const setActiveStep = useCallback(
        (nextStep: number) => {
            const clampedStep = Math.max(0, Math.min(nextStep, CLIENT_FORM_LAST_STEP_INDEX));
            if (controlledActiveStep === undefined) {
                setInternalActiveStep(clampedStep);
            }
            onActiveStepChange?.(clampedStep);
        },
        [controlledActiveStep, onActiveStepChange]
    );

    // Track if prices were manually edited
    const [pricesManuallyEdited, setPricesManuallyEdited] = useState(false);
    const skipNextEndDateRecalculationRef = useRef(false);

    // Voucher year selection - defaults to the year the service belongs to: the
    // form's service end date (initialized from the stored record when editing).
    // Without an end date it defaults to the current year, and either case falls
    // back to the latest server-provided year when the year isn't in the list.
    const { data: voucherYears = [] } = useVoucherYears();
    const [voucherYear, setVoucherYear] = useState<number | null>(null);
    const resolvedVoucherYear = useMemo(() => {
        if (voucherYear !== null) return voucherYear;
        const endDateYear = isValidCompactDateInput(formData.endDate ?? "")
            ? Number.parseInt(normalizeCompactDateForSubmit(formData.endDate ?? "").slice(0, 4), 10)
            : NaN;
        if (Number.isFinite(endDateYear) && (voucherYears.length === 0 || voucherYears.includes(endDateYear))) {
            return endDateYear;
        }
        const currentYear = new Date().getFullYear();
        if (voucherYears.length === 0 || voucherYears.includes(currentYear)) return currentYear;
        return Math.max(...voucherYears);
    }, [voucherYear, voucherYears, formData.endDate]);

    // Fetch voucher price info based on selected type and year
    const { data: voucherPriceInfos, isLoading: isPriceLoading } = useVoucherPriceInfos(formData.type || "", resolvedVoucherYear);
    const {
        data: outOfPocketPriceInfos,
        isLoading: isOutOfPocketPriceLoading,
        isError: isOutOfPocketPriceError,
    } = useOutOfPocketPriceInfos();

    // Get available durations for the selected voucher type
    const availableDurations = useMemo(() => {
        if (!voucherPriceInfos) return [];
        // Get unique durations sorted
        const durations = [...new Set(voucherPriceInfos.map(info => Number(info.duration)))];
        return durations.sort((a, b) => a - b);
    }, [voucherPriceInfos]);

    const voucherYearOptions = useMemo(
        () => voucherYears.map((year) => ({
            value: String(year),
            label: `${year}년`,
        })),
        [voucherYears]
    );

    const voucherTypeOptions = useMemo(
        () =>
            Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => ({
                label: groupName,
                options: Object.keys(types).map((typeValue) => ({
                    value: typeValue,
                    label: typeValue,
                })),
            })),
        []
    );

    const durationOptions = useMemo(() => {
        if (!formData.voucherClient) {
            return (outOfPocketPriceInfos ?? []).map((priceInfo) => ({
                value: String(priceInfo.duration),
                label: formatOutOfPocketDurationLabel(priceInfo.duration),
            }));
        }

        return availableDurations.map((duration) => ({
            value: String(duration),
            label: `${duration}일`,
        }));
    }, [availableDurations, formData.voucherClient, outOfPocketPriceInfos]);

    const serviceStatusOptions = useMemo(
        () => SERVICE_STATUS_OPTIONS.map((status) => ({
            value: status.value,
            label: status.label,
        })),
        []
    );

    // Get price info for selected type and duration
    const selectedPriceInfo = useMemo(() => {
        if (!formData.voucherClient) {
            return findOutOfPocketPriceInfo(outOfPocketPriceInfos, formData.duration);
        }
        if (!voucherPriceInfos || !formData.duration) return null;
        return voucherPriceInfos.find(
            info => Number(info.duration) === formData.duration
        );
    }, [formData.duration, formData.voucherClient, outOfPocketPriceInfos, voucherPriceInfos]);
    const arePriceInputsLocked = formData.voucherClient
        ? !formData.type || !formData.duration || isPriceLoading
        : !formData.duration || isOutOfPocketPriceLoading || isOutOfPocketPriceError;

    // Auto-fill prices when type and duration are selected (only if not manually edited)
    useEffect(() => {
        if (selectedPriceInfo && !pricesManuallyEdited) {
            queueMicrotask(() => {
                setFormData(prev => prev.voucherClient
                    ? {
                        ...prev,
                        fullPrice: parsePrice(selectedPriceInfo.fullPrice),
                        grant: "grant" in selectedPriceInfo ? parsePrice(selectedPriceInfo.grant) : prev.grant,
                        actualPrice: "actualPrice" in selectedPriceInfo ? parsePrice(selectedPriceInfo.actualPrice) : prev.actualPrice,
                    }
                    : {
                        ...prev,
                        fullPrice: parsePrice(selectedPriceInfo.fullPrice),
                        grant: "0",
                        actualPrice: parsePrice(selectedPriceInfo.fullPrice),
                    });
            });
        }
    }, [selectedPriceInfo, pricesManuallyEdited]);

    useEffect(() => {
        if (skipNextEndDateRecalculationRef.current) {
            skipNextEndDateRecalculationRef.current = false;
            return;
        }

        queueMicrotask(() => {
            setFormData(prev => {
                const duration = prev.duration;
                const startDate = prev.startDate ?? "";

                if (!duration || !isValidCompactDateInput(startDate)) {
                    return prev.endDate ? { ...prev, endDate: "" } : prev;
                }

                const startDateIso = normalizeCompactDateForSubmit(startDate);
                const computedEndDateIso = calcEndDateBusinessDays(startDateIso, duration);
                const computedEndDate = normalizeDateForCompactState(computedEndDateIso);

                return prev.endDate === computedEndDate ? prev : {
                    ...prev,
                    endDate: computedEndDate,
                };
            });
        });
    }, [formData.duration, formData.startDate]);

    // Reset duration/prices when the voucher year changes (same semantics as handleTypeChange)
    const handleVoucherYearChange = (newYear: string) => {
        setHasUserEditedSinceOpen(true);
        const parsedYear = Number(newYear);
        setVoucherYear(Number.isNaN(parsedYear) ? null : parsedYear);
        setFormData(prev => ({
            ...prev,
            duration: null, // Reset duration when year changes
            // Only reset prices if not manually edited
            ...(pricesManuallyEdited ? {} : {
                fullPrice: "",
                grant: "",
                actualPrice: "",
            }),
        }));
    };

    // Reset duration when type changes
    const handleTypeChange = (newType: string) => {
        setHasUserEditedSinceOpen(true);
        setFormData(prev => ({
            ...prev,
            type: newType,
            duration: null, // Reset duration when type changes
            // Only reset prices if not manually edited
            ...(pricesManuallyEdited ? {} : {
                fullPrice: "",
                grant: "",
                actualPrice: "",
            }),
        }));
    };

    const handleVoucherClientChange = (voucherClient: boolean) => {
        setHasUserEditedSinceOpen(true);
        setPricesManuallyEdited(false);
        setFormData(prev => ({
            ...prev,
            voucherClient,
            type: "",
            duration: null,
            fullPrice: "",
            grant: "",
            actualPrice: "",
        }));
    };

    // Reset form when dialog opens/closes or client changes
    useEffect(() => {
        if (open) {
            skipNextEndDateRecalculationRef.current = true;
            let nextFormData: ClientFormData | null = null;
            let nextPricesManuallyEdited = false;

            if (client) {
                nextFormData = {
                    name: client.name,
                    birthday: client.birthday || "",
                    dueDate: formatDateForInput(client.dueDate),
                    birthDate: formatDateForInput(client.birthDate),
                    address: client.address || "",
                    phone: client.phone || "",
                    primaryEmployeeId: client.primaryEmployee?.id ?? null,
                    secondaryEmployeeId: client.secondaryEmployee?.id ?? null,
                    type: client.type || "",
                    duration: client.duration,
                    fullPrice: client.fullPrice || "",
                    grant: client.grant || "",
                    actualPrice: client.actualPrice || "",
                    startDate: normalizeDateForCompactState(client.startDate),
                    endDate: normalizeDateForCompactState(client.endDate),
                    careCenter: client.careCenter,
                    voucherClient: client.voucherClient,
                    breastPump: client.breastPump,
                    serviceStatus: client.serviceStatus || "pre_booking",
                    applyMessageAutomation: true,
                };
                nextPricesManuallyEdited = Boolean(client.fullPrice || client.grant || client.actualPrice);
            }

            if (!nextFormData) {
                nextFormData = {
                    name: prefillName || "",
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
                    applyMessageAutomation: true,
                };
                clearPrefillName();
            }

            nextFormData = {
                ...nextFormData,
                startDate: normalizeDateForCompactState(nextFormData.startDate),
                endDate: normalizeDateForCompactState(nextFormData.endDate),
            };
            queueMicrotask(() => {
                setFormData(nextFormData);
                setInitializedEditClientId(client?.id ?? null);
                setHasUserEditedSinceOpen(false);
                setPricesManuallyEdited(nextPricesManuallyEdited);
                setVoucherYear(null); // Reset to default (current year, falling back to latest available)
                setError(null);
            });
        }
    }, [clearPrefillName, client, open, prefillName]);

    const isLegacyNoopEdit = Boolean(
        isEditMode
        && client
        && !client.dueDate
        && initializedEditClientId === client.id
        && !hasUserEditedSinceOpen,
    );

    const handleChange = (field: keyof CreateClientDto, value: unknown) => {
        setHasUserEditedSinceOpen(true);
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const openEmployeeDialog = (target: "primary" | "secondary") => {
        setEmployeeDialogTarget(target);
        setIsEmployeeDialogOpen(true);
    };

    const handleEmployeeDialogClose = () => {
        setIsEmployeeDialogOpen(false);
        setEmployeeDialogTarget(null);
    };

    const handleEmployeeCreated = (newEmployee: Employee) => {
        setHasUserEditedSinceOpen(true);
        setFormData(prev => {
            if (employeeDialogTarget === "primary") {
                return { ...prev, primaryEmployeeId: newEmployee.id };
            }
            if (employeeDialogTarget === "secondary") {
                return { ...prev, secondaryEmployeeId: newEmployee.id };
            }
            return prev;
        });
    };

    // Handle manual price changes
    const handlePriceChange = (field: "fullPrice" | "grant" | "actualPrice", value: string) => {
        setPricesManuallyEdited(true);
        handleChange(field, value);
    };

    const scrollToTop = () => {
        // Scroll the DialogContent (parent of our content div) to top
        contentRef.current?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
    };

    const setErrorAndScroll = (errorMessage: string) => {
        setError(errorMessage);
        // Use setTimeout to ensure the Alert is rendered before scrolling
        setTimeout(scrollToTop, 0);
    };

    const handleStepChange = (nextStep: number) => {
        setError(null);
        setActiveStep(nextStep);
        setTimeout(scrollToTop, 0);
    };

    const handleSubmit = async () => {
        setError(null);

        if (isLegacyNoopEdit && client) {
            try {
                // Some legacy customers predate the current required form fields. An empty
                // update preserves that record exactly while still invoking the backend's
                // phone-based document relink. Automatic form hydration is not considered an
                // edit; any user interaction exits this narrow compatibility path.
                const updatedClient = await updateClient.mutateAsync({ id: client.id, dto: {} });
                onSuccess?.(updatedClient);
                onClose();
            } catch (error: unknown) {
                console.error("Failed to save client:", error);
                setErrorAndScroll(getErrorMessage(error, locale, "clients.form.error-save-failed"));
            }
            return;
        }

        // 고객 기본 정보만 필수이며 서비스 정보는 상담 단계에서 비워둘 수 있다.
        if (!formData.name.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-name-required"));
            return;
        }
        if (!formData.birthday?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-birthday-required"));
            return;
        }
        if (formData.dueDate?.trim() && !isValidIsoDateInput(formData.dueDate)) {
            setErrorAndScroll(t(locale, "clients.form.error-due-date-invalid"));
            return;
        }
        if (formData.birthDate?.trim() && !isValidIsoDateInput(formData.birthDate)) {
            setErrorAndScroll(t(locale, "clients.form.error-birth-date-invalid"));
            return;
        }
        if (!formData.address?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-address-required"));
            return;
        }
        if (phoneDigits.length !== 11) {
            setErrorAndScroll(t(locale, "clients.form.error-phone-required"));
            return;
        }
        if (!isUsingOriginalPhone) {
            if (isCheckingPhoneDuplicate) {
                setErrorAndScroll(getPhoneDuplicateCheckPendingMessage(locale));
                return;
            }
            if (hasPhoneDuplicateCheckFailed) {
                setErrorAndScroll(getPhoneDuplicateCheckFailedMessage(locale));
                return;
            }
            if (lastCheckedPhoneDigits !== phoneDigits) {
                setErrorAndScroll(getPhoneDuplicateCheckPendingMessage(locale));
                return;
            }
            if (isPhoneDuplicate) {
                setErrorAndScroll(t(locale, "clients.form.error-phone-duplicate"));
                return;
            }
        }
        try {
            const normalizedDueDate = formData.dueDate ?? "";
            const normalizedBirthDate = formData.birthDate ?? "";
            const normalizedStartDate = normalizeCompactDateForSubmit(formData.startDate ?? "");
            const normalizedEndDate = normalizeCompactDateForSubmit(formData.endDate ?? "");

            if (isEditMode && client) {
                // Build update DTO, excluding null employee IDs to avoid validation errors
                // (backend @IsOptional only skips undefined, not null)
                const updateDto: UpdateClientDto = {
                    name: formData.name,
                    birthday: formData.birthday,
                    dueDate: normalizedDueDate || null,
                    birthDate: normalizedBirthDate || null,
                    address: formData.address,
                    phone: formData.phone,
                    // Only include employee IDs if explicitly selected (not null)
                    ...(formData.primaryEmployeeId !== null && { primaryEmployeeId: formData.primaryEmployeeId }),
                    ...(formData.secondaryEmployeeId !== null && { secondaryEmployeeId: formData.secondaryEmployeeId }),
                    type: formData.voucherClient ? formData.type : null,
                    duration: formData.duration || null,
                    fullPrice: formData.fullPrice,
                    grant: formData.voucherClient ? formData.grant : "0",
                    actualPrice: formData.voucherClient ? formData.actualPrice : formData.fullPrice,
                    startDate: normalizedStartDate || null,
                    endDate: normalizedEndDate || null,
                    careCenter: formData.careCenter,
                    voucherClient: formData.voucherClient,
                    breastPump: formData.breastPump,
                    serviceStatus: formData.serviceStatus,
                };
                const updatedClient = await updateClient.mutateAsync({ id: client.id, dto: updateDto });
                onSuccess?.(updatedClient);
            } else {
                const createDto: CreateClientDto = {
                    name: formData.name,
                    birthday: formData.birthday || null,
                    dueDate: normalizedDueDate || null,
                    birthDate: normalizedBirthDate || null,
                    address: formData.address || null,
                    phone: formData.phone || null,
                    primaryEmployeeId: formData.primaryEmployeeId,
                    secondaryEmployeeId: formData.secondaryEmployeeId,
                    type: formData.voucherClient ? formData.type || null : null,
                    duration: formData.duration || null,
                    fullPrice: formData.fullPrice || null,
                    grant: formData.voucherClient ? formData.grant || null : "0",
                    actualPrice: formData.voucherClient ? formData.actualPrice || null : formData.fullPrice || null,
                    startDate: normalizedStartDate || null,
                    endDate: normalizedEndDate || null,
                    careCenter: formData.careCenter,
                    voucherClient: formData.voucherClient,
                    breastPump: formData.breastPump,
                    serviceStatus: formData.serviceStatus,
                    applyMessageAutomation: formData.applyMessageAutomation,
                };
                const newClient = await createClient.mutateAsync(createDto);
                onSuccess?.(newClient);
            }
            onClose();
        } catch (error: unknown) {
            console.error("Failed to save client:", error);
            setErrorAndScroll(getErrorMessage(error, locale, "clients.form.error-save-failed"));
        }
    };

    const isSubmitting = createClient.isPending || updateClient.isPending;

    const isBasicStepValid = isLegacyNoopEdit || Boolean(
        formData.name.trim()
        && formData.birthday?.trim()
        && (!formData.dueDate?.trim() || isValidIsoDateInput(formData.dueDate))
        && formData.address?.trim()
        && isPhoneCheckReady
    );
    const isEmployeeStepValid = true;
    const isVoucherStepValid = true;
    const isContractStepValid = true;
    const stepValidation = [
        isBasicStepValid,
        isEmployeeStepValid,
        isVoucherStepValid,
        isContractStepValid,
    ] as const;
    const isCurrentStepValid = stepValidation[activeStep] ?? true;
    const isFormComplete = isBasicStepValid;
    const requiredFieldProgressText = `필수 항목 4개 중 ${
        [
            Boolean(formData.name.trim()),
            isValidCompactDateInput(formData.birthday ?? ""),
            Boolean(formData.address?.trim()),
            Boolean(formData.phone?.trim()),
        ].filter(Boolean).length
    }개 입력됨`;

    const handleDialogClose = () => {
        if (searchParams.get("openClientForm") === "1") {
            router.replace("/clients");
        }

        onClose();
    };

    const formTitle = isEditMode
        ? t(locale, "clients.form.edit-title")
        : t(locale, "clients.form.add-title");
    const dialogFormActions = (
        <div className="ml-auto flex w-full flex-col-reverse gap-2 sm:w-[300px] sm:flex-row sm:justify-end">
            <Button
                variant="neutral"
                size="sm"
                onClick={handleDialogClose}
                disabled={isSubmitting}
                data-component={`${base}_cancel`}
                className="w-full sm:flex-1"
            >
                {t(locale, "common.cancel")}
            </Button>
            <Button
                variant="positive"
                size="sm"
                onClick={handleSubmit}
                disabled={isSubmitting || (!isLegacyNoopEdit && isPhoneCheckBlockingSubmit)}
                data-component={`${base}_submit`}
                className="w-full sm:flex-1"
            >
                {isSubmitting ? (
                    <Spinner className="h-4 w-4" />
                ) : isEditMode ? (
                    t(locale, "common.save")
                ) : (
                    t(locale, "common.create")
                )}
            </Button>
        </div>
    );
    const panelFormActions = (
        <div className="flex w-full flex-wrap items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))]">
            <span className={DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME}>{requiredFieldProgressText}</span>
            <div className={DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME}>
                {activeStep === 0 && (
                    <Button
                        variant="neutral"
                        size="sm"
                        onClick={handleDialogClose}
                        disabled={isSubmitting}
                        className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
                    >
                        {t(locale, "common.cancel")}
                    </Button>
                )}
                {activeStep > 0 && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleStepChange(activeStep - 1)}
                        disabled={isSubmitting}
                        data-component={`${base}_prev`}
                        className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
                    >
                        이전
                    </Button>
                )}
                {activeStep < CLIENT_FORM_LAST_STEP_INDEX ? (
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => handleStepChange(activeStep + 1)}
                        disabled={!isCurrentStepValid || isSubmitting}
                        data-component={`${base}_next`}
                        className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
                    >
                        다음
                    </Button>
                ) : (
                    <Button
                        type="button"
                        size="sm"
                        onClick={handleSubmit}
                        disabled={isSubmitting || !isFormComplete}
                        data-component={`${base}_submit`}
                        className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
                    >
                        {isSubmitting ? (
                            <Spinner className="h-4 w-4" />
                        ) : isEditMode ? (
                            t(locale, "common.save")
                        ) : (
                            t(locale, "common.create")
                        )}
                    </Button>
                )}
            </div>
        </div>
    );

    const basicInfoSection = (
        <ClientDialogSection
            dataComponent={`${base}_section-basic`}
            title={t(locale, "clients.form.section-basic")}
            description="고객의 프로필과 연락처를 먼저 입력해 주세요."
        >
            <FormGrid data-component={`${base}_basic-grid`}>
                <FormField
                    data-component={`${base}_basic-grid_field-name`}
                    htmlFor="name"
                    label={t(locale, "clients.form.name")}
                    required
                >
                    <FormTextInput
                        id="name"
                        placeholder="홍길동"
                        value={formData.name}
                        onChange={(e) => handleChange("name", e.target.value)}
                    />
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-birthday`}
                    htmlFor="birthday"
                    label={t(locale, "clients.form.birthday")}
                >
                    <FormTextInput
                        id="birthday"
                        placeholder="YYMMDD"
                        value={formData.birthday ?? ""}
                        onChange={(e) => handleChange("birthday", e.target.value)}
                        maxLength={6}
                    />
                    <FormHelperText data-component={`${base}_basic-grid_field-birthday_helper`}>
                        {t(locale, "clients.form.birthday-helper")}
                    </FormHelperText>
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-due-date`}
                    htmlFor="dueDate"
                    label={t(locale, "clients.form.due-date")}
                >
                    <FormTextInput
                        id="dueDate"
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="YYYY-MM-DD"
                        value={formData.dueDate || ""}
                        onChange={(e) => handleChange("dueDate", formatIsoDateInput(e.target.value))}
                    />
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-birth-date`}
                    htmlFor="birthDate"
                    label={t(locale, "clients.form.birth-date")}
                >
                    <FormTextInput
                        id="birthDate"
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="YYYY-MM-DD"
                        value={formData.birthDate || ""}
                        onChange={(e) => handleChange("birthDate", formatIsoDateInput(e.target.value))}
                    />
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-phone`}
                    htmlFor="phone"
                    label={t(locale, "clients.form.phone")}
                    labelAccessory={phoneInlineMessage ? (
                        <FormHelperText
                            id="clients-form-dialog-phone-helper"
                            data-component={`${base}_basic-grid_field-phone_helper`}
                            tone={hasPhoneStatusError ? "error" : "default"}
                            className={cn("m-0 text-right", isPhoneCheckReady && "text-v3-green")}
                            aria-live="polite"
                        >
                            {phoneInlineMessage}
                        </FormHelperText>
                    ) : null}
                >
                    <FormTextInput
                        id="phone"
                        type="tel"
                        inputMode="numeric"
                        placeholder="010-1234-5678"
                        value={formData.phone ?? ""}
                        onChange={(e) => {
                            handleChange("phone", formatPhoneNumber(e.target.value));
                            setError(null);
                        }}
                        maxLength={13}
                        error={hasPhoneStatusError}
                        aria-describedby={phoneInlineMessage ? "clients-form-dialog-phone-helper" : undefined}
                    />
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-address`}
                    htmlFor="address"
                    label={t(locale, "clients.form.address")}
                    className="sm:col-span-2"
                >
                    <FormTextInput
                        id="address"
                        placeholder="예: 인천광역시 서구"
                        value={formData.address ?? ""}
                        onChange={(e) => handleChange("address", e.target.value)}
                    />
                </FormField>
            </FormGrid>
        </ClientDialogSection>
    );

    const employeeSection = (
        <ClientDialogSection
            dataComponent={`${base}_section-employee`}
            title={t(locale, "clients.form.section-employee")}
            description="서비스를 담당할 제공인력을 배정해 주세요."
        >
            <FormGrid data-component={`${base}_employee-grid`}>
                <EmployeeAutocomplete
                    data-component={`${base}_employee-grid_primary-employee-autocomplete`}
                    value={formData.primaryEmployeeId}
                    onChange={(id) => handleChange("primaryEmployeeId", id)}
                    label={t(locale, "clients.form.primary-employee")}
                    excludeIds={formData.secondaryEmployeeId != null ? [formData.secondaryEmployeeId] : []}
                    allowManualEntry
                    onManualEntry={() => {
                        openEmployeeDialog("primary");
                    }}
                />
                <EmployeeAutocomplete
                    data-component={`${base}_employee-grid_secondary-employee-autocomplete`}
                    value={formData.secondaryEmployeeId ?? null}
                    onChange={(id) => handleChange("secondaryEmployeeId", id)}
                    label={t(locale, "clients.form.secondary-employee")}
                    excludeIds={formData.primaryEmployeeId != null ? [formData.primaryEmployeeId] : []}
                    allowManualEntry
                    onManualEntry={() => {
                        openEmployeeDialog("secondary");
                    }}
                />
            </FormGrid>
        </ClientDialogSection>
    );

    const voucherInfoSections = (
        <>
            <ClientDialogSection
                dataComponent={`${base}_section-service`}
                title={t(locale, "clients.form.section-service")}
                description="선택 항목입니다. 상담 단계에서는 입력하지 않아도 됩니다."
            >
                <TogglePill
                    data-component={`${base}_field-voucher-client`}
                    value={formData.voucherClient}
                    onValueChange={handleVoucherClientChange}
                    leftLabel={t(locale, "clients.form.voucher-client")}
                    rightLabel={t(locale, "clients.form.self-pay-client")}
                    ariaLabel={t(locale, "clients.form.customer-type")}
                />

                <FormGrid data-component={`${base}_service-grid`}>
                    {formData.voucherClient && (
                        <>
                            <FormField
                                data-component={`${base}_service-grid_field-voucher-year`}
                                htmlFor="clients-form-voucher-year"
                                label={t(locale, "clients.form.voucher-year")}
                            >
                                <FormNativeSelect
                                    id="clients-form-voucher-year"
                                    value={resolvedVoucherYear.toString()}
                                    options={voucherYearOptions}
                                    placeholder={t(locale, "clients.form.voucher-year")}
                                    onValueChange={handleVoucherYearChange}
                                    wrapDataComponent={`${base}_service-grid_field-voucher-year_select-wrap`}
                                    selectDataComponent={`${base}_service-grid_field-voucher-year_select`}
                                    iconDataComponent={`${base}_service-grid_field-voucher-year_select-icon`}
                                />
                            </FormField>

                            <FormField
                                data-component={`${base}_service-grid_field-voucher-type`}
                                htmlFor="clients-form-voucher-type"
                                label={t(locale, "clients.form.voucher-type")}
                            >
                                <FormNativeSelect
                                    id="clients-form-voucher-type"
                                    value={formData.type || ""}
                                    options={voucherTypeOptions}
                                    placeholder={t(locale, "clients.form.voucher-type")}
                                    onValueChange={handleTypeChange}
                                    wrapDataComponent={`${base}_service-grid_field-voucher-type_select-wrap`}
                                    selectDataComponent={`${base}_service-grid_field-voucher-type_select`}
                                    iconDataComponent={`${base}_service-grid_field-voucher-type_select-icon`}
                                />
                            </FormField>
                        </>
                    )}

                    <FormField
                        data-component={`${base}_service-grid_field-duration`}
                        htmlFor="clients-form-duration"
                        label={t(locale, "clients.form.duration")}
                    >
                        <div className="relative">
                            <FormNativeSelect
                                id="clients-form-duration"
                                value={formData.duration?.toString() || ""}
                                options={durationOptions}
                                placeholder={t(locale, "clients.form.duration")}
                                onValueChange={(value) => {
                                    handleChange("duration", value ? Number(value) : null);
                                    setPricesManuallyEdited(false);
                                }}
                                disabled={formData.voucherClient
                                    ? !formData.type || isPriceLoading
                                    : isOutOfPocketPriceLoading || isOutOfPocketPriceError}
                                wrapDataComponent={`${base}_service-grid_field-duration_select-wrap`}
                                selectDataComponent={`${base}_service-grid_field-duration_select`}
                                iconDataComponent={`${base}_service-grid_field-duration_select-icon`}
                            />
                            {(formData.voucherClient ? isPriceLoading : isOutOfPocketPriceLoading) && (
                                <div className="absolute right-10 top-1/2 -translate-y-1/2">
                                    <Spinner className="h-4 w-4" />
                                </div>
                            )}
                        </div>
                    </FormField>
                </FormGrid>
                {!formData.voucherClient && isOutOfPocketPriceError && (
                    <FormHelperText tone="error" data-component={`${base}_out-of-pocket-price-error`}>
                        자부담 요금 정보를 불러오지 못했습니다.
                    </FormHelperText>
                )}
            </ClientDialogSection>

            <ClientDialogSection
                dataComponent={`${base}_section-pricing`}
                title={t(locale, "clients.form.section-pricing")}
                description={formData.voucherClient
                    ? "서비스 금액과 지원 금액을 확인하고 조정해 주세요."
                    : "기간별 총 서비스 금액을 확인하고 조정해 주세요."}
            >
                <FormGrid
                    data-component={`${base}_pricing-grid`}
                    className={formData.voucherClient ? "lg:grid-cols-3" : undefined}
                >
                    <FormField
                        data-component={`${base}_pricing-grid_field-full-price`}
                        htmlFor="fullPrice"
                        label={t(locale, "clients.form.full-price")}
                    >
                        <div className="relative">
                            <FormTextInput
                                id="fullPrice"
                                value={arePriceInputsLocked ? "" : formatPrice(formData.fullPrice || "")}
                                onChange={(e) => handlePriceChange("fullPrice", e.target.value.replace(/,/g, ""))}
                                disabled={arePriceInputsLocked}
                                className="pr-[calc(32px*var(--glint-ui-scale,1))]"
                            />
                            <span className="absolute right-[calc(12px*var(--glint-ui-scale,1))] top-1/2 -translate-y-1/2 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">
                                원
                            </span>
                        </div>
                    </FormField>

                    {formData.voucherClient && <FormField
                        data-component={`${base}_pricing-grid_field-grant`}
                        htmlFor="grant"
                        label={t(locale, "clients.form.grant")}
                    >
                        <div className="relative">
                            <FormTextInput
                                id="grant"
                                value={arePriceInputsLocked ? "" : formatPrice(formData.grant || "")}
                                onChange={(e) => handlePriceChange("grant", e.target.value.replace(/,/g, ""))}
                                disabled={arePriceInputsLocked}
                                className="pr-[calc(32px*var(--glint-ui-scale,1))]"
                            />
                            <span className="absolute right-[calc(12px*var(--glint-ui-scale,1))] top-1/2 -translate-y-1/2 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">
                                원
                            </span>
                        </div>
                    </FormField>}

                    {formData.voucherClient && <FormField
                        data-component={`${base}_pricing-grid_field-actual-price`}
                        htmlFor="actualPrice"
                        label={t(locale, "clients.form.actual-price")}
                    >
                        <div className="relative">
                            <FormTextInput
                                id="actualPrice"
                                value={arePriceInputsLocked ? "" : formatPrice(formData.actualPrice || "")}
                                onChange={(e) => handlePriceChange("actualPrice", e.target.value.replace(/,/g, ""))}
                                disabled={arePriceInputsLocked}
                                className="pr-[calc(32px*var(--glint-ui-scale,1))]"
                            />
                            <span className="absolute right-[calc(12px*var(--glint-ui-scale,1))] top-1/2 -translate-y-1/2 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">
                                원
                            </span>
                        </div>
                    </FormField>}
                </FormGrid>
            </ClientDialogSection>
        </>
    );

    const contractInfoSections = (
        <>
            <ClientDialogSection
                dataComponent={`${base}_section-contract`}
                title={t(locale, "clients.form.section-contract")}
                description="선택 항목입니다. 예약이 확정되면 서비스 일정을 입력해 주세요."
            >
                <FormGrid data-component={`${base}_contract-grid`} className="lg:grid-cols-3">
                    <FormField
                        data-component={`${base}_contract-grid_field-contract-status`}
                        htmlFor="clients-form-contract-status"
                        label={t(locale, "clients.form.contract-status")}
                    >
                        <FormNativeSelect
                            id="clients-form-contract-status"
                            value={formData.serviceStatus || ""}
                            options={serviceStatusOptions}
                            placeholder={t(locale, "clients.form.contract-status")}
                            onValueChange={(value) => handleChange("serviceStatus", value)}
                            wrapDataComponent={`${base}_contract-grid_field-contract-status_select-wrap`}
                            selectDataComponent={`${base}_contract-grid_field-contract-status_select`}
                            iconDataComponent={`${base}_contract-grid_field-contract-status_select-icon`}
                        />
                    </FormField>

                    <FormField
                        data-component={`${base}_contract-grid_field-start-date`}
                        htmlFor="startDate"
                        label={t(locale, "clients.form.start-date")}
                    >
                        <FormTextInput
                            id="startDate"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="YYMMDD"
                            value={formData.startDate || ""}
                            onChange={(e) => handleChange("startDate", parseCompactDateInput(e.target.value))}
                        />
                    </FormField>

                    <FormField
                        data-component={`${base}_contract-grid_field-end-date`}
                        htmlFor="endDate"
                        label={t(locale, "clients.form.end-date")}
                    >
                        <FormTextInput
                            id="endDate"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="YYMMDD"
                            value={formData.endDate || ""}
                            onChange={(e) => handleChange("endDate", parseCompactDateInput(e.target.value))}
                        />
                    </FormField>
                </FormGrid>
            </ClientDialogSection>

            <ClientDialogSection
                dataComponent={`${base}_section-flags`}
                title={t(locale, "clients.form.section-flags")}
                description="추가 서비스 옵션을 설정해 주세요."
            >
                <div className={cn(
                    "grid gap-[calc(12px*var(--glint-ui-scale,1))]",
                    isEditMode ? "lg:grid-cols-2" : "lg:grid-cols-3",
                )}>
                    <FormSwitchRow
                        data-component={`${base}_field-care-center`}
                        title={t(locale, "clients.form.care-center")}
                        checked={formData.careCenter === true}
                        onToggle={() => handleChange("careCenter", !formData.careCenter)}
                        buttonAriaLabel={t(locale, "clients.form.care-center")}
                    />
                    <FormSwitchRow
                        data-component={`${base}_field-breast-pump`}
                        title={t(locale, "clients.form.breast-pump")}
                        checked={formData.breastPump}
                        onToggle={() => handleChange("breastPump", !formData.breastPump)}
                        buttonAriaLabel={t(locale, "clients.form.breast-pump")}
                    />
                    {!isEditMode ? (
                        <FormSwitchRow
                            data-component={`${base}_field-message-automation`}
                            title={t(locale, "clients.form.message-automation")}
                            checked={formData.applyMessageAutomation !== false}
                            onToggle={() => handleChange("applyMessageAutomation", formData.applyMessageAutomation === false)}
                            buttonAriaLabel={t(locale, "clients.form.message-automation")}
                        />
                    ) : null}
                </div>
            </ClientDialogSection>
        </>
    );

    const panelBasicInfoStep = (
        <>
            <FormField
                data-component={`${base}_name-input`}
                htmlFor="name"
                label={t(locale, "clients.form.name")}
                required
            >
                <FormTextInput
                    id="name"
                    placeholder="홍길동"
                    value={formData.name}
                    onChange={(event) => handleChange("name", event.target.value)}
                />
            </FormField>

            <FormField
                data-component={`${base}_birthday-input`}
                htmlFor="birthday"
                label={t(locale, "clients.form.birthday")}
            >
                <FormTextInput
                    id="birthday"
                    placeholder="YYMMDD"
                    value={formData.birthday ?? ""}
                    onChange={(event) => handleChange("birthday", event.target.value)}
                    maxLength={6}
                />
            </FormField>

            <FormField
                data-component={`${base}_due-date-input`}
                htmlFor="dueDate"
                label={t(locale, "clients.form.due-date")}
            >
                <FormTextInput
                    id="dueDate"
                    placeholder="YYYY-MM-DD"
                    inputMode="numeric"
                    value={formData.dueDate || ""}
                    onChange={(event) => handleChange("dueDate", formatIsoDateInput(event.target.value))}
                    maxLength={10}
                />
            </FormField>

            <FormField
                data-component={`${base}_birth-date-input`}
                htmlFor="birthDate"
                label={t(locale, "clients.form.birth-date")}
            >
                <FormTextInput
                    id="birthDate"
                    placeholder="YYYY-MM-DD"
                    inputMode="numeric"
                    value={formData.birthDate || ""}
                    onChange={(event) => handleChange("birthDate", formatIsoDateInput(event.target.value))}
                    maxLength={10}
                />
            </FormField>

            <FormField
                data-component={`${base}_phone-input`}
                htmlFor="phone"
                label={t(locale, "clients.form.phone")}
                labelAccessory={phoneInlineMessage ? (
                    <FormHelperText
                        id="clients-form-panel-phone-helper"
                        data-component={`${base}_phone-input_helper`}
                        tone={hasPhoneStatusError ? "error" : "default"}
                        className={cn("m-0 text-right", isPhoneCheckReady && "text-v3-green")}
                        aria-live="polite"
                    >
                        {phoneInlineMessage}
                    </FormHelperText>
                ) : null}
            >
                <FormTextInput
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    placeholder="010-1234-5678"
                    value={formData.phone ?? ""}
                    onChange={(event) => {
                        handleChange("phone", formatPhoneNumber(event.target.value));
                        setError(null);
                    }}
                    maxLength={13}
                    error={hasPhoneStatusError}
                    aria-describedby={phoneInlineMessage ? "clients-form-panel-phone-helper" : undefined}
                />
            </FormField>

            <FormField
                data-component={`${base}_address-input`}
                htmlFor="address"
                label={t(locale, "clients.form.address")}
                className={PANEL_FULL_FIELD_CLASS_NAME}
            >
                <FormTextInput
                    id="address"
                    placeholder="예: 인천광역시 서구"
                    value={formData.address ?? ""}
                    onChange={(event) => handleChange("address", event.target.value)}
                />
            </FormField>
        </>
    );

    const panelEmployeeStep = (
        <>
            <EmployeeAutocomplete
                data-component={`${base}_employee-step_primary-employee-autocomplete`}
                value={formData.primaryEmployeeId}
                onChange={(id) => handleChange("primaryEmployeeId", id)}
                label={t(locale, "clients.form.primary-employee")}
                excludeIds={formData.secondaryEmployeeId != null ? [formData.secondaryEmployeeId] : []}
                allowManualEntry
                onManualEntry={() => {
                    openEmployeeDialog("primary");
                }}
            />
            <EmployeeAutocomplete
                data-component={`${base}_employee-step_secondary-employee-autocomplete`}
                value={formData.secondaryEmployeeId ?? null}
                onChange={(id) => handleChange("secondaryEmployeeId", id)}
                label={t(locale, "clients.form.secondary-employee")}
                excludeIds={formData.primaryEmployeeId != null ? [formData.primaryEmployeeId] : []}
                allowManualEntry
                onManualEntry={() => {
                    openEmployeeDialog("secondary");
                }}
            />
        </>
    );

    const panelVoucherInfoStep = (
        <>
            <div className={cn(PANEL_FULL_FIELD_CLASS_NAME, "flex justify-center")}>
                <TogglePill
                    data-component={`${base}_voucher-client-field`}
                    value={formData.voucherClient}
                    onValueChange={handleVoucherClientChange}
                    leftLabel={t(locale, "clients.form.voucher-client")}
                    rightLabel={t(locale, "clients.form.self-pay-client")}
                    ariaLabel={t(locale, "clients.form.customer-type")}
                />
            </div>

            {formData.voucherClient && (
                <>
                    <FormField
                        data-component={`${base}_voucher-year-field`}
                        htmlFor="clients-form-panel-voucher-year"
                        label={t(locale, "clients.form.voucher-year")}
                    >
                        <FormNativeSelect
                            id="clients-form-panel-voucher-year"
                            value={resolvedVoucherYear.toString()}
                            options={voucherYearOptions}
                            placeholder={t(locale, "clients.form.voucher-year")}
                            onValueChange={handleVoucherYearChange}
                            wrapDataComponent={`${base}_voucher-year-field_select-wrap`}
                            selectDataComponent={`${base}_voucher-year-field_select`}
                            iconDataComponent={`${base}_voucher-year-field_select-icon`}
                        />
                    </FormField>

                    <FormField
                        data-component={`${base}_voucher-type-field`}
                        htmlFor="clients-form-panel-voucher-type"
                        label={t(locale, "clients.form.voucher-type")}
                    >
                        <FormNativeSelect
                            id="clients-form-panel-voucher-type"
                            value={formData.type || ""}
                            options={voucherTypeOptions}
                            placeholder={t(locale, "clients.form.voucher-type")}
                            onValueChange={handleTypeChange}
                            wrapDataComponent={`${base}_voucher-type-field_select-wrap`}
                            selectDataComponent={`${base}_voucher-type-field_select`}
                            iconDataComponent={`${base}_voucher-type-field_select-icon`}
                        />
                    </FormField>
                </>
            )}

            <FormField
                data-component={`${base}_duration-field`}
                htmlFor="clients-form-panel-duration"
                label={t(locale, "clients.form.duration")}
            >
                <div className="relative">
                    <FormNativeSelect
                        id="clients-form-panel-duration"
                        value={formData.duration?.toString() || ""}
                        options={durationOptions}
                        placeholder={t(locale, "clients.form.duration")}
                        onValueChange={(value) => {
                            handleChange("duration", value ? Number(value) : null);
                            setPricesManuallyEdited(false);
                        }}
                        disabled={formData.voucherClient
                            ? !formData.type || isPriceLoading
                            : isOutOfPocketPriceLoading || isOutOfPocketPriceError}
                        wrapDataComponent={`${base}_duration-field_select-wrap`}
                        selectDataComponent={`${base}_duration-field_select`}
                        iconDataComponent={`${base}_duration-field_select-icon`}
                    />
                    {(formData.voucherClient ? isPriceLoading : isOutOfPocketPriceLoading) && (
                        <div className="absolute right-10 top-1/2 -translate-y-1/2">
                            <Spinner className="h-4 w-4" />
                        </div>
                    )}
                </div>
            </FormField>

            {!formData.voucherClient && isOutOfPocketPriceError && (
                <FormHelperText
                    tone="error"
                    className={PANEL_FULL_FIELD_CLASS_NAME}
                    data-component={`${base}_out-of-pocket-price-error`}
                >
                    자부담 요금 정보를 불러오지 못했습니다.
                </FormHelperText>
            )}

            <FormField
                data-component={`${base}_full-price-input`}
                htmlFor="fullPrice"
                label={t(locale, "clients.form.full-price")}
            >
                <FormTextInput
                    id="fullPrice"
                    value={arePriceInputsLocked ? "" : formatPrice(formData.fullPrice || "")}
                    onChange={(event) => handlePriceChange("fullPrice", event.target.value.replace(/,/g, ""))}
                    disabled={arePriceInputsLocked}
                />
            </FormField>

            {formData.voucherClient && <FormField
                data-component={`${base}_grant-input`}
                htmlFor="grant"
                label={t(locale, "clients.form.grant")}
            >
                <FormTextInput
                    id="grant"
                    value={arePriceInputsLocked ? "" : formatPrice(formData.grant || "")}
                    onChange={(event) => handlePriceChange("grant", event.target.value.replace(/,/g, ""))}
                    disabled={arePriceInputsLocked}
                />
            </FormField>}

            {formData.voucherClient && <FormField
                data-component={`${base}_actual-price-input`}
                htmlFor="actualPrice"
                label={t(locale, "clients.form.actual-price")}
            >
                <FormTextInput
                    id="actualPrice"
                    value={arePriceInputsLocked ? "" : formatPrice(formData.actualPrice || "")}
                    onChange={(event) => handlePriceChange("actualPrice", event.target.value.replace(/,/g, ""))}
                    disabled={arePriceInputsLocked}
                />
            </FormField>}
        </>
    );

    const panelContractInfoStep = (
        <>
            <FormField
                data-component={`${base}_contract-status-field`}
                htmlFor="clients-form-panel-contract-status"
                label={t(locale, "clients.form.contract-status")}
            >
                <FormNativeSelect
                    id="clients-form-panel-contract-status"
                    value={formData.serviceStatus || ""}
                    options={serviceStatusOptions}
                    placeholder={t(locale, "clients.form.contract-status")}
                    onValueChange={(value) => handleChange("serviceStatus", value)}
                    wrapDataComponent={`${base}_contract-status-field_select-wrap`}
                    selectDataComponent={`${base}_contract-status-field_select`}
                    iconDataComponent={`${base}_contract-status-field_select-icon`}
                />
            </FormField>

            <FormField
                data-component={`${base}_start-date-input`}
                htmlFor="startDate"
                label={t(locale, "clients.form.start-date")}
            >
                <FormTextInput
                    id="startDate"
                    placeholder="YYYY-MM-DD"
                    inputMode="numeric"
                    value={formatCompactDateForIsoInput(formData.startDate)}
                    onChange={(event) => handleChange("startDate", parseIsoDateInputToCompactState(event.target.value))}
                    maxLength={10}
                />
            </FormField>

            <FormField
                data-component={`${base}_end-date-input`}
                htmlFor="endDate"
                label={t(locale, "clients.form.end-date")}
            >
                <FormTextInput
                    id="endDate"
                    placeholder="YYYY-MM-DD"
                    inputMode="numeric"
                    value={formatCompactDateForIsoInput(formData.endDate)}
                    onChange={(event) => handleChange("endDate", parseIsoDateInputToCompactState(event.target.value))}
                    maxLength={10}
                />
            </FormField>

            <div className={cn(
                PANEL_FULL_FIELD_CLASS_NAME,
                "grid gap-[calc(12px*var(--glint-ui-scale,1))]",
                isEditMode ? "lg:grid-cols-2" : "lg:grid-cols-3",
            )}>
                <FormSwitchRow
                    data-component={`${base}_care-center-field`}
                    size="control"
                    title={t(locale, "clients.form.care-center")}
                    checked={formData.careCenter === true}
                    onToggle={() => handleChange("careCenter", !formData.careCenter)}
                    buttonAriaLabel={t(locale, "clients.form.care-center")}
                />
                <FormSwitchRow
                    data-component={`${base}_breast-pump-field`}
                    size="control"
                    title={t(locale, "clients.form.breast-pump")}
                    checked={formData.breastPump}
                    onToggle={() => handleChange("breastPump", !formData.breastPump)}
                    buttonAriaLabel={t(locale, "clients.form.breast-pump")}
                />
                {!isEditMode ? (
                    <FormSwitchRow
                        data-component={`${base}_message-automation-field`}
                        size="control"
                        title={t(locale, "clients.form.message-automation")}
                        checked={formData.applyMessageAutomation !== false}
                        onToggle={() => handleChange("applyMessageAutomation", formData.applyMessageAutomation === false)}
                        buttonAriaLabel={t(locale, "clients.form.message-automation")}
                    />
                ) : null}
            </div>
        </>
    );

    const dialogFormSteps = [
        <Fragment key="basic-info">{basicInfoSection}</Fragment>,
        <Fragment key="employee">{employeeSection}</Fragment>,
        <Fragment key="voucher-info">{voucherInfoSections}</Fragment>,
        <Fragment key="contract-info">{contractInfoSections}</Fragment>,
    ] as const;
    const panelFormSteps = [
        panelBasicInfoStep,
        panelEmployeeStep,
        panelVoucherInfoStep,
        panelContractInfoStep,
    ] as const;

    const formError = error ? (
        <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
        </Alert>
    ) : null;

    const formContent = surface === "panel" ? (
        <SteppedWizardPanelContent
            ref={contentRef}
            dataComponent={`${base}_content`}
            stepContentClassName={PANEL_STEP_CONTENT_CLASS_NAME}
            feedback={formError}
        >
            {panelFormSteps[activeStep]}
        </SteppedWizardPanelContent>
    ) : (
        <div
            ref={contentRef}
            data-component={`${base}_content`}
            className="space-y-5"
        >
            {formError}
            {dialogFormSteps}
        </div>
    );

    const panelFooter = panelFormActions;
    const employeeRegistrationDialog = (
        <EmployeeFormDialog
            open={isEmployeeDialogOpen}
            onClose={handleEmployeeDialogClose}
            onSuccess={handleEmployeeCreated}
        />
    );

    if (surface === "panel" && !open) {
        return null;
    }

    if (surface === "panel") {
        const panelLayout = renderLayout ? renderLayout({ content: formContent, footer: panelFooter }) : (
            <>
                {formContent}
                <footer data-component={`${base}_footer`} data-slot="detail-panel-footer" className={DETAIL_PANEL_FOOTER_CLASS_NAME}>
                    {panelFooter}
                </footer>
            </>
        );

        return (
            <>
                {panelLayout}
                {employeeRegistrationDialog}
            </>
        );
    }

    return (
        <>
            <Dialog data-component={`${base}`} open={open} onOpenChange={(isOpen) => !isOpen && handleDialogClose()}>
                <FormDialogShell
                    dataComponent={`${base}`}
                    title={formTitle}
                    contentClassName="space-y-5"
                    footer={dialogFormActions}
                >
                    {formContent}
                </FormDialogShell>
            </Dialog>
            {employeeRegistrationDialog}
        </>
    );
}
