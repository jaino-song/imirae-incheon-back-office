"use client";

import { Component, type ReactNode } from "react";

import { ErrorFallback } from "@/components/app/ui/error-fallback";

import { captureServiceRecordError } from "./capture-service-record-error";

interface ServiceRecordErrorBoundaryProps {
  children: ReactNode;
}

interface ServiceRecordErrorBoundaryState {
  hasError: boolean;
}

export class ServiceRecordErrorBoundary extends Component<
  ServiceRecordErrorBoundaryProps,
  ServiceRecordErrorBoundaryState
> {
  state: ServiceRecordErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ServiceRecordErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    captureServiceRecordError(error, {
      operation: "render",
      method: "RENDER",
      path: "/clients/[id]/service-records",
    });
  }

  private readonly reset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <ErrorFallback
        className="min-h-0"
        description="잠시 후 다시 시도해 주세요."
        onReset={this.reset}
        title="제공기록지 화면을 표시하는 중 문제가 발생했어요."
      />
    );
  }
}
