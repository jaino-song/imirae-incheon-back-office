"use client";

import { useState, useMemo, useRef } from "react";
import { Check, ChevronsUpDown, UserPlus, X, Loader2, Play } from "lucide-react";
import { useEmployees, Employee } from "@/hooks/useEmployees";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import { matchesSearchQuery } from "@/lib/search/korean-search";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { V3_INPUT_CONTROL_CLASS_NAME } from "@/components/ui/input";
import { getGlintUiScaleForViewport } from "@/components/app/v3/useGlintUiScale";
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

interface EmployeeAutocompleteProps {
    /** Caller-context canonical data-component base for this autocomplete instance. */
    "data-component"?: string;
    "data-testid"?: string;
    containerClassName?: string;
    value: number | null;
    onChange: (employeeId: number | null, employee: Employee | null) => void;
    label: string;
    required?: boolean;
    error?: boolean;
    helperText?: string;
    excludeIds?: number[];
    allowManualEntry?: boolean;
    onManualEntry?: (inputValue?: string) => void;
    allowManualInput?: boolean;
    manualValue?: string;
    onManualInputChange?: (value: string) => void;
    placeholder?: string;
    displayValueMode?: "name" | "phone";
    searchMode?: "all" | "phone";
}

export function EmployeeAutocomplete({
    "data-component": dataComponent = "desktop_clients_employee-autocomplete",
    containerClassName,
    value,
    onChange,
    label,
    required = false,
    error = false,
    helperText,
    excludeIds = [],
    allowManualEntry = true,
    onManualEntry,
    allowManualInput = false,
    manualValue = "",
    onManualInputChange,
    placeholder,
    displayValueMode = "name",
    searchMode = "all",
    "data-testid": dataTestId,
}: EmployeeAutocompleteProps) {
    const locale = useLocale();
    const { data: employees, isLoading, refetch } = useEmployees();
    const setPrefillName = useEmployeeDialogStore((state) => state.setPrefillName);
    const clearPrefillName = useEmployeeDialogStore((state) => state.clearPrefillName);

    const [isOpen, setIsOpen] = useState(false);
    const [isRegistrationDialogOpen, setIsRegistrationDialogOpen] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverSideOffset = -44 * (
        typeof window === "undefined"
            ? 1
            : getGlintUiScaleForViewport(window.innerWidth, window.innerHeight)
    );

    const availableEmployees = useMemo(() => {
        if (!employees) return [];
        return employees.filter((emp) => !excludeIds.includes(emp.id));
    }, [employees, excludeIds]);

    const selectedEmployee = useMemo(() => {
        if (value === null || value === undefined || !employees) return null;
        return employees.find((emp) => emp.id === value) || null;
    }, [value, employees]);

    const selectedEmployeeDisplayValue = selectedEmployee
        ? displayValueMode === "phone"
            ? formatKoreanPhoneNumber(selectedEmployee.phone)
            : selectedEmployee.name
        : "";
    const manualDisplayValue = displayValueMode === "phone"
        ? formatKoreanPhoneNumber(manualValue)
        : manualValue.trim();
    const commandInputValue = selectedEmployeeDisplayValue || manualDisplayValue || inputValue;
    const searchPlaceholder = placeholder ?? t(locale, "clients.form.employee-search-placeholder");

    const filteredEmployees = useMemo(() => {
        if (!commandInputValue.trim()) return [];
        const searchTerm = commandInputValue.trim();

        return availableEmployees.filter((emp) =>
            matchesSearchQuery(
                searchTerm,
                searchMode === "phone"
                    ? [emp.phone]
                    : [emp.name, emp.phone, ...emp.workArea],
            ),
        );
    }, [availableEmployees, commandInputValue, searchMode]);

    const hasDisplayValue = Boolean(selectedEmployee || manualDisplayValue);

    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        // 제공인력 목록 캐시는 창(탭)마다 따로 유지되어, 다른 창에서 등록한 인력이 반영되지 않는다.
        // 드롭다운을 여는 시점이 곧 최신 목록이 필요한 시점이므로 그때 다시 불러온다.
        if (open) {
            void refetch();
        }
        if (open && !selectedEmployee) {
            setInputValue(
                displayValueMode === "phone"
                    ? formatKoreanPhoneNumber(manualValue)
                    : manualValue,
            );
        }
    };

    const handleInputValueChange = (value: string) => {
        const nextValue = displayValueMode === "phone"
            ? formatKoreanPhoneNumber(value)
            : value;
        setInputValue(nextValue);
        if (allowManualInput && !selectedEmployee) {
            onManualInputChange?.(nextValue);
        }
    };

    const handleSelect = (employee: Employee) => {
        onChange(employee.id, employee);
        setIsOpen(false);
        setInputValue(
            displayValueMode === "phone"
                ? formatKoreanPhoneNumber(employee.phone)
                : employee.name,
        );
    };

    const clearSelection = () => {
        onChange(null, null);
        onManualInputChange?.("");
        setInputValue("");
    };

    const handleClear = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        clearSelection();
    };

    const commitManualInput = () => {
        if (!allowManualInput || selectedEmployee || !commandInputValue.trim()) return;

        onManualInputChange?.(commandInputValue);
        setIsOpen(false);
        setTimeout(() => triggerRef.current?.focus(), 0);
    };

    const handleManualEntry = () => {
        setPrefillName(commandInputValue);
        setIsOpen(false);
        setTimeout(() => {
            if (onManualEntry) {
                onManualEntry(commandInputValue);
                return;
            }

            setIsRegistrationDialogOpen(true);
        }, 100);
    };

    const handleRegistrationDialogClose = () => {
        setIsRegistrationDialogOpen(false);
        clearPrefillName();
    };

    const handleRegistrationSuccess = (employee: Employee) => {
        handleRegistrationDialogClose();
        handleSelect(employee);
    };

    return (
        <div
            data-component={dataComponent}
            className={cn("space-y-2", containerClassName)}
            data-testid={dataTestId ?? "employee-autocomplete"}
        >
            {label && (
                <Label
                    className={cn(
                        "text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3] text-v3-text-muted",
                        error && "text-destructive",
                    )}
                >
                    {label}
                    {required && <span className="text-destructive ml-1">*</span>}
                </Label>
            )}
            <Popover open={isOpen} onOpenChange={handleOpenChange}>
                <div className="relative">
                    <PopoverTrigger asChild>
                        <Button
                            ref={triggerRef}
                            variant="outline"
                            role="combobox"
                            aria-label={label}
                            aria-expanded={isOpen}
                            data-component={`${dataComponent}_input`}
                            className={cn(
                                V3_INPUT_CONTROL_CLASS_NAME,
                                "w-full justify-between font-normal hover:bg-white",
                                hasDisplayValue
                                    ? "text-v3-dark hover:text-v3-dark"
                                    : "text-muted-foreground hover:text-muted-foreground",
                                error && "border-destructive focus:ring-destructive",
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate text-left">
                                {selectedEmployee
                                    ? selectedEmployeeDisplayValue
                                    : manualDisplayValue
                                      ? manualDisplayValue
                                    : searchPlaceholder}
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                                {isLoading && (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                                {hasDisplayValue && !isLoading && (
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        aria-label="제공인력 선택 해제"
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
                                    !allowManualInput
                                ) {
                                    return;
                                }

                                event.preventDefault();
                                event.stopPropagation();
                                commitManualInput();
                            }}
                            endElement={
                                allowManualInput && !selectedEmployee ? (
                                    <button
                                        type="button"
                                        aria-label="수동 입력으로 진행"
                                        title="수동 입력으로 진행"
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-transparent text-v3-primary transition-colors hover:text-v3-primary/80 disabled:cursor-not-allowed disabled:opacity-40"
                                        disabled={!commandInputValue.trim()}
                                        onClick={commitManualInput}
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
                            ) : filteredEmployees.length === 0 ? (
                                <CommandEmpty>
                                    <span className="text-muted-foreground">
                                        {t(locale, "clients.form.no-employee-found")}
                                    </span>
                                </CommandEmpty>
                            ) : (
                                <CommandGroup className="p-0">
                                    {filteredEmployees.map((employee) => (
                                        <CommandItem
                                            key={employee.id}
                                            value={employee.id.toString()}
                                            onSelect={() => handleSelect(employee)}
                                            className="group flex flex-col items-start gap-1 rounded-[16px] px-3 py-2.5 data-[selected=true]:not-hover:bg-transparent data-[selected=true]:not-hover:text-current hover:text-white hover:rounded-none"
                                        >
                                            <div className="flex items-center gap-2 w-full">
                                                <Check
                                                    className={cn(
                                                        "h-4 w-4 shrink-0",
                                                        selectedEmployee?.id === employee.id
                                                            ? "opacity-100"
                                                            : "opacity-0",
                                                    )}
                                                />
                                                <span className="font-medium">{employee.name}</span>
                                            </div>
                                            <span className="text-xs text-muted-foreground ml-6 group-hover:text-white">
                                                {employee.workArea.join(", ")} · {formatKoreanPhoneNumber(employee.phone) || "-"}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                        </CommandList>

                        {allowManualEntry && (
                            <>
                                <CommandSeparator />
                                <button
                                    type="button"
                                    aria-label={t(locale, "contract-msg.employee-manual-entry")}
                                    className="group flex w-full flex-col rounded-[16px] px-3 py-3 text-left transition-colors hover:bg-accent hover:text-white hover:rounded-t-none"
                                    onClick={handleManualEntry}
                                    data-testid="employee-autocomplete-add-button"
                                >
                                    <div className="flex items-center gap-2">
                                        <UserPlus className="h-4 w-4" />
                                        <span className="text-sm font-medium text-primary group-hover:text-white">
                                            {t(locale, "contract-msg.employee-manual-entry")}
                                        </span>
                                    </div>
                                    <span className="text-xs text-muted-foreground mt-1 group-hover:text-white">
                                        {t(locale, "contract-msg.employee-manual-entry-description")}
                                    </span>
                                </button>
                            </>
                        )}
                    </Command>
                </PopoverContent>
            </Popover>

            {helperText && (
                <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
                    {helperText}
                </p>
            )}

            {isRegistrationDialogOpen ? (
                <EmployeeFormDialog
                    open
                    onClose={handleRegistrationDialogClose}
                    onSuccess={handleRegistrationSuccess}
                />
            ) : null}
        </div>
    );
}
