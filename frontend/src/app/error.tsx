"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div data-component="desktop_error_recovery" role="alert">
      <NextError statusCode={0} />
      <Button
        data-component="desktop_error_recovery_retry"
        onClick={reset}
        type="button"
      >
        다시 시도
      </Button>
    </div>
  );
}
