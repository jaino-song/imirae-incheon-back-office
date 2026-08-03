"use client";

import {
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";

import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { SlidingCard } from "@/components/app/mobile-redesign/sliding-card";
import { ClientRegistrationPolicyDetail } from "@/components/app/mobile-redesign/settings/ClientRegistrationPolicyDetail";
import { PastTriggerPolicyDetail } from "@/components/app/mobile-redesign/settings/PastTriggerPolicyDetail";
import { PolicyInfoRows } from "@/components/app/mobile-redesign/settings/PolicyInfoRows";
import { SenderApprovalDetail } from "@/components/app/mobile-redesign/settings/SenderApprovalDetail";
import { SettingsList } from "@/components/app/mobile-redesign/settings/SettingsList";
import {
  buildSettingsListItems,
  type SettingsListItem,
} from "@/components/app/mobile-redesign/settings/settings-items";
import { StatusPill } from "@/components/app/ui/status-badge";
import { settingsApi } from "@/services/api";

import "@/components/app/mobile-redesign/redesign.css";

const SETTINGS_PAGE_BASE = "mobile_messages_settings_page";
const SLIDING_CARD_BASE = `${SETTINGS_PAGE_BASE}_screen_content_sliding-card`;
const SETTINGS_LIST_BASE = `${SLIDING_CARD_BASE}_stage_list-pane_settings-list`;
const DETAIL_BODY_BASE = `${SLIDING_CARD_BASE}_stage_detail-pane_body`;
const PAST_TRIGGER_POLICY_ID = "past-trigger";
const MESSAGE_SENDER_APPROVAL_QUERY_KEY = [
  "settings",
  "message-sender-approval",
] as const;
const MESSAGE_AUTOMATION_POLICIES_QUERY_KEY = [
  "settings",
  "message-automation-policies",
] as const;

interface DetailContentProps {
  "data-component": string;
  item: SettingsListItem;
}

function DetailContent({
  "data-component": dataComponent,
  item,
}: DetailContentProps): ReactElement {
  const ItemIcon = item.icon;

  return (
    <div
      data-component={dataComponent}
      data-source-component="DetailContent"
      className="flex flex-col gap-[calc(18px*var(--glint-ui-scale,1))]"
    >
      <section
        data-component={`${dataComponent}_hero`}
        className="flex items-center gap-[calc(12px*var(--glint-ui-scale,1))]"
      >
        <span
          data-component={`${dataComponent}_hero_icon`}
          className="flex h-[calc(46px*var(--glint-ui-scale,1))] w-[calc(46px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[calc(14px*var(--glint-ui-scale,1))] bg-v3-primary-light text-v3-primary"
          aria-hidden="true"
        >
          <ItemIcon
            className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]"
            strokeWidth={2.25}
          />
        </span>
        <span
          data-component={`${dataComponent}_hero_copy`}
          className="flex min-w-0 flex-1 flex-col gap-[calc(4px*var(--glint-ui-scale,1))]"
        >
          <h2
            data-component={`${dataComponent}_hero_copy_title`}
            className="text-[calc(0.94rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.25rem*var(--glint-ui-scale,1))] text-v3-dark"
          >
            {item.title}
          </h2>
          <p
            data-component={`${dataComponent}_hero_copy_description`}
            className="text-[calc(0.7rem*var(--glint-ui-scale,1))] leading-[calc(1.05rem*var(--glint-ui-scale,1))] text-v3-text-muted"
          >
            {item.subtitle}
          </p>
        </span>
      </section>

      <PolicyInfoRows
        data-component={`${dataComponent}_policy-info-rows`}
        rows={item.rows ?? []}
      />
    </div>
  );
}

