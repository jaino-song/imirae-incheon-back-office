"use client";

import { CheckCircle2, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ContractReviewAction = "finalize" | "preview";

interface ContractReviewActionButtonProps {
  "data-component": string;
  action: ContractReviewAction;
  onFinalize: () => void;
  onPreview: () => void;
}

export function ContractReviewActionButton({
  "data-component": dataComponent,
  action,
  onFinalize,
  onPreview,
}: ContractReviewActionButtonProps) {
  const opensPreview = action === "preview";

  return (
    <Button
      variant={opensPreview ? "positive-outline" : "positive"}
      size="sm"
      data-component={dataComponent}
      data-review-action={action}
      className="w-[calc(176px*var(--glint-ui-scale,1))]"
      onClick={opensPreview ? onPreview : onFinalize}
    >
      {opensPreview ? (
        <Eye className="h-4 w-4" />
      ) : (
        <CheckCircle2 className="h-4 w-4" />
      )}
      {opensPreview ? "검토하기" : "검토 완료 확인"}
    </Button>
  );
}
