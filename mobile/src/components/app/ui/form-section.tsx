"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

const FORM_SECTION_SOURCE_COMPONENT = "FormSection";
const FORM_NATIVE_SELECT_SOURCE_COMPONENT = "FormNativeSelect";
// TODO(data-component): Remove legacy fallback data-component="form-section" after caller migration.

export interface FormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  "data-component"?: string;
  title: string;
  badge?: React.ReactNode;
  showSeparator?: boolean;
}

function FormSection({
  "data-component": dataComponent,
  title,
  badge,
  showSeparator = false,
  className,
  children,
  ...props
}: FormSectionProps) {
  return (
    <>
      {showSeparator && <Separator className="my-4" />}
      <div
        {...props}
        // TODO(data-component): Remove the legacy fallback after caller migration.
        data-component={dataComponent ?? "form-section"}
        data-source-component={FORM_SECTION_SOURCE_COMPONENT}
        className={cn("space-y-3", className)}
      >
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-primary">{title}</h4>
          {badge}
        </div>
        {children}
      </div>
    </>
  );
}

export interface FormNativeSelectOption {
  value: string;
  label: string;
}

export interface FormNativeSelectGroup {
  label: string;
  options: readonly FormNativeSelectOption[];
}

type FormNativeSelectEntry = FormNativeSelectOption | FormNativeSelectGroup;

export interface FormNativeSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  "data-component"?: string;
  options: readonly FormNativeSelectEntry[];
  onValueChange?: (value: string) => void;
  placeholder?: string;
  hideIcon?: boolean;
  wrapClassName?: string;
  wrapDataComponent?: string;
  selectDataComponent?: string;
  iconDataComponent?: string;
}

function isFormNativeSelectGroup(option: FormNativeSelectEntry): option is FormNativeSelectGroup {
  return "options" in option;
}

function FormNativeSelect({
  "data-component": dataComponent,
  options,
  onValueChange,
  placeholder,
  hideIcon = false,
  wrapClassName,
  className,
  wrapDataComponent = "form-native-select-wrap",
  selectDataComponent = "form-native-select",
  iconDataComponent = "form-native-select-icon",
  value,
  ...props
}: FormNativeSelectProps) {
  // TODO(data-component): Remove the legacy fallbacks after caller migration.
  const rootDataComponent = dataComponent ?? wrapDataComponent;
  const selectComponent = dataComponent ? `${dataComponent}_select` : selectDataComponent;
  const iconComponent = dataComponent ? `${dataComponent}_icon` : iconDataComponent;

  return (
    <div
      data-component={rootDataComponent}
      data-source-component={FORM_NATIVE_SELECT_SOURCE_COMPONENT}
      className={cn("relative", wrapClassName)}
    >
      <select
        data-component={selectComponent}
        className={cn(
          "box-border h-[44px] w-full appearance-none rounded-[12px] border-[1.5px] border-input bg-white px-[14px] py-0 pr-[38px] text-[0.9rem] leading-normal text-v3-dark outline-none focus:border-v3-primary disabled:cursor-not-allowed disabled:bg-[hsl(220_20%_97%)] disabled:opacity-55",
          value === "" && "text-v3-text-muted",
          className,
        )}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
        {...props}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) =>
          isFormNativeSelectGroup(option) ? (
            <optgroup key={option.label} label={option.label}>
              {option.options.map((groupOption) => (
                <option key={groupOption.value} value={groupOption.value}>
                  {groupOption.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ),
        )}
      </select>
      {hideIcon ? null : (
        <ChevronDown
          data-component={iconComponent}
          className="pointer-events-none absolute right-[14px] top-1/2 h-4 w-4 -translate-y-1/2 text-v3-text-muted"
          aria-hidden="true"
          strokeWidth={2.2}
        />
      )}
    </div>
  );
}

export { FormNativeSelect, FormSection };
