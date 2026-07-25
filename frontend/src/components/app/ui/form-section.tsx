"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { AppContentCard } from "@/components/ui/app-surface";

export const APP_FORM_CONTROL_CLASS_NAME =
  "flex h-[calc(38px*var(--glint-ui-scale,1))] min-h-[calc(38px*var(--glint-ui-scale,1))] w-full rounded-[13px] border-[1.35px] border-input bg-white px-[calc(14px*var(--glint-ui-scale,1))] py-[calc(8px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] font-[Pretendard] font-medium text-v3-dark shadow-none outline-none transition-all focus-visible:border-v3-primary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-v3-primary/10 disabled:cursor-not-allowed disabled:opacity-55";

export interface FormSectionProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  showSeparator?: boolean;
  bodyClassName?: string;
  headerDataComponent?: string;
  titleDataComponent?: string;
  descriptionDataComponent?: string;
  bodyDataComponent?: string;
  "data-component": string;
}

function FormSection({
  title,
  description,
  badge,
  showSeparator = false,
  className,
  bodyClassName,
  headerDataComponent,
  titleDataComponent,
  descriptionDataComponent,
  bodyDataComponent,
  children,
  "data-component": dataComponent,
  ...props
}: FormSectionProps) {
  const sub = (suffix: string) => dataComponent ? `${dataComponent}_${suffix}` : undefined;

  return (
    <>
      {showSeparator && <Separator className="my-4" />}
      <AppContentCard
        as="section"
        data-component={dataComponent}
        data-source-component="FormSection"
        title={title}
        description={description}
        titleTrailing={badge}
        headerDataComponent={headerDataComponent ?? sub("header")}
        titleDataComponent={titleDataComponent ?? sub("title")}
        descriptionDataComponent={descriptionDataComponent ?? sub("description")}
        bodyDataComponent={bodyDataComponent ?? sub("body")}
        contentClassName={bodyClassName}
        className={className}
        {...props}
      >
        {children}
      </AppContentCard>
    </>
  );
}

export interface FormGridProps extends React.HTMLAttributes<HTMLDivElement> {
  "data-component"?: string;
}

function FormGrid({
  className,
  "data-component": dataComponent,
  ...props
}: FormGridProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component="FormGrid"
      className={cn("grid grid-cols-1 gap-[calc(16px*var(--glint-ui-scale,1))] sm:grid-cols-2", className)}
      {...props}
    />
  );
}

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  labelAccessory?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  labelDataComponent?: string;
  requiredDataComponent?: string;
  "data-component"?: string;
}

function FormField({
  label,
  labelAccessory,
  htmlFor,
  required = false,
  labelDataComponent,
  requiredDataComponent,
  className,
  children,
  "data-component": dataComponent,
  ...props
}: FormFieldProps) {
  const sub = (suffix: string) => dataComponent ? `${dataComponent}_${suffix}` : undefined;
  const labelContent = (
    <>
      {label}
      {required ? (
        <span
          data-component={requiredDataComponent ?? sub("required")}
          className="ml-0.5 text-v3-burgundy"
        >
          *
        </span>
      ) : null}
    </>
  );
  const labelNode = htmlFor ? (
    <Label
      data-component={labelDataComponent ?? sub("label")}
      htmlFor={htmlFor}
      className="text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3] text-v3-text-muted"
    >
      {labelContent}
    </Label>
  ) : (
    <div
      data-component={labelDataComponent ?? sub("label")}
      className="text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3] text-v3-text-muted"
    >
      {labelContent}
    </div>
  );

  return (
    <div
      data-component={dataComponent}
      data-source-component="FormField"
      className={cn("grid gap-[calc(7px*var(--glint-ui-scale,1))]", className)}
      {...props}
    >
      {labelAccessory ? (
        <div
          data-component={sub("label-row")}
          className="flex min-w-0 items-center justify-between gap-2"
        >
          {labelNode}
          <div
            data-component={sub("label-accessory")}
            className="ml-auto min-w-0 text-right"
          >
            {labelAccessory}
          </div>
        </div>
      ) : (
        labelNode
      )}

      {children}
    </div>
  );
}

