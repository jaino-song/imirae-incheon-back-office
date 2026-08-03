import type { MessageAutomationPolicyRow } from "@babyjamjam/shared/types/message";

const SOURCE_COMPONENT = "PolicyInfoRows";

interface PolicyInfoRowsProps {
  "data-component": string;
  title?: string;
  rows: MessageAutomationPolicyRow[];
}

export function PolicyInfoRows({
  "data-component": dataComponent,
  title = "규칙",
  rows,
}: PolicyInfoRowsProps) {
  return (
    <section
      data-component={dataComponent}
      data-slot="info-card"
      data-source-component={SOURCE_COMPONENT}
      className="info-card !rounded-[calc(18px*var(--glint-ui-scale,1))] !px-[calc(16px*var(--glint-ui-scale,1))] !py-[calc(14px*var(--glint-ui-scale,1))]"
    >
      <div
        data-component={`${dataComponent}_title`}
        data-slot="info-card-title"
        className="info-card-title !mb-[calc(8px*var(--glint-ui-scale,1))] !text-[calc(0.6rem*var(--glint-ui-scale,1))]"
      >
        {title}
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          data-component={`${dataComponent}_${row.id}`}
          data-slot="info-row"
          className="info-row !gap-[calc(12px*var(--glint-ui-scale,1))] !py-[calc(8px*var(--glint-ui-scale,1))] !text-[calc(0.78rem*var(--glint-ui-scale,1))]"
        >
          <span
            data-component={`${dataComponent}_${row.id}_label`}
            data-slot="info-row-label"
            className="info-row-label"
          >
            {row.label}
          </span>
          <span
            data-component={`${dataComponent}_${row.id}_value`}
            data-slot="info-row-value"
            className="info-row-value"
          >
            {row.value}
          </span>
        </div>
      ))}
    </section>
  );
}
