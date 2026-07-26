import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface MsgFieldProps {
  /** Caller-context canonical value for this node. */
  "data-component": string;

  value: string;
  onChange?: (value: string) => void;
  inputId?: string;
  maxLength?: number;
  rows?: number;
  ariaLabel?: string;
  className?: string;
  textareaClassName?: string;
}

export const MsgField = ({
  "data-component": dataComponent,
  value,
  onChange,
  inputId,
  maxLength,
  rows = 12,
  ariaLabel,
  className,
  textareaClassName,
}: MsgFieldProps) => {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-input ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        className,
      )}
    >
      <Textarea
        id={inputId}
        data-component={dataComponent}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        maxLength={maxLength}
        rows={rows}
        aria-label={ariaLabel}
        className={cn(
          "max-h-[50vh] resize-none rounded-none border-none font-inherit text-base leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0",
          textareaClassName,
        )}
      />
    </div>
  );
};