export interface FormTextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  "data-component"?: string;
}

const FormTextInput = React.forwardRef<HTMLInputElement, FormTextInputProps>(
  ({ className, error, "data-component": dataComponent, ...props }, ref) => (
    <input
      ref={ref}
      data-component={dataComponent}
      data-source-component="FormTextInput"
      className={cn(
        APP_FORM_CONTROL_CLASS_NAME,
        "placeholder:text-muted-foreground",
        error && "border-v3-burgundy focus-visible:border-v3-burgundy",
        className,
      )}
      aria-invalid={error || undefined}
      {...props}
    />
  ),
);
FormTextInput.displayName = "FormTextInput";

export interface FormTextInputWithSuffixProps extends FormTextInputProps {
  suffix: React.ReactNode;
  inputDataComponent?: string;
  suffixDataComponent?: string;
}

const FormTextInputWithSuffix = React.forwardRef<HTMLInputElement, FormTextInputWithSuffixProps>(
  ({
    suffix,
    className,
    inputDataComponent,
    suffixDataComponent,
    "data-component": dataComponent,
    ...props
  }, ref) => {
    const sub = (suffixName: string) => dataComponent ? `${dataComponent}_${suffixName}` : undefined;

    return (
    <div
      data-component={dataComponent}
      data-source-component="FormTextInputWithSuffix"
      className="relative"
    >
      <FormTextInput
        ref={ref}
        data-component={inputDataComponent ?? sub("input")}
        className={cn("pr-[calc(38px*var(--v3-ui-scale,1))]", className)}
        {...props}
      />
      <span
        data-component={suffixDataComponent ?? sub("suffix")}
        className="pointer-events-none absolute right-[calc(14px*var(--v3-ui-scale,1))] top-1/2 -translate-y-1/2 text-[calc(12px*var(--v3-ui-scale,1))] font-semibold text-v3-text-muted"
      >
        {suffix}
      </span>
    </div>
    );
  },
);
FormTextInputWithSuffix.displayName = "FormTextInputWithSuffix";

export interface FormHelperTextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  tone?: "default" | "error";
  "data-component"?: string;
}

function FormHelperText({
  tone = "default",
  className,
  "data-component": dataComponent,
  ...props
}: FormHelperTextProps) {
  return (
    <p
      data-component={dataComponent}
      data-source-component="FormHelperText"
      className={cn(
        tone === "error"
          ? "text-[calc(12px*var(--glint-ui-scale,1))] font-bold leading-[1.35] text-v3-burgundy"
          : "-mt-0.5 m-0 text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold leading-[1.45] text-v3-text-muted",
        className,
      )}
      {...props}
    />
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
  options: readonly FormNativeSelectEntry[];
  onValueChange?: (value: string) => void;
  placeholder?: string;
  hideIcon?: boolean;
  wrapDataComponent?: string;
  selectDataComponent?: string;
  iconDataComponent?: string;
  "data-component"?: string;
}

function isFormNativeSelectGroup(option: FormNativeSelectEntry): option is FormNativeSelectGroup {
  return "options" in option;
}

function FormNativeSelect({
  options,
  onValueChange,
  placeholder,
  hideIcon = false,
  className,
  wrapDataComponent,
  selectDataComponent,
  iconDataComponent,
  "data-component": dataComponent,
  value,
  ...props
}: FormNativeSelectProps) {
  const sub = (suffix: string) => dataComponent ? `${dataComponent}_${suffix}` : undefined;
  const resolvedWrapDataComponent = wrapDataComponent ?? dataComponent;

  return (
    <div
      data-component={resolvedWrapDataComponent}
      data-source-component="FormNativeSelect"
      className="relative"
    >
      <select
        data-component={selectDataComponent ?? sub("select")}
        className={cn(
          "box-border h-[calc(38px*var(--glint-ui-scale,1))] min-h-[calc(38px*var(--glint-ui-scale,1))] w-full appearance-none rounded-[13px] border-[1.35px] border-input bg-white px-[calc(14px*var(--glint-ui-scale,1))] pr-[calc(44px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] font-[Pretendard] font-medium leading-[1.2] text-v3-dark outline-none focus:border-v3-primary focus:ring-[3px] focus:ring-inset focus:ring-v3-primary/10 disabled:cursor-not-allowed disabled:opacity-55",
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
          data-component={iconDataComponent ?? sub("icon")}
          className="pointer-events-none absolute right-[calc(14px*var(--glint-ui-scale,1))] top-1/2 h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(16px*var(--glint-ui-scale,1))] -translate-y-1/2 text-v3-text-muted"
          aria-hidden="true"
          strokeWidth={2.2}
        />
      )}
    </div>
  );
}

export interface FormChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  "data-component"?: string;
}

