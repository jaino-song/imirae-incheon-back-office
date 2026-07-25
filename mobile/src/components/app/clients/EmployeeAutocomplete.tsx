"use client";

import { useMemo } from "react";
import { UserPlus } from "lucide-react";

import { useEmployees, Employee } from "@/hooks/useEmployees";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";
import { Autocomplete } from "@/components/app/ui/Autocomplete";

function stripCityPrefix(area: string): string {
    return area.replace(/^인천\s*/, "");
}

function formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 11) return phone;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

interface EmployeeAutocompleteProps {
    "data-component"?: string;
    "data-testid"?: string;
    value: number | null;
    onChange: (employeeId: number | null, employee: Employee | null) => void;
    inputValue?: string;
    onInputValueChange?: (value: string) => void;
    label: string;
    required?: boolean;
    error?: boolean;
    helperText?: string;
    excludeIds?: number[];
    allowManualEntry?: boolean;
    manualEntryLabel?: string;
    manualEntryDescription?: string;
    onManualEntry?: (inputValue?: string) => void;
}

export function EmployeeAutocomplete({
    "data-component": dataComponent,
    value,
    onChange,
    inputValue,
    onInputValueChange,
    label,
    required = false,
    error = false,
    helperText,
    excludeIds = [],
    allowManualEntry = false,
    manualEntryLabel,
    manualEntryDescription,
    onManualEntry,
}: EmployeeAutocompleteProps) {
    const locale = useLocale();
    const { data: employees, isLoading } = useEmployees();
    const setPrefillName = useEmployeeDialogStore((state) => state.setPrefillName);

    const availableEmployees = useMemo(() => {
        if (!employees) return [];
        return employees.filter((emp) => !excludeIds.includes(emp.id));
    }, [employees, excludeIds]);

    const selectedEmployee = useMemo(() => {
        if (value === null || value === undefined || !employees) return null;
        return employees.find((emp) => emp.id === value) || null;
    }, [value, employees]);

    return (
        <Autocomplete<Employee>
            data-component={dataComponent}
            name="employee"
            value={selectedEmployee}
            onChange={(emp) => onChange(emp?.id ?? null, emp)}
            inputValue={inputValue}
            onInputValueChange={onInputValueChange}
            items={availableEmployees}
            isLoading={isLoading}
            getItemKey={(e) => e.id}
            getItemLabel={(e) => e.name}
            getItemHeaderExtra={(e, { highlighted }) => (
                <span
                    className={cn(
                        "text-xs tabular-nums",
                        highlighted ? "text-white/85" : "text-muted-foreground"
                    )}
                >
                    {formatPhone(e.phone)}
                </span>
            )}
            getItemMeta={(e, { highlighted }) => (
                <div className="flex flex-wrap items-center gap-1">
                    {e.workArea.map((area) => (
                        <span
                            key={area}
                            className={cn(
                                "px-2 py-0.5 rounded-full text-[0.7rem] font-medium",
                                highlighted
                                    ? "bg-white/20 text-white"
                                    : "bg-v3-primary-light text-v3-primary"
                            )}
                        >
                            {stripCityPrefix(area)}
                        </span>
                    ))}
                </div>
            )}
            filter={(e, q) =>
                matchesKoreanSearch(e.name, q) ||
                e.workArea.some((area) => area.toLowerCase().includes(q.toLowerCase())) ||
                e.phone.includes(q)
            }
            placeholder={t(locale, "clients.form.employee-search-placeholder")}
            label={label}
            required={required}
            error={error}
            helperText={helperText}
            emptyMessage={t(locale, "clients.form.no-employee-found")}
            manualEntry={
                allowManualEntry
                    ? {
                          label: manualEntryLabel ?? t(locale, "contract-msg.employee-manual-entry"),
                          description: manualEntryDescription ?? t(locale, "contract-msg.employee-manual-entry-description"),
                          icon: <UserPlus className="h-4 w-4" />,
                          onSelect: (query) => {
                              setPrefillName(query);
                              onManualEntry?.(query);
                          },
                      }
                    : undefined
            }
        />
    );
}