export function MessagesSettingsPage(): ReactElement {
  const router = useRouter();
  const selectedItemId = useSearchParams().get("item");
  const didPushDetailRef = useRef(false);
  const approvalQuery = useQuery({
    queryKey: MESSAGE_SENDER_APPROVAL_QUERY_KEY,
    queryFn: settingsApi.getMessageSenderApproval,
  });
  const policiesQuery = useQuery({
    queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
    queryFn: settingsApi.getMessageAutomationPolicies,
  });
  const items = useMemo(
    () =>
      buildSettingsListItems({
        approval: approvalQuery.data,
        policies: policiesQuery.data?.policies,
      }),
    [approvalQuery.data, policiesQuery.data?.policies],
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId),
    [items, selectedItemId],
  );
  const isLoading = approvalQuery.isLoading || policiesQuery.isLoading;

  useEffect(() => {
    if (selectedItemId === null) {
      didPushDetailRef.current = false;
    }
  }, [selectedItemId]);

  useEffect(() => {
    if (isLoading || selectedItemId === null || selectedItem !== undefined) {
      return;
    }

    router.replace("/messages/settings", { scroll: false });
  }, [isLoading, router, selectedItem, selectedItemId]);

  const handleSelect = (id: string) => {
    router.push(`?item=${encodeURIComponent(id)}`, { scroll: false });
    didPushDetailRef.current = true;
  };

  const handleBack = () => {
    if (didPushDetailRef.current) {
      router.back();
      return;
    }

    router.replace("/messages/settings", { scroll: false });
  };

  const detail = useMemo<ReactNode>(() => {
    if (!selectedItem) return null;

    const detailBase = `${DETAIL_BODY_BASE}_${selectedItem.kind}_${selectedItem.id}`;

    if (selectedItem.kind === "tenant-application") {
      return <SenderApprovalDetail data-component={detailBase} />;
    }

    if (selectedItem.kind === "client-registration-policy") {
      return <ClientRegistrationPolicyDetail data-component={detailBase} />;
    }

    if (
      selectedItem.kind === "automation-policy" &&
      selectedItem.id === PAST_TRIGGER_POLICY_ID
    ) {
      const pastTriggerConfig = policiesQuery.data?.pastTriggerConfig;
      const policy = policiesQuery.data?.policies.find(
        (candidate) => candidate.id === selectedItem.id,
      );
      if (!pastTriggerConfig || !policy) return null;

      return (
        <PastTriggerPolicyDetail
          data-component={`${detailBase}_past-trigger`}
          policy={policy}
          pastTriggerConfig={pastTriggerConfig}
        />
      );
    }

    return (
      <DetailContent
        data-component={`${detailBase}_detail-content`}
        item={selectedItem}
      />
    );
  }, [
    policiesQuery.data?.pastTriggerConfig,
    policiesQuery.data?.policies,
    selectedItem,
  ]);
  const detailStatusLabel =
    selectedItem?.kind === "tenant-application" ||
    selectedItem?.kind === "automation-policy" ||
    selectedItem?.kind === "duplicate-send-policy"
      ? selectedItem.statusLabel
      : null;

  return (
    <section
      data-component={SETTINGS_PAGE_BASE}
      data-slot="messages-page"
      data-page="messages-settings"
      className="messages-page flex min-h-0 w-full flex-1"
    >
      <div
        data-component={`${SETTINGS_PAGE_BASE}_screen`}
        className="relative flex min-h-0 w-full flex-1 overflow-hidden"
      >
        <div
          data-component={`${SETTINGS_PAGE_BASE}_screen_content`}
          data-slot="messages-content"
          className="shell-content relative min-h-0 flex-1 flex-col gap-[calc(8px*var(--glint-ui-scale,1))] !overflow-hidden"
        >
          <MessageSectionNav
            data-component={`${SETTINGS_PAGE_BASE}_screen_content_section-nav`}
            activeId="settings"
          />

          <SlidingCard
            data-component={SLIDING_CARD_BASE}
            open={selectedItemId !== null}
            onBack={handleBack}
            backLabel="설정"
            detailKey={selectedItemId}
            list={(
              <SettingsList
                data-component={SETTINGS_LIST_BASE}
                items={items}
                selectedId={selectedItemId}
                onSelect={handleSelect}
                isLoading={isLoading}
                policiesError={policiesQuery.isError}
                onRetryPolicies={() => policiesQuery.refetch()}
                isApproved={approvalQuery.data?.isApproved ?? false}
              />
            )}
            detail={detail}
            detailHeaderTrailing={
              detailStatusLabel ? (
                <StatusPill
                  data-component={`${SLIDING_CARD_BASE}_stage_detail-pane_header_status`}
                  variant="primary"
                  className="!gap-0 !rounded-[calc(999px*var(--glint-ui-scale,1))] !border-[calc(1px*var(--glint-ui-scale,1))] !border-v3-primary/15 !bg-v3-primary-light !px-[calc(8px*var(--glint-ui-scale,1))] !py-[calc(4px*var(--glint-ui-scale,1))] !text-[calc(0.62rem*var(--glint-ui-scale,1))] !text-v3-primary"
                >
                  {detailStatusLabel}
                </StatusPill>
              ) : null
            }
          />
        </div>
      </div>
    </section>
  );
}
