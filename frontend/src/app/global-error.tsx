"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

interface GlobalErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div data-component="desktop_global-error_recovery" role="alert">
          <NextError statusCode={0} />
          <Button
            data-component="desktop_global-error_recovery_retry"
            onClick={reset}
            type="button"
          >
            다시 시도
          </Button>
        </div>
      </body>
    </html>
  );
}
