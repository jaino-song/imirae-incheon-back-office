"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
    findOutOfPocketPriceInfo,
    formatOutOfPocketDurationLabel,
} from "@babyjamjam/shared";
import { useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useOutOfPocketPriceInfos, useVoucherPriceInfos } from "@/hooks/useVoucherData";
import { EmployeeAutocomplete } from "./EmployeeAutocomplete";
import { EmployeeFormDialog } from "../employees/EmployeeFormDialog";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import type { Employee } from "@/hooks/useEmployees";
import {
    Client,
    CreateClientDto,
    UpdateClientDto,
    SERVICE_STATUS_OPTIONS,
    type ServiceStatus
} from "@/lib/client/types";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/errors/api-error-mapper";
import voucherOptions from "../messages/templates/json/voucher.json";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SelectGroup,
    SelectLabel,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TogglePill } from "@/components/app/ui/toggle-pill";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";

interface ClientFormDialogProps {
    open: boolean;
    onClose: () => void;
    client?: Client | null; // null/undefined for create mode, Client for edit mode
    onSuccess?: (client: Client) => void; // Optional callback when client is created/updated
}

// Format number with commas (handles comma-formatted strings too)
const CLIENT_FORM_DIALOG_BASE = "mobile_clients_form-dialog";

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

// Format ISO date string to yyyy-MM-dd for HTML date input
const formatDateForInput = (dateString: string | null | undefined): string => {
    if (!dateString) return "";
    // Handle ISO format (e.g., "2025-12-26T00:00:00.000Z")
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0];
};

