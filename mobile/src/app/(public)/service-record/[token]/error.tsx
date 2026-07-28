"use client";

import { useEffect } from "react";

import { ErrorFallback } from "@/components/app/ui/error-fallback";
import { captureServiceRecordError } from "@/lib/observability/capture-service-record-error";

interface ServiceRecordErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ServiceRecordErrorPage({
  error,
  reset,
}: ServiceRecordErrorPageProps) {
  useEffect(() => {
    captureServiceRecordError(error, {
      operation: "render",
      method: "RENDER",
      path: "/service-record/[Filtered]",
    });
  }, [error]);

  return (
    <ErrorFallback
      description="입력한 내용은 이 브라우저에 임시 저장되어 있습니다."
      onReset={reset}
      title="제공기록지를 불러오는 중 문제가 발생했어요."
    />
  );
}
