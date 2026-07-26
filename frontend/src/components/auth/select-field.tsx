import * as React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { InlineFieldError } from "@/components/auth/inline-field-error";
import { AUTH_FIELD_CONTROL_CLASS_NAME } from "@/components/auth/field-styles";

interface SelectFieldProps {
  label: string;
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  options: { value: string; label: string }[];
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  hideErrorMessage?: boolean;
  labelTrailing?: React.ReactNode;
  errorDisplay?: "below" | "inline";
  "data-component"?: string;
}

export function SelectField({
  label,
  value,
  onValueChange,
  placeholder,
  options,
  error,
  disabled,
  id,
  className,
  hideErrorMessage = false,
  labelTrailing,
  errorDisplay = "below",
  "data-component": dataComponent,
}: SelectFieldProps) {
  const fieldId = id || label.toLowerCase().replace(/\s+/g, "-");
  const errorId = `${fieldId}-error`;
  const shouldShowInlineError = errorDisplay === "inline";
  const inlineError =
    shouldShowInlineError ? (
      <InlineFieldError
        id={errorId}
        message={error}
        reserveSpace
      />
    ) : undefined;
  const trailingContent =
    shouldShowInlineError
      ? labelTrailing ? (
          <div className="flex items-center gap-2">
            {labelTrailing}
            {inlineError}
          </div>
        ) : inlineError
      : labelTrailing;

  return (
    <div className="flex flex-col gap-2" data-component={dataComponent}>
      <div
        data-component="desktop_auth_form-field_label-row"
        className="flex items-center justify-between gap-2"
      >
        <Label htmlFor={fieldId}>{label}</Label>
        {shouldShowInlineError || trailingContent ? (
          <div
            data-component="desktop_auth_form-field_label-row_trailing"
            className="flex min-h-[0.6875rem] shrink-0 items-center"
          >
            {trailingContent}
          </div>
        ) : null}
      </div>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={fieldId}
          className={cn(
            "w-full shadow-none",
            AUTH_FIELD_CONTROL_CLASS_NAME,
            error && "border-destructive focus-visible:ring-destructive",
            className,
          )}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={!!error}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && !hideErrorMessage && !shouldShowInlineError && (
        <p
          id={errorId}
          className="text-sm text-destructive animate-fade-in"
        >
          {error}
        </p>
      )}
    </div>
  );
}
