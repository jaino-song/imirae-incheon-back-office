"use client";

import { LoaderCircle } from "lucide-react";

import {
  ContractDocumentJobsPopover,
  type ContractDocumentJob,
  type ContractDocumentJobsData,
  type ContractDocumentJobsPopoverProps,
  type ContractDocumentJobsSummary,
} from "@/components/app/contracts/ContractDocumentJobsPopover";
import { StatMini, type StatMiniDensity } from "@/components/app/v3/StatMini";
import type { StatsBarItem } from "@/components/app/v3/StatsBar";
import { cn } from "@/lib/utils";

export interface ContractStatsBarProps {
  items: readonly StatsBarItem[];
  name: string;
  isLoading?: boolean;
  density?: StatMiniDensity;
  summary?: ContractDocumentJobsSummary | null;
  jobs?: ContractDocumentJobsData | null;
  documentJobs?: ContractDocumentJobsData | null;
  jobsLoading?: boolean;
  isJobsLoading?: boolean;
  jobsError?: unknown;
  error?: unknown;
  onRetryJobs?: () => void;
  onRetry?: () => void;
  className?: string;
  jobsPopoverClassName?: string;
}

type JobsPopoverProps = Pick<
  ContractDocumentJobsPopoverProps,
  "summary" | "jobs" | "documentJobs" | "isLoading" | "isJobsLoading" | "error" | "jobsError" | "onRetry" | "onRetryJobs"
>;

export function ContractStatsBar({
  items,
  name,
  isLoading = false,
  density = "default",
  summary,
  jobs,
  documentJobs,
  jobsLoading = false,
  isJobsLoading = false,
  jobsError,
  error,
  onRetryJobs,
  onRetry,
  className,
  jobsPopoverClassName,
}: ContractStatsBarProps) {
  const statsBase = `${name}_stats`;
  const resolvedJobsLoading = jobsLoading || isJobsLoading;
  const resolvedJobsError = jobsError ?? error;
  const resolvedRetry = onRetryJobs ?? onRetry;
  const activeCount = summary?.activeCount ?? 0;

  const popoverProps: JobsPopoverProps = {
    summary,
    jobs,
    documentJobs,
    isJobsLoading: resolvedJobsLoading,
    jobsError: resolvedJobsError,
    onRetryJobs: resolvedRetry,
  };

  return (
    <div
      data-component={statsBase}
      data-slot="contract-stats-bar"
      className={cn("flex flex-wrap gap-[calc(16px*var(--glint-ui-scale,1))]", className)}
    >
      {items.map((item, idx) => (
        <StatMini
          key={item.label}
          data-component={`${statsBase}_stat-${idx}`}
          icon={item.icon}
          value={item.value}
          label={item.label}
          counter={item.counter}
          colorIndex={item.colorIndex ?? idx}
          animationDelay={`${idx * 0.08}s`}
          isLoading={isLoading}
          density={density}
        />
      ))}

      <ContractDocumentJobsPopover
        {...popoverProps}
        className={jobsPopoverClassName}
        data-component={`${statsBase}_document-jobs-popover`}
        trigger={
          <StatMini
            data-component={`${statsBase}_document-jobs-popover_trigger`}
            icon={LoaderCircle}
            value={activeCount}
            label="전자문서 처리중"
            counter="건"
            colorIndex={2}
            animationDelay={`${items.length * 0.08}s`}
            isLoading={resolvedJobsLoading}
            density={density}
            interactive
            aria-label="전자문서 처리중 작업 보기"
            className="ms-auto max-lg:ms-0"
          />
        }
      />
    </div>
  );
}

export type {
  ContractDocumentJob,
  ContractDocumentJobsData,
  ContractDocumentJobsSummary,
};
