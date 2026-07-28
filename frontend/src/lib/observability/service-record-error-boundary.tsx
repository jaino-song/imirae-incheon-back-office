"use client";

import { Component, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { captureServiceRecordRenderError } from "./capture-api-error";

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
    captureServiceRecordRenderError(error);
  }

  private readonly reset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        data-component="desktop_clients_service-records-error-boundary"
        className="rounded-2xl border border-v3-border bg-white px-6 py-10 text-center"
        role="alert"
      >
        <p className="text-sm font-semibold text-v3-dark">
          제공기록지 화면을 표시하는 중 문제가 발생했습니다
        </p>
        <p className="mt-2 text-xs text-v3-text-muted">
          잠시 후 다시 시도해 주세요.
        </p>
        <Button
          className="mt-5"
          data-component="desktop_clients_service-records-error-retry"
          onClick={this.reset}
          type="button"
        >
          다시 시도
        </Button>
      </div>
    );
  }
}