export function ClientFormDialog({ open, onClose, client, onSuccess }: ClientFormDialogProps) {
    const locale = useLocale();
    const isEditMode = !!client;

    // Read pre-filled name from Zustand store (when opened from ClientAutocomplete)
    const prefillName = useClientDialogStore((state) => state.prefillName);
    const clearPrefillName = useClientDialogStore((state) => state.clearPrefillName);

    const createClient = useCreateClient();
    const updateClient = useUpdateClient();

    // Form state - use extended type to allow null for primaryEmployeeId during form editing
    const [formData, setFormData] = useState<Omit<CreateClientDto, 'primaryEmployeeId'> & { primaryEmployeeId: number | null }>({
        name: "",
        birthday: "",
        dueDate: "",
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
    });

    const [error, setError] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // State for EmployeeFormDialog
    const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
    const [employeeDialogTarget, setEmployeeDialogTarget] = useState<"primary" | "secondary" | null>(null);

    // Track if prices were manually edited
    const [pricesManuallyEdited, setPricesManuallyEdited] = useState(false);

    // Fetch voucher price info based on selected type
    const { data: voucherPriceInfos, isLoading: isPriceLoading } = useVoucherPriceInfos(formData.type || "");
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

    const durationOptions = useMemo(() => {
        if (!formData.voucherClient) {
            return (outOfPocketPriceInfos ?? []).map((priceInfo) => ({
                value: String(priceInfo.duration),
                label: formatOutOfPocketDurationLabel(priceInfo.duration),
            }));
        }
        return availableDurations.map((duration) => ({ value: String(duration), label: `${duration}일` }));
    }, [availableDurations, formData.voucherClient, outOfPocketPriceInfos]);

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

    // Reset duration when type changes
    const handleTypeChange = (newType: string) => {
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
        if (!open) {
            return;
        }

        const nextFormData = client
            ? {
                name: client.name,
                birthday: client.birthday || "",
                dueDate: formatDateForInput(client.dueDate),
                address: client.address || "",
                phone: client.phone || "",
                primaryEmployeeId: client.primaryEmployee?.id ?? null,
                secondaryEmployeeId: client.secondaryEmployee?.id ?? null,
                type: client.type || "",
                duration: client.duration,
                fullPrice: client.fullPrice || "",
                grant: client.grant || "",
                actualPrice: client.actualPrice || "",
                startDate: formatDateForInput(client.startDate),
                endDate: formatDateForInput(client.endDate),
                careCenter: client.careCenter,
                voucherClient: client.voucherClient,
                breastPump: client.breastPump,
                serviceStatus: client.serviceStatus || "pre_booking",
            }
            : {
                name: prefillName || "",
                birthday: "",
                dueDate: "",
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
                serviceStatus: "pre_booking" as const,
            };
        const nextPricesManuallyEdited = client
            ? Boolean(client.fullPrice || client.grant || client.actualPrice)
            : false;

        queueMicrotask(() => {
            setPricesManuallyEdited(nextPricesManuallyEdited);
            setFormData(nextFormData);
            if (!client) {
                clearPrefillName();
            }
            setError(null);
        });
    }, [open, client, prefillName, clearPrefillName]);

    const handleChange = (field: keyof CreateClientDto, value: unknown) => {
        setFormData(prev => ({ ...prev, [field]: value }));
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

    const handleSubmit = async () => {
        setError(null);

        // 고객 기본 정보만 필수이며 서비스 정보는 상담 단계에서 비워둘 수 있다.
        if (!formData.name.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-name-required"));
            return;
        }
        if (!formData.birthday?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-birthday-required"));
            return;
        }
        if (!formData.dueDate?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-due-date-required"));
            return;
        }
        if (!formData.address?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-address-required"));
            return;
        }
        if (!formData.phone?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-phone-required"));
            return;
        }
        try {
            if (isEditMode && client) {
                // Build update DTO, excluding null employee IDs to avoid validation errors
                // (backend @IsOptional only skips undefined, not null)
                const updateDto: UpdateClientDto = {
                    name: formData.name,
                    birthday: formData.birthday,
                    dueDate: formData.dueDate || null,
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
                    startDate: formData.startDate || null,
                    endDate: formData.endDate || null,
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
                    dueDate: formData.dueDate || null,
                    address: formData.address || null,
                    phone: formData.phone || null,
                    primaryEmployeeId: formData.primaryEmployeeId,
                    secondaryEmployeeId: formData.secondaryEmployeeId,
                    type: formData.voucherClient ? formData.type || null : null,
                    duration: formData.duration || null,
                    fullPrice: formData.fullPrice || null,
                    grant: formData.voucherClient ? formData.grant || null : "0",
                    actualPrice: formData.voucherClient ? formData.actualPrice || null : formData.fullPrice || null,
                    startDate: formData.startDate || null,
                    endDate: formData.endDate || null,
                    careCenter: formData.careCenter,
                    voucherClient: formData.voucherClient,
                    breastPump: formData.breastPump,
                    serviceStatus: formData.serviceStatus,
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

    return (
        <Dialog data-component={CLIENT_FORM_DIALOG_BASE} open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-xl" data-testid="client-form-dialog">
                <DialogHeader>
                    <DialogTitle>
                        {isEditMode
                            ? t(locale, "clients.form.edit-title")
                            : t(locale, "clients.form.add-title")
                        }
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {isEditMode
                            ? t(locale, "clients.form.edit-description")
                            : t(locale, "clients.form.add-description")
                        }
                    </DialogDescription>
                </DialogHeader>

                <div ref={contentRef} data-component={`${CLIENT_FORM_DIALOG_BASE}_content`} className="space-y-6 py-4">
                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* Basic Info Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-primary">
                            {t(locale, "clients.form.section-basic")}
                        </h4>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">
                                    {t(locale, "clients.form.name")}
                                    <span className="text-destructive ml-1">*</span>
                                </Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => handleChange("name", e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="birthday">{t(locale, "clients.form.birthday")}</Label>
                                <Input
                                    id="birthday"
                                    placeholder="YYMMDD"
                                    value={formData.birthday ?? ""}
                                    onChange={(e) => handleChange("birthday", e.target.value)}
                                    maxLength={6}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t(locale, "clients.form.birthday-helper")}
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="dueDate">{t(locale, "clients.form.due-date")}</Label>
                                <Input
                                    id="dueDate"
                                    type="date"
                                    value={formData.dueDate || ""}
                                    onChange={(e) => handleChange("dueDate", e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone">{t(locale, "clients.form.phone")}</Label>
                                <Input
                                    id="phone"
                                    placeholder="010-1234-5678"
                                    value={formData.phone ?? ""}
                                    onChange={(e) => handleChange("phone", formatPhoneNumber(e.target.value))}
                                    maxLength={13}
                                />
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="address">{t(locale, "clients.form.address")}</Label>
                                <Input
                                    id="address"
                                    value={formData.address ?? ""}
                                    onChange={(e) => handleChange("address", e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Employee Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-primary">
                            {t(locale, "clients.form.section-employee")}
                        </h4>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <EmployeeAutocomplete
                                data-component="mobile_clients_form-dialog_content_employee-grid_primary-autocomplete"
                                value={formData.primaryEmployeeId}
                                onChange={(id) => handleChange("primaryEmployeeId", id)}
                                label={t(locale, "clients.form.primary-employee")}
                                excludeIds={formData.secondaryEmployeeId != null ? [formData.secondaryEmployeeId] : []}
                                allowManualEntry
                                onManualEntry={() => {
                                    setEmployeeDialogTarget("primary");
                                    setIsEmployeeDialogOpen(true);
                                }}
                            />
                            <EmployeeAutocomplete
                                data-component="mobile_clients_form-dialog_content_employee-grid_secondary-autocomplete"
                                value={formData.secondaryEmployeeId ?? null}
                                onChange={(id) => handleChange("secondaryEmployeeId", id)}
                                label={t(locale, "clients.form.secondary-employee")}
                                excludeIds={formData.primaryEmployeeId != null ? [formData.primaryEmployeeId] : []}
                                allowManualEntry
                                onManualEntry={() => {
                                    setEmployeeDialogTarget("secondary");
                                    setIsEmployeeDialogOpen(true);
                                }}
                            />
                        </div>
                    </div>

                    <Separator />

                    {/* Service Info Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-primary">
                            {t(locale, "clients.form.section-service")}
                        </h4>

                        <div className="flex justify-center" data-component={`${CLIENT_FORM_DIALOG_BASE}_content_customer-type-toggle-field`}>
                            <TogglePill
                                data-component={`${CLIENT_FORM_DIALOG_BASE}_content_customer-type-toggle-field_toggle`}
                                value={formData.voucherClient}
                                onValueChange={handleVoucherClientChange}
                                leftLabel={t(locale, "clients.form.voucher-client")}
                                rightLabel={t(locale, "clients.form.self-pay-client")}
                                ariaLabel={t(locale, "clients.form.customer-type")}
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {formData.voucherClient && <div className="space-y-2">
                                <Label>{t(locale, "clients.form.voucher-type")}</Label>
                                <Select
                                    value={formData.type || ""}
                                    onValueChange={handleTypeChange}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t(locale, "clients.form.voucher-type")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
                                            <SelectGroup key={groupName}>
                                                <SelectLabel className="font-semibold">{groupName}</SelectLabel>
                                                {Object.entries(types).map(([typeValue, typeData]) => (
                                                    <SelectItem key={typeValue} value={typeValue} className="pl-6">
                                                        {typeData.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>}
                            <div className="space-y-2">
                                <Label>{t(locale, "clients.form.duration")}</Label>
                                <div className="relative">
                                    <Select
                                        value={formData.duration?.toString() || ""}
                                        onValueChange={(value) => {
                                            handleChange("duration", value ? Number(value) : null);
                                            // Reset manual edit flag when duration changes to allow auto-fill
                                            setPricesManuallyEdited(false);
                                        }}
                                        disabled={formData.voucherClient
                                            ? !formData.type || isPriceLoading
                                            : isOutOfPocketPriceLoading || isOutOfPocketPriceError}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder={t(locale, "clients.form.duration")} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {durationOptions.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {(formData.voucherClient ? isPriceLoading : isOutOfPocketPriceLoading) && (
                                        <div className="absolute right-10 top-1/2 -translate-y-1/2">
                                            <Spinner className="h-4 w-4" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        {!formData.voucherClient && isOutOfPocketPriceError && (
                            <p className="text-xs font-medium text-destructive" data-component={`${CLIENT_FORM_DIALOG_BASE}_content_out-of-pocket-price-error`}>
                                자부담 요금 정보를 불러오지 못했습니다.
                            </p>
                        )}
                    </div>

                    <Separator />

                    {/* Pricing Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium text-primary">
                                {t(locale, "clients.form.section-pricing")}
                            </h4>
                            {selectedPriceInfo && !pricesManuallyEdited && (
                                <StatusBadge variant="doc_requested" size="sm">
                                    {t(locale, "clients.form.auto-filled")}
                                </StatusBadge>
                            )}
                        </div>

                        <div className={formData.voucherClient ? "grid grid-cols-1 sm:grid-cols-3 gap-4" : "grid grid-cols-1 gap-4"}>
                            <div className="space-y-2">
                                <Label htmlFor="fullPrice">{t(locale, "clients.form.full-price")}</Label>
                                <div className="relative">
                                    <Input
                                        id="fullPrice"
                                        placeholder="0"
                                        value={arePriceInputsLocked ? "" : formatPrice(formData.fullPrice || "")}
                                        onChange={(e) => handlePriceChange("fullPrice", e.target.value.replace(/,/g, ""))}
                                        disabled={arePriceInputsLocked}
                                        className="pr-8"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                        원
                                    </span>
                                </div>
                            </div>
                            {formData.voucherClient && <div className="space-y-2">
                                <Label htmlFor="grant">{t(locale, "clients.form.grant")}</Label>
                                <div className="relative">
                                    <Input
                                        id="grant"
                                        placeholder="0"
                                        value={formatPrice(formData.grant || "")}
                                        onChange={(e) => handlePriceChange("grant", e.target.value.replace(/,/g, ""))}
                                        className="pr-8"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                        원
                                    </span>
                                </div>
                            </div>}
                            {formData.voucherClient && <div className="space-y-2">
                                <Label htmlFor="actualPrice">{t(locale, "clients.form.actual-price")}</Label>
                                <div className="relative">
                                    <Input
                                        id="actualPrice"
                                        placeholder="0"
                                        value={formatPrice(formData.actualPrice || "")}
                                        onChange={(e) => handlePriceChange("actualPrice", e.target.value.replace(/,/g, ""))}
                                        className="pr-8"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                        원
                                    </span>
                                </div>
                            </div>}
                        </div>
                    </div>

                    <Separator />

                    {/* Contract Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-primary">
                            {t(locale, "clients.form.section-contract")}
                        </h4>

                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                            <div className="space-y-2 sm:col-span-2">
                                <Label>{t(locale, "clients.form.contract-status")}</Label>
                                <Select
                                    value={formData.serviceStatus || ""}
                                    onValueChange={(value) => handleChange("serviceStatus", value as ServiceStatus)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t(locale, "clients.form.contract-status")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {SERVICE_STATUS_OPTIONS.map((status) => (
                                            <SelectItem key={status.value} value={status.value}>
                                                {status.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="startDate">{t(locale, "clients.form.start-date")}</Label>
                                <Input
                                    id="startDate"
                                    type="date"
                                    value={formData.startDate || ""}
                                    onChange={(e) => handleChange("startDate", e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="endDate">{t(locale, "clients.form.end-date")}</Label>
                                <Input
                                    id="endDate"
                                    type="date"
                                    value={formData.endDate || ""}
                                    onChange={(e) => handleChange("endDate", e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Flags Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-primary">
                            {t(locale, "clients.form.section-flags")}
                        </h4>

                        <div className="flex flex-wrap gap-6">
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="careCenter"
                                    checked={formData.careCenter}
                                    onCheckedChange={(checked) => handleChange("careCenter", checked)}
                                />
                                <Label htmlFor="careCenter" className="cursor-pointer">
                                    {t(locale, "clients.form.care-center")}
                                </Label>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="breastPump"
                                    checked={formData.breastPump}
                                    onCheckedChange={(checked) => handleChange("breastPump", checked)}
                                />
                                <Label htmlFor="breastPump" className="cursor-pointer">
                                    {t(locale, "clients.form.breast-pump")}
                                </Label>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter data-component={`${CLIENT_FORM_DIALOG_BASE}_actions`}>
                    <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                        {t(locale, "common.cancel")}
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? (
                            <Spinner className="h-4 w-4" />
                        ) : isEditMode ? (
                            t(locale, "common.save")
                        ) : (
                            t(locale, "common.create")
                        )}
                    </Button>
                </DialogFooter>

                {/* Nested EmployeeFormDialog for adding new employees */}
                <EmployeeFormDialog
                    open={isEmployeeDialogOpen}
                    onClose={() => {
                        setIsEmployeeDialogOpen(false);
                        setEmployeeDialogTarget(null);
                    }}
                    onSuccess={(newEmployee: Employee) => {
                        // Auto-select the newly created employee in the appropriate field
                        if (employeeDialogTarget === "primary") {
                            handleChange("primaryEmployeeId", newEmployee.id);
                        } else if (employeeDialogTarget === "secondary") {
                            handleChange("secondaryEmployeeId", newEmployee.id);
                        }
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}