function FormChip({
  selected = false,
  className,
  type = "button",
  "data-component": dataComponent,
  ...props
}: FormChipProps) {
  return (
    <button
      type={type}
      data-component={dataComponent}
      data-source-component="FormChip"
      className={cn(
        "min-h-[calc(34px*var(--glint-ui-scale,1))] rounded-full border-[1.5px] border-v3-border bg-white px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(7px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] font-extrabold leading-none text-v3-text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        selected && "border-v3-primary/40 bg-v3-primary-light text-v3-primary",
        className,
      )}
      aria-pressed={selected}
      {...props}
    />
  );
}

export interface FormSwitchRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: "default" | "control";
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  buttonAriaLabel: string;
  copyDataComponent?: string;
  titleDataComponent?: string;
  descriptionDataComponent?: string;
  buttonDataComponent?: string;
  thumbDataComponent?: string;
  "data-component"?: string;
}

function FormSwitchRow({
  title,
  description,
  size = "default",
  checked,
  onToggle,
  disabled = false,
  buttonAriaLabel,
  copyDataComponent,
  titleDataComponent,
  descriptionDataComponent,
  buttonDataComponent,
  thumbDataComponent,
  className,
  "data-component": dataComponent,
  ...props
}: FormSwitchRowProps) {
  const sub = (suffix: string) => dataComponent ? `${dataComponent}_${suffix}` : undefined;

  return (
    <div
      data-component={dataComponent}
      data-source-component="FormSwitchRow"
      className={cn(
        "flex min-h-[calc(54px*var(--glint-ui-scale,1))] items-center justify-between gap-[calc(14px*var(--glint-ui-scale,1))] rounded-[14px] border-[1.5px] border-v3-border bg-white px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))]",
        size === "control" && "h-[calc(38px*var(--glint-ui-scale,1))] min-h-[calc(38px*var(--glint-ui-scale,1))] border-[1.35px] py-0",
        className,
      )}
      {...props}
    >
      <div data-component={copyDataComponent ?? sub("copy")}>
        <strong
          data-component={titleDataComponent ?? sub("title")}
          className="block text-[calc(12px*var(--glint-ui-scale,1))] font-bold leading-[1.3] text-v3-dark"
        >
          {title}
        </strong>
        {description ? (
          <span
            data-component={descriptionDataComponent ?? sub("description")}
            className="mt-[calc(3px*var(--glint-ui-scale,1))] block text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold leading-[1.35] text-v3-text-muted"
          >
            {description}
          </span>
        ) : null}
      </div>
      <Switch
        data-component={buttonDataComponent ?? sub("button")}
        thumbDataComponent={thumbDataComponent ?? sub("thumb")}
        checked={checked}
        onCheckedChange={onToggle}
        aria-label={buttonAriaLabel}
        disabled={disabled}
      />
    </div>
  );
}

export {
  FormSection,
  FormGrid,
  FormField,
  FormTextInput,
  FormTextInputWithSuffix,
  FormHelperText,
  FormNativeSelect,
  FormChip,
  FormSwitchRow,
};
