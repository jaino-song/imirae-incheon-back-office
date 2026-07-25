"use client";

import {
    useState,
    useMemo,
    useEffect,
    useRef,
    type ReactNode,
} from "react";
import { Check, ChevronDown, X, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/app/v3";

export interface AutocompleteManualEntry {
    label: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
    onSelect: (query: string) => void;
}

export interface AutocompleteItemContext {
    highlighted: boolean;
    selected: boolean;
}

export interface AutocompleteProps<T> {
    name: string;
    "data-component"?: string;
    inputId?: string;
    value: T | null;
    onChange: (item: T | null) => void;
    inputValue?: string;
    onInputValueChange?: (value: string) => void;
    items: T[];
    isLoading?: boolean;
    getItemKey: (item: T) => string | number;
    getItemLabel: (item: T) => string;
    getItemMeta?: (item: T, ctx: AutocompleteItemContext) => ReactNode;
    getItemHeaderExtra?: (item: T, ctx: AutocompleteItemContext) => ReactNode;
    filter?: (item: T, query: string) => boolean;
    placeholder?: string;
    label?: ReactNode;
    required?: boolean;
    error?: boolean;
    helperText?: ReactNode;
    emptyMessage?: ReactNode;
    manualEntry?: AutocompleteManualEntry;
    disabled?: boolean;
    className?: string;
}

export function Autocomplete<T>({
    name,
    "data-component": dataComponent,
    inputId,
    value,
    onChange,
    inputValue: controlledInputValue,
    onInputValueChange,
    items,
    isLoading = false,
    getItemKey,
    getItemLabel,
    getItemMeta,
    getItemHeaderExtra,
    filter,
    placeholder,
    label,
    required,
    error,
    helperText,
    emptyMessage,
    manualEntry,
    disabled = false,
    className,
}: AutocompleteProps<T>) {
    const [uncontrolledInputValue, setUncontrolledInputValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [isToggledOpen, setIsToggledOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const suppressedClickTokenRef = useRef<string | null>(null);
    const selectedInputValue = value ? getItemLabel(value) : "";
    const currentInputValue = controlledInputValue ?? uncontrolledInputValue;
    const isInputControlled = controlledInputValue !== undefined;
    const updateInputValue = (next: string) => {
        if (!isInputControlled) setUncontrolledInputValue(next);
        onInputValueChange?.(next);
    };
    const openDropdown = () => {
        if (disabled) return;
        setIsFocused(true);
        setIsToggledOpen(true);
    };
    const isEditingInput = isFocused || isToggledOpen;
    const displayInputValue = isEditingInput
        ? currentInputValue
        : selectedInputValue || currentInputValue;

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsFocused(false);
                setIsToggledOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const filteredItems = useMemo(() => {
        const query = displayInputValue.trim();
        if (!query) return items;
        if (filter) return items.filter((item) => filter(item, query));
        return items.filter((item) =>
            getItemLabel(item).toLowerCase().includes(query.toLowerCase())
        );
    }, [items, displayInputValue, filter, getItemLabel]);

    const showDropdown = !disabled && (isFocused || isToggledOpen);
    const optionCount = filteredItems.length + (manualEntry ? 1 : 0);
    const activeHighlightedIndex =
        highlightedIndex >= 0 && highlightedIndex < optionCount ? highlightedIndex : -1;

    const handleSelect = (item: T) => {
        if (disabled) return;
        updateInputValue(getItemLabel(item));
        onChange(item);
        setIsFocused(false);
        setIsToggledOpen(false);
        inputRef.current?.blur();
    };

    const handleClear = () => {
        if (disabled) return;
        updateInputValue("");
        onChange(null);
        setIsFocused(false);
        setIsToggledOpen(false);
        inputRef.current?.blur();
    };

    const handleManualEntry = () => {
        if (disabled) return;
        const query = currentInputValue;
        setIsFocused(false);
        setIsToggledOpen(false);
        setTimeout(() => manualEntry?.onSelect(query), 100);
    };

    const markSuppressedClick = (token: string) => {
        suppressedClickTokenRef.current = token;
        window.setTimeout(() => {
            if (suppressedClickTokenRef.current === token) {
                suppressedClickTokenRef.current = null;
            }
        }, 0);
    };

    const shouldSkipClick = (token: string) => {
        if (suppressedClickTokenRef.current !== token) {
            return false;
        }

        suppressedClickTokenRef.current = null;
        return true;
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (disabled) return;
        if (!showDropdown) return;
        const total = filteredItems.length + (manualEntry ? 1 : 0);
        if (total === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightedIndex((prev) => (prev + 1) % total);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightedIndex((prev) => (prev - 1 + total) % total);
        } else if (e.key === "Enter") {
            if (activeHighlightedIndex >= 0) {
                e.preventDefault();
                if (activeHighlightedIndex < filteredItems.length) {
                    handleSelect(filteredItems[activeHighlightedIndex]);
                } else if (manualEntry) {
                    handleManualEntry();
                }
            } else if (
                manualEntry &&
                filteredItems.length === 0 &&
                currentInputValue.trim().length > 0
            ) {
                e.preventDefault();
                handleManualEntry();
            }
        } else if (e.key === "Escape") {
            setIsFocused(false);
            setIsToggledOpen(false);
            inputRef.current?.blur();
        }
    };

    const legacyBase = `${name}-autocomplete`;
    const containerDc = dataComponent ?? legacyBase;
    const sub = (suffix: string) =>
        dataComponent ? `${dataComponent}_${suffix}` : `${legacyBase}-${suffix}`;
    const inputDc = sub("input");
    const toggleDc = sub("toggle");
    const dropdownDc = sub("dropdown");
    const addBtnDc = sub("add-button");
    const clearBtnDc = sub("clear");
    const resolvedInputId = inputId ?? name;

    return (
        <div
            data-component={containerDc}
            data-source-component="Autocomplete"
            data-testid={containerDc}
            data-disabled={disabled ? "true" : undefined}
            className={cn("space-y-2", className)}
        >
            {label && (
                <Label
                    htmlFor={resolvedInputId}
                    data-component={sub("label")}
                    className={cn(error && "text-destructive")}
                >
                    {label}
                    {required && (
                        <span data-component={sub("required")} className="text-destructive ml-1">
                            *
                        </span>
                    )}
                </Label>
            )}
            <div ref={containerRef} data-component={sub("control")} className="relative">
                <Input
                    id={resolvedInputId}
                    ref={inputRef}
                    type="text"
                    value={displayInputValue}
                    onChange={(e) => {
                        updateInputValue(e.target.value);
                        setHighlightedIndex(-1);
                        openDropdown();
                    }}
                    onClick={openDropdown}
                    onFocus={() => {
                        updateInputValue(selectedInputValue || currentInputValue);
                        setHighlightedIndex(-1);
                        openDropdown();
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    disabled={disabled}
                    data-component={inputDc}
                    data-state={showDropdown ? "open" : "closed"}
                    className={cn(
                        "h-[44px] pr-24 data-[state=open]:!rounded-b-none data-[state=open]:!shadow-none",
                        !error &&
                            "data-[state=open]:!border-input data-[state=open]:focus:!border-input data-[state=open]:focus-visible:!border-input",
                        error && "border-destructive"
                    )}
                />
                <div
                    data-component={sub("actions")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1"
                >
                    {value && !isLoading && !disabled && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="flex h-[44px] w-[44px] items-center justify-center rounded-2xl"
                            aria-label="선택 해제"
                            data-component={clearBtnDc}
                        >
                            <X className="h-3.5 w-3.5 translate-x-[9px] text-muted-foreground hover:text-foreground" />
                        </button>
                    )}
                    {isLoading && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {!value && !isLoading && !disabled ? (
                        <button
                            type="button"
                            onClick={() => {
                                if (showDropdown) {
                                    setIsToggledOpen(false);
                                    setIsFocused(false);
                                    inputRef.current?.blur();
                                } else {
                                    updateInputValue(selectedInputValue || currentInputValue);
                                    setHighlightedIndex(-1);
                                    setIsToggledOpen(true);
                                    inputRef.current?.focus();
                                }
                            }}
                            className="flex h-[44px] w-[44px] items-center justify-center rounded-2xl"
                            aria-label="목록 열기"
                            data-component={toggleDc}
                        >
                            <ChevronDown className="size-4 translate-x-[9px] text-muted-foreground opacity-50" />
                        </button>
                    ) : null}
                </div>

                {showDropdown && (
                    <div
                        data-component={dropdownDc}
                        data-testid={dropdownDc}
                        data-state="open"
                        className="absolute top-full left-0 right-0 z-50 overflow-hidden rounded-2xl !rounded-t-none border !border-v3-border bg-white shadow-[0_4px_16px_rgba(0,0,0,0.06)] animate-in fade-in-0 zoom-in-95"
                    >
                        {isLoading ? (
                            <div data-component={sub("loading")} className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : filteredItems.length === 0 ? (
                            <div data-component={sub("empty")} className="py-6 text-center text-sm text-muted-foreground">
                                {emptyMessage ?? "결과 없음"}
                            </div>
                        ) : (
                            <div data-component={sub("options")} className="max-h-[200px] overflow-y-auto">
                                {filteredItems.map((item, index) => {
                                    const selected =
                                        value != null &&
                                        getItemKey(value) === getItemKey(item);
                                    const highlighted = activeHighlightedIndex === index;
                                    const ctx = { highlighted, selected };
                                    const meta = getItemMeta?.(item, ctx);
                                    const headerExtra = getItemHeaderExtra?.(item, ctx);
                                    return (
                                        <div
                                            key={getItemKey(item)}
                                            data-component={sub(`option-${index + 1}`)}
                                            onPointerDown={(e) => {
                                                e.preventDefault();
                                                markSuppressedClick(`item:${getItemKey(item)}`);
                                                handleSelect(item);
                                            }}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                if (shouldSkipClick(`item:${getItemKey(item)}`)) {
                                                    return;
                                                }
                                                handleSelect(item);
                                            }}
                                            onMouseEnter={() => setHighlightedIndex(index)}
                                            className={cn(
                                                "flex flex-col items-start px-3 py-2 cursor-pointer transition-colors",
                                                highlighted && "bg-v3-primary text-white",
                                                selected && !highlighted && "bg-v3-primary/10"
                                            )}
                                        >
                                            <div
                                                data-component={sub(`option-${index + 1}-header`)}
                                                className="flex items-center gap-2 w-full"
                                            >
                                                <Check
                                                    className={cn(
                                                        "h-4 w-4 shrink-0",
                                                        selected ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                                <span
                                                    data-component={sub(`option-${index + 1}-label`)}
                                                    className="font-medium text-sm"
                                                >
                                                    {getItemLabel(item)}
                                                </span>
                                                {headerExtra}
                                            </div>
                                            {meta != null && meta !== "" && (
                                                <div
                                                    data-component={sub(`option-${index + 1}-meta`)}
                                                    className={cn(
                                                        "text-xs ml-6 mt-1",
                                                        !highlighted && "text-muted-foreground"
                                                    )}
                                                >
                                                    {meta}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {manualEntry && (
                            <>
                                <div data-component={sub("manual-divider")} className="h-px bg-v3-border" />
                                <div
                                    onPointerDown={(e) => {
                                        e.preventDefault();
                                        markSuppressedClick("manual-entry");
                                        handleManualEntry();
                                    }}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        if (shouldSkipClick("manual-entry")) {
                                            return;
                                        }
                                        handleManualEntry();
                                    }}
                                    onMouseEnter={() =>
                                        setHighlightedIndex(filteredItems.length)
                                    }
                                    className={cn(
                                        "flex flex-col w-full py-3 px-3 cursor-pointer transition-colors",
                                        activeHighlightedIndex === filteredItems.length &&
                                            "bg-v3-primary text-white"
                                    )}
                                    data-component={addBtnDc}
                                    data-testid={addBtnDc}
                                >
                                    <div data-component={sub("manual-header")} className="flex items-center gap-2">
                                        {manualEntry.icon}
                                        <span
                                            data-component={sub("manual-label")}
                                            className={cn(
                                                "text-sm font-medium",
                                                activeHighlightedIndex !== filteredItems.length &&
                                                    "text-primary"
                                            )}
                                        >
                                            {manualEntry.label}
                                        </span>
                                    </div>
                                    {manualEntry.description && (
                                        <span
                                            data-component={sub("manual-description")}
                                            className={cn(
                                                "text-xs mt-1 ml-6",
                                                activeHighlightedIndex !== filteredItems.length &&
                                                    "text-muted-foreground"
                                            )}
                                        >
                                            {manualEntry.description}
                                        </span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {helperText && (
                <p
                    data-component={sub("helper")}
                    className={cn(
                        "text-xs",
                        error ? "text-destructive" : "text-muted-foreground"
                    )}
                >
                    {helperText}
                </p>
            )}
        </div>
    );
}
