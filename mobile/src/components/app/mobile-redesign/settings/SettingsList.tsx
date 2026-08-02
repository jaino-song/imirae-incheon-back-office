"use client";

import type { ReactElement } from "react";
import { ChevronRight } from "lucide-react";

import { ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { SettingsListItem } from "./settings-items";

const SOURCE_COMPONENT = "SettingsList";
const SKELETON_ROW_COUNT = 4;

export interface SettingsListProps {
  "data-component": string;
  items: SettingsListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  policiesError?: boolean;
  onRetryPolicies?: () => void;
  isApproved: boolean;
}

export function SettingsList({
  "data-component": dataComponent,
  items,
  selectedId,
  onSelect,
  isLoading,
  policiesError = false,
  onRetryPolicies,
  isApproved,
}: SettingsListProps): ReactElement {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;

  return (
    <section
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className="flex h-full min-h-0 flex-1 flex-col gap-[calc(18px*var(--glint-ui-scale,1))]"
    >
      <header
        data-component={sub("header")}
        className="flex shrink-0 flex-col gap-[calc(6px*var(--glint-ui-scale,1))]"
      >
        <div
          data-component={sub("header_title-row")}
          className="flex items-center gap-[calc(8px*var(--glint-ui-scale,1))]"
        >
          <h2
            data-component={sub("header_title-row_title")}
            className="text-[calc(1.05rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.4rem*var(--glint-ui-scale,1))] text-v3-dark"
          >
            설정
          </h2>
          <span
            data-component={sub("header_title-row_count")}
            className="inline-flex items-center rounded-[calc(999px*var(--glint-ui-scale,1))] bg-v3-primary-light px-[calc(8px*var(--glint-ui-scale,1))] py-[calc(3px*var(--glint-ui-scale,1))] text-[calc(0.66rem*var(--glint-ui-scale,1))] font-bold leading-none text-v3-primary"
          >
            {items.length}개
          </span>
        </div>
        <p
          data-component={sub("header_subtitle")}
          className="text-[calc(0.72rem*var(--glint-ui-scale,1))] leading-[calc(1.05rem*var(--glint-ui-scale,1))] text-v3-text-muted"
        >
          메시지에 관련된 설정들을 정할 수 있어요
        </p>
      </header>

      <div
        data-component={sub("items")}
        className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-[calc(6px*var(--glint-ui-scale,1))] overflow-y-auto overscroll-contain"
      >
        {isLoading ? (
          <ListRowsSkeleton
            data-component={sub("items_loading")}
            rowCount={SKELETON_ROW_COUNT}
          />
        ) : (
          <>
            {items.map((item) => {
              const itemBase = sub(`item-${item.id}`);
              const ItemIcon = item.icon;
              const isSelected = selectedId === item.id;
              const isTenantApplication = item.kind === "tenant-application";
              const isSwitchChecked = item.requiresApproval
                ? isApproved && item.active
                : item.active;

              return (
                <div key={item.id} className="relative">
                  <button
                    data-component={itemBase}
                    type="button"
                    aria-pressed={isSelected}
                    className={cn(
                      "flex min-h-[calc(66px*var(--glint-ui-scale,1))] w-full cursor-pointer items-center gap-[calc(11px*var(--glint-ui-scale,1))] rounded-[calc(15px*var(--glint-ui-scale,1))] border-[calc(1px*var(--glint-ui-scale,1))] px-[calc(10px*var(--glint-ui-scale,1))] py-[calc(9px*var(--glint-ui-scale,1))] text-left outline-none transition-colors active:bg-v3-primary-light/65 focus-visible:border-v3-primary/45 focus-visible:ring-[calc(3px*var(--glint-ui-scale,1))] focus-visible:ring-v3-primary/10",
                      isSelected
                        ? "border-v3-primary/20 bg-v3-primary-light/45"
                        : "border-transparent bg-transparent hover:bg-v3-primary-light/30",
                    )}
                    onClick={() => onSelect(item.id)}
                  >
                    <span
                      data-component={`${itemBase}_icon`}
                      className="flex h-[calc(42px*var(--glint-ui-scale,1))] w-[calc(42px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[calc(13px*var(--glint-ui-scale,1))] bg-v3-primary-light text-v3-primary"
                      aria-hidden="true"
                    >
                      <ItemIcon
                        className="h-[calc(18px*var(--glint-ui-scale,1))] w-[calc(18px*var(--glint-ui-scale,1))]"
                        strokeWidth={2.25}
                      />
                    </span>
                    <span
                      data-component={`${itemBase}_copy`}
                      className="flex min-w-0 flex-1 flex-col gap-[calc(3px*var(--glint-ui-scale,1))]"
                    >
                      <span
                        data-component={`${itemBase}_copy_title`}
                        className="truncate text-[calc(0.82rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.1rem*var(--glint-ui-scale,1))] text-v3-dark"
                      >
                        {item.title}
                      </span>
                      <span
                        data-component={`${itemBase}_copy_subtitle`}
                        className="truncate text-[calc(0.68rem*var(--glint-ui-scale,1))] leading-[calc(0.95rem*var(--glint-ui-scale,1))] text-v3-text-muted"
                      >
                        {item.subtitle}
                      </span>
                    </span>
                    <span
                      data-component={`${itemBase}_trailing`}
                      className="flex shrink-0 items-center gap-[calc(8px*var(--glint-ui-scale,1))]"
                    >
                      {isTenantApplication ? (
                        <StatusPill
                          data-component={`${itemBase}_trailing_status`}
                          variant="primary"
                          className="!rounded-[calc(999px*var(--glint-ui-scale,1))] !border-[calc(1px*var(--glint-ui-scale,1))] !border-v3-primary/15 !bg-v3-primary-light !px-[calc(8px*var(--glint-ui-scale,1))] !py-[calc(4px*var(--glint-ui-scale,1))] !text-[calc(0.62rem*var(--glint-ui-scale,1))] !text-v3-primary"
                        >
                          {item.statusLabel}
                        </StatusPill>
                      ) : (
                        <>
                          <span
                            className="h-[calc(23.4px*var(--glint-ui-scale,1))] w-[calc(41.4px*var(--glint-ui-scale,1))]"
                            aria-hidden="true"
                          />
                          <ChevronRight
                            data-component={`${itemBase}_trailing_chevron`}
                            className="h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(16px*var(--glint-ui-scale,1))] text-v3-text-muted"
                            strokeWidth={2.25}
                            aria-hidden="true"
                          />
                        </>
                      )}
                    </span>
                  </button>
                  {!isTenantApplication ? (
                    <Switch
                      data-component={`${itemBase}_trailing_switch`}
                      thumbDataComponent={`${itemBase}_trailing_switch_thumb`}
                      aria-label={`${item.title} 활성화`}
                      checked={isSwitchChecked}
                      disabled
                      className="pointer-events-none absolute right-[calc(34px*var(--glint-ui-scale,1))] top-1/2 -translate-y-1/2 [--v3-ui-scale:var(--glint-ui-scale,1)]"
                    />
                  ) : null}
                </div>
              );
            })}

            {policiesError ? (
              <div
                data-component={sub("items_policies-error")}
                className="flex items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))] rounded-[calc(14px*var(--glint-ui-scale,1))] border-[calc(1px*var(--glint-ui-scale,1))] border-v3-border bg-v3-dim-white px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))]"
                role="alert"
              >
                <span
                  data-component={sub("items_policies-error_message")}
                  className="min-w-0 text-[calc(0.68rem*var(--glint-ui-scale,1))] font-semibold leading-[calc(0.95rem*var(--glint-ui-scale,1))] text-v3-text-muted"
                >
                  자동 전송 정책을 불러오지 못했습니다
                </span>
                <button
                  data-component={sub("items_policies-error_retry")}
                  type="button"
                  className="min-h-[calc(36px*var(--glint-ui-scale,1))] shrink-0 cursor-pointer rounded-[calc(10px*var(--glint-ui-scale,1))] bg-v3-primary-light px-[calc(10px*var(--glint-ui-scale,1))] text-[calc(0.68rem*var(--glint-ui-scale,1))] font-bold text-v3-primary outline-none transition-colors active:bg-v3-primary/15 focus-visible:ring-[calc(3px*var(--glint-ui-scale,1))] focus-visible:ring-v3-primary/10"
                  onClick={onRetryPolicies}
                >
                  재시도
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
