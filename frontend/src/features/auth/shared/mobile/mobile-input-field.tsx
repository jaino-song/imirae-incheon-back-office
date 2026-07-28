import * as React from "react";

import { cn } from "@/lib/utils";
import { type MobileInputProps, MobileInput } from "@/features/auth/shared/mobile/mobile-input";

type MobileInputFieldProps = {
  title: React.ReactNode;
  message?: React.ReactNode;
  messageTone?: "muted" | "error";
  className?: string;
  labelClassName?: string;
  headerClassName?: string;
  messageClassName?: string;
  messageId?: string;
  inputClassName?: string;
  inputProps: Omit<MobileInputProps, "className">;
  renderInput?: (resolvedInputProps: MobileInputProps) => React.ReactNode;
};

export function MobileInputField({
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
}: MobileInputFieldProps) {
  const hasErrorMessage = messageTone === "error" && Boolean(message);

  const resolvedInputProps: MobileInputProps = {
    ...inputProps,
    className: cn(
      inputClassName,
      hasErrorMessage && "border-v3-burgundy bg-v3-burgundy-light focus:border-v3-burgundy",
    ),
  };

  return (
    <div data-component="desktop_auth_mobile-input-field" className={cn("m-0.5 flex flex-col gap-1.5", className)}>
      <div className={cn("flex items-center justify-between gap-2", headerClassName)}>
        <label
          htmlFor={typeof inputProps.id === "string" ? inputProps.id : undefined}
          className={cn("text-xs font-semibold text-v3-text-muted", labelClassName)}
        >
          {title}
        </label>
        {message ? (
          <span
            id={messageId}
            aria-live="polite"
            className={cn(
              "text-[0.7rem] font-semibold leading-none",
              messageTone === "error" ? "text-v3-burgundy" : "text-v3-text-muted",
              messageClassName,
            )}
          >
            {message}
          </span>
        ) : null}
      </div>
      {renderInput ? renderInput(resolvedInputProps) : <MobileInput {...resolvedInputProps} />}
    </div>
  );
}
