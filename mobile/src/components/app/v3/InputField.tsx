import * as React from "react";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./Input";

const SOURCE_COMPONENT = "InputField";
type InputFieldProps = {
  "data-component"?: string;
  title: React.ReactNode;
  message?: React.ReactNode;
  messageTone?: "muted" | "error";
  className?: string;
  labelClassName?: string;
  headerClassName?: string;
  messageClassName?: string;
  messageId?: string;
  inputClassName?: string;
  inputProps: Omit<InputProps, "className">;
  renderInput?: (resolvedInputProps: InputProps) => React.ReactNode;
};

export function InputField({
  "data-component": dataComponent,
  title,
  message,
  messageTone = "muted",
  className,
  labelClassName,
  headerClassName,
  messageClassName,
  messageId,
  inputClassName,
  inputProps,
  renderInput,
}: InputFieldProps) {
  const hasErrorMessage = messageTone === "error" && Boolean(message);

  const resolvedInputProps: InputProps = {
    ...inputProps,
    className: cn(
      inputClassName,
      hasErrorMessage && "border-v3-burgundy bg-v3-burgundy-light focus:border-v3-burgundy",
    ),
  };

  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className={cn("m-0.5 flex flex-col gap-1.5", className)}
    >
      <div className={cn("flex items-center justify-between gap-2", headerClassName)}>
        <label
          htmlFor={typeof inputProps.id === "string" ? inputProps.id : undefined}
          className={cn("text-xs font-semibold text-v3-text-muted", labelClassName)}
        >
          {title}
        </label>
        <div
          className="overflow-hidden"
          style={{
            transition:
              "max-height var(--duration-affordance) var(--ease-standard), " +
              "opacity var(--duration-affordance) var(--ease-standard)",
            maxHeight: hasErrorMessage ? "2rem" : message ? "none" : "0",
            opacity: hasErrorMessage ? 1 : message ? 1 : 0,
          }}
        >
          {message ? (
            <span
              id={messageId}
              aria-live="polite"
              className={cn(
                "text-[0.7rem] font-semibold leading-none",
                messageTone === "error" ? "text-v3-burgundy" : "text-v3-text-muted",
                messageClassName
              )}
            >
              {message}
            </span>
          ) : null}
        </div>
      </div>
      {renderInput ? renderInput(resolvedInputProps) : <Input {...resolvedInputProps} />}
    </div>
  );
}
