"use client";

import { useState, useMemo, useRef } from "react";
import { UserPlus, FileCheck, ChevronsUpDown, Check, X, Loader2, Play } from "lucide-react";
import { useAllClients } from "@/hooks/useClients";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import type { Client } from "@/lib/client/types";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { formatKoreanPhoneNumber, normalizeKoreanPhoneLookupKey } from "@/lib/phone";
import { matchesSearchQuery } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { V3_INPUT_CONTROL_CLASS_NAME } from "@/components/ui/input";
import { getGlintUiScaleForViewport } from "@/components/app/v3/useGlintUiScale";
import { ClientFormDialog } from "./ClientFormDialog";

interface ClientAutocompleteProps {
    /** Caller-context canonical data-component base for this autocomplete instance. */
    "data-component"?: string;
    containerClassName?: string;
    value: number | null;
    onChange: (clientId: number | null, client: Client | null) => void;
    label: string;
    required?: boolean;
    error?: boolean;
    helperText?: string;
    placeholder?: string;
    excludeIds?: number[];
    allowManualEntry?: boolean;
    onManualEntry?: () => void;
    manualValue?: string;
    onManualValueChange?: (value: string) => void;
    displayValueMode?: "name" | "phone";
    searchMode?: "all" | "phone";
    disabled?: boolean;
}

