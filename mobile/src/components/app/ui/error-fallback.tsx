"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorFallbackProps {
  title: string;
  description: string;
  onReset: () => void;
  resetLabel?: string;
  debugMessage?: string;
  debugDigest?: string;
  className?: string;
}

export function ErrorFallback({
  title,
  description,
  onReset,
  resetLabel = "다시 시도",
  debugMessage,
  debugDigest,
  className,
}: ErrorFallbackProps) {
  return (
    <div
      data-component="mobile_error_fallback_container"
      className={cn(
        "flex min-h-[60vh] items-center justify-center px-5 py-10",
        className,
      )}
    >
      <section
        aria-live="assertive"
        data-component="mobile_error_fallback_container_card"
        className="w-full max-w-md rounded-[28px] bg-white px-6 py-8 text-center shadow-v3 ring-1 ring-[hsla(214,30%,20%,0.08)]"
        role="alert"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(355,40%,94%)]">
          <AlertTriangle className="h-6 w-6 text-[hsl(355,36%,45%)]" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-v3-dark">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-v3-text-muted">
          {description}
        </p>

        {debugMessage || debugDigest ? (
          <div
            data-component="mobile_error_fallback_container_card_debug"
            className="mt-5 rounded-2xl border border-border bg-muted/40 p-4 text-left"
          >
            <p className="text-xs font-semibold text-foreground">
              개발용 오류 정보
            </p>
            {debugMessage ? (
              <p className="mt-2 break-words font-mono text-xs leading-5 text-muted-foreground">
                {debugMessage}
              </p>
            ) : null}
            {debugDigest ? (
              <p className="mt-2 font-mono text-xs leading-5 text-muted-foreground">
                digest: {debugDigest}
              </p>
            ) : null}
          </div>
        ) : null}

        <Button
          className="mt-6 w-full"
          data-component="mobile_error_fallback_container_card_retry"
          onClick={onReset}
          type="button"
          variant="v3"
        >
          {resetLabel}
        </Button>
      </section>
    </div>
  );
}
