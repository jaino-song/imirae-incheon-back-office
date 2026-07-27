import { cn } from "@/lib/utils";

interface ContractPdfViewerPlaceholderProps {
  className?: string;
  "data-component": string;
  "aria-label": string;
}

export function ContractPdfViewerPlaceholder({
  className,
  "data-component": dataComponent,
  "aria-label": ariaLabel,
}: ContractPdfViewerPlaceholderProps) {
  return (
    <div
      className={cn("contract-pdf-viewer", className)}
      data-component={dataComponent}
      data-slot="contract-pdf-viewer"
      data-source-component="ContractPdfViewerPlaceholder"
      aria-label={ariaLabel}
      role="status"
    >
      <div className="contract-pdf-status" data-slot="contract-pdf-status">
        PDF 뷰어를 준비하는 중입니다
      </div>
    </div>
  );
}