export function ClientAutocomplete({
    "data-component": dataComponent = "desktop_clients_autocomplete",
    containerClassName,
    value,
    onChange,
    label,
    required = false,
    error = false,
    helperText,
    placeholder,
    excludeIds = [],
    allowManualEntry = true,
    onManualEntry,
    manualValue,
    onManualValueChange,
    displayValueMode = "name",
    searchMode = "all",
    disabled = false,
}: ClientAutocompleteProps) {
    const locale = useLocale();
    const { data: clients, isLoading } = useAllClients();
    const setPrefillName = useClientDialogStore((state) => state.setPrefillName);
    const clearPrefillName = useClientDialogStore((state) => state.clearPrefillName);
    const allowsInlineManualValue = typeof onManualValueChange === "function";

    // Track input value for display synchronization
    const [inputValue, setInputValue] = useState("");
    // Track open state for controlled dropdown behavior
    const [isOpen, setIsOpen] = useState(false);
    const [isRegistrationDialogOpen, setIsRegistrationDialogOpen] = useState(false);
    // Ref for focusing input after clear
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverSideOffset = -44 * (
        typeof window === "undefined"
            ? 1
            : getGlintUiScaleForViewport(window.innerWidth, window.innerHeight)
    );

    // Filter out excluded clients
    const availableClients = useMemo(() => {
        if (!clients) return [];
        return clients.filter((client) => !excludeIds.includes(client.id));
    }, [clients, excludeIds]);

    // Find selected client
    const selectedClient = useMemo(() => {
        if (value === null || value === undefined || !clients) return null;
        return clients.find((client) => client.id === value) || null;
    }, [value, clients]);

    const getClientDisplayValue = (client: Client | null) => {
        if (!client) return "";
        return displayValueMode === "phone" ? formatKoreanPhoneNumber(client.phone ?? "") : client.name;
    };

    const selectedClientDisplayValue = getClientDisplayValue(selectedClient);
    const manualDisplayValue =
        displayValueMode === "phone" ? formatKoreanPhoneNumber(manualValue ?? "") : manualValue ?? "";
    const inputDisplayValue =
        displayValueMode === "phone" ? formatKoreanPhoneNumber(inputValue) : inputValue;
    const commandInputValue = selectedClientDisplayValue || (allowsInlineManualValue ? manualDisplayValue : inputDisplayValue);

    // Filter clients based on input - Korean IME compatible
    const filteredClients = useMemo(() => {
        if (!commandInputValue.trim()) return [];

        return availableClients.filter((client) =>
            matchesSearchQuery(
                commandInputValue,
                searchMode === "phone"
                    ? [client.phone]
                    : [client.name, client.phone, client.address],
            ),
        );
    }, [availableClients, commandInputValue, searchMode]);

    const exactPhoneMatch = useMemo(() => {
        if (searchMode !== "phone") return null;
        const phoneQuery = normalizeKoreanPhoneLookupKey(commandInputValue);
        if (!phoneQuery) return null;

        return (
            filteredClients.find(
                (client) => normalizeKoreanPhoneLookupKey(client.phone ?? "") === phoneQuery,
            ) ?? null
        );
    }, [commandInputValue, filteredClients, searchMode]);

    const handleSelect = (client: Client) => {
        setInputValue(getClientDisplayValue(client));
        onChange(client.id, client);
        setIsOpen(false);
    };

    const clearSelection = () => {
        setInputValue("");
        onManualValueChange?.("");
        onChange(null, null);
        // Focus back to trigger for better UX
        setTimeout(() => triggerRef.current?.focus(), 0);
    };

    const handleClear = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        clearSelection();
    };

    const handleManualEntry = () => {
        setIsOpen(false);
        // Save the typed name to the store so ClientFormDialog can prefill it
        setPrefillName(commandInputValue);
        // Use setTimeout to ensure dropdown is fully closed before opening dialog
        setTimeout(() => {
            if (onManualEntry) {
                onManualEntry();
                return;
            }

            setIsRegistrationDialogOpen(true);
        }, 100);
    };

    const handleRegistrationDialogClose = () => {
        setIsRegistrationDialogOpen(false);
        clearPrefillName();
    };

    const handleRegistrationSuccess = (client: Client) => {
        handleRegistrationDialogClose();
        handleSelect(client);
    };

    const commitInlineManualValue = () => {
        if (!allowsInlineManualValue || !commandInputValue.trim()) return;

        if (exactPhoneMatch) {
            handleSelect(exactPhoneMatch);
            return;
        }

        if (value !== null) {
            onChange(null, null);
        }
        onManualValueChange?.(
            displayValueMode === "phone" ? formatKoreanPhoneNumber(commandInputValue) : commandInputValue,
        );
        setIsOpen(false);
        setTimeout(() => triggerRef.current?.focus(), 0);
    };

    const handleInputValueChange = (nextValue: string) => {
        const nextDisplayValue =
            displayValueMode === "phone" ? formatKoreanPhoneNumber(nextValue) : nextValue;

        setInputValue(nextDisplayValue);

        if (selectedClient && nextDisplayValue !== selectedClientDisplayValue) {
            onChange(null, null);
        }
        onManualValueChange?.(nextDisplayValue);
    };

    const displayValue = selectedClientDisplayValue || (allowsInlineManualValue ? manualDisplayValue : "");
    const hasDisplayValue = displayValue.trim().length > 0;
    const clearLabel = selectedClient
        ? "고객 선택 해제"
        : displayValueMode === "phone"
            ? "고객 연락처 입력 지우기"
            : "고객 이름 입력 지우기";
    const searchPlaceholder = placeholder ?? t(locale, "contract-msg.client-search-placeholder");

    return (
        <div
            data-component={dataComponent}
            className={cn("space-y-2", containerClassName)}
        >
            <Label
                className={cn(
                    "text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3] text-v3-text-muted",
                    error && "text-destructive",
                )}
            >
                {label}
                {required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Popover
                open={disabled ? false : isOpen}
                onOpenChange={(open) => {
                    if (disabled) return;
                    setIsOpen(open);
                }}
            >
                <div className="relative">
                    <PopoverTrigger asChild>
                        <Button
                            ref={triggerRef}
                            variant="outline"
                            role="combobox"
                            aria-label={label}
                            aria-expanded={disabled ? false : isOpen}
                            disabled={disabled}
                            data-component={`${dataComponent}_input`}
                            className={cn(
                                V3_INPUT_CONTROL_CLASS_NAME,
                                "w-full justify-between font-normal hover:bg-white",
                                hasDisplayValue
                                    ? "text-v3-dark hover:text-v3-dark"
                                    : "text-muted-foreground hover:text-muted-foreground",
                                error && "border-destructive focus:ring-destructive"
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate text-left">
                                {hasDisplayValue ? displayValue : searchPlaceholder}
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                                {isLoading && (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                                {hasDisplayValue && !isLoading && !disabled && (
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        aria-label={clearLabel}
                                        className="flex h-5 w-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                                        onPointerDown={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                        }}
                                        onClick={handleClear}
                                        onKeyDown={(event) => {
                                            if (event.key !== "Enter" && event.key !== " ") return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            clearSelection();
                                        }}
                                    >
                                        <X className="h-4 w-4" aria-hidden="true" />
                                    </span>
                                )}
                                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                            </div>
                        </Button>
                    </PopoverTrigger>
                </div>
                <PopoverContent
                    data-component={`${dataComponent}_dropdown`}
                    className="glint-ui-scale-scope w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-[22px] border-none bg-white p-0 text-v3-dark shadow-[0_0_0_2px_hsla(214,30%,40%,0.12),0_0_12px_hsla(214,30%,40%,0.05)]"
                    align="start"
                    sideOffset={popoverSideOffset}
                >
                    <Command shouldFilter={false} label={`${label} 검색`}>
                        <CommandInput
                            aria-label={`${label} 검색`}
                            placeholder={searchPlaceholder}
                            value={commandInputValue}
                            onValueChange={handleInputValueChange}
                            onKeyDown={(event) => {
                                if (
                                    event.key !== "Enter" ||
                                    event.nativeEvent.isComposing ||
                                    !allowsInlineManualValue
                                ) {
                                    return;
                                }

                                event.preventDefault();
                                event.stopPropagation();
                                commitInlineManualValue();
                            }}
                            endElement={
                                allowsInlineManualValue ? (
                                    <button
                                        type="button"
                                        aria-label="수동 입력으로 진행"
                                        title="수동 입력으로 진행"
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-transparent text-v3-primary transition-colors hover:text-v3-primary/80 disabled:cursor-not-allowed disabled:opacity-40"
                                        disabled={!commandInputValue.trim()}
                                        onClick={commitInlineManualValue}
                                    >
                                        <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                                    </button>
                                ) : undefined
                            }
                        />
                        <CommandList>
                            {isLoading ? (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            ) : filteredClients.length === 0 ? (
                                <CommandEmpty>
                                    <span className="text-muted-foreground">
                                        {t(locale, "contract-msg.no-client-found")}
                                    </span>
                                </CommandEmpty>
                            ) : (
                                <CommandGroup className="p-0">
                                    {filteredClients.map((client) => (
                                        <CommandItem
                                            key={client.id}
                                            value={client.id.toString()}
                                            onSelect={() => handleSelect(client)}
                                            className="group flex flex-col items-start gap-1 rounded-[16px] px-3 py-2.5 data-[selected=true]:not-hover:bg-transparent data-[selected=true]:not-hover:text-current hover:text-white hover:rounded-none"
                                        >
                                            <div className="flex items-center gap-2 w-full">
                                                <Check
                                                    className={cn(
                                                        "h-4 w-4 shrink-0",
                                                        selectedClient?.id === client.id
                                                            ? "opacity-100"
                                                            : "opacity-0"
                                                    )}
                                                />
                                                <span className="font-medium">{client.name}</span>
                                                {client.hasSigned && (
                                                    <StatusBadge variant="doc_completed" className="text-xs py-0 h-5">
                                                        <FileCheck className="h-3 w-3 mr-1" />
                                                        {t(locale, "contract-msg.client-signed")}
                                                    </StatusBadge>
                                                )}
                                            </div>
                                            <span className="text-xs text-muted-foreground ml-6 group-hover:text-white">
                                                {displayValueMode === "phone"
                                                    ? formatKoreanPhoneNumber(client.phone ?? "") || "-"
                                                    : client.phone || "-"}{" "}
                                                {client.address && `· ${client.address}`}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                        </CommandList>

                        {/* Manual Entry Footer */}
                        {allowManualEntry && (
                            <>
                                <CommandSeparator />
                                <button
                                    type="button"
                                    aria-label={t(locale, "contract-msg.manual-entry")}
                                    className="group flex w-full flex-col rounded-[16px] px-3 py-3 text-left transition-colors hover:bg-accent hover:text-white hover:rounded-t-none"
                                    onClick={handleManualEntry}
                                    data-testid="client-autocomplete-add-button"
                                >
                                    <div className="flex items-center gap-2">
                                        <UserPlus className="h-4 w-4" />
                                        <span className="text-sm font-medium text-primary group-hover:text-white">
                                            {t(locale, "contract-msg.manual-entry")}
                                        </span>
                                    </div>
                                    <span className="text-xs text-muted-foreground mt-1 group-hover:text-white">
                                        {t(locale, "contract-msg.manual-entry-description")}
                                    </span>
                                </button>
                            </>
                        )}
                    </Command>
                </PopoverContent>
            </Popover>
            {helperText && (
                <p className={cn("text-sm", error ? "text-destructive" : "text-muted-foreground")}>
                    {helperText}
                </p>
            )}

            {isRegistrationDialogOpen ? (
                <ClientFormDialog
                    data-component={`${dataComponent}_client-form-dialog`}
                    open
                    onClose={handleRegistrationDialogClose}
                    onSuccess={handleRegistrationSuccess}
                />
            ) : null}
        </div>
    );
}
