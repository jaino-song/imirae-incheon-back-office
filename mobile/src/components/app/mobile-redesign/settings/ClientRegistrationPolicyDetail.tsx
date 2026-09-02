"use client";

import type { ReactElement } from "react";

import { Switch } from "@/components/ui/switch";

import { useClientRegistrationPolicy } from "./use-client-registration-policy";

const SOURCE_COMPONENT = "ClientRegistrationPolicyDetail";

export interface ClientRegistrationPolicyDetailProps {
  "data-component": string;
}

export function ClientRegistrationPolicyDetail({
  "data-component": dataComponent,
}: ClientRegistrationPolicyDetailProps): ReactElement {
  const { policy, isLoading, updatePolicy } = useClientRegistrationPolicy();
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
  const switchesDisabled = isLoading || updatePolicy.isPending;

  return (
    <section
      data-component={dataComponent}
      data-slot="info-card"
      data-source-component={SOURCE_COMPONENT}
      className="info-card !flex !flex-col !gap-[calc(4px*var(--glint-ui-scale,1))] !rounded-[calc(18px*var(--glint-ui-scale,1))] !px-[calc(16px*var(--glint-ui-scale,1))] !py-[calc(14px*var(--glint-ui-scale,1))]"
      aria-busy={isLoading}
    >
      <div
        data-component={sub("title")}
        data-slot="info-card-title"
        className="info-card-title !mb-0 !text-[calc(0.6rem*var(--glint-ui-scale,1))]"
      >
        설정
      </div>

      <div
        data-component={sub("client-auto-registration")}
        data-slot="info-row"
        className="flex items-center gap-[calc(14px*var(--glint-ui-scale,1))] border-b-[calc(1px*var(--glint-ui-scale,1))] border-v3-border py-[calc(11px*var(--glint-ui-scale,1))]"
      >
        <div
          data-component={sub("client-auto-registration_copy")}
          className="flex min-w-0 flex-1 flex-col gap-[calc(4px*var(--glint-ui-scale,1))]"
        >
          <span
            data-component={sub("client-auto-registration_copy_label")}
            className="text-[calc(0.78rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.08rem*var(--glint-ui-scale,1))] text-v3-dark"
          >
            eformsign 계약서 도착 시 고객 자동 등록
          </span>
          <span
            data-component={sub("client-auto-registration_copy_description")}
            className="text-[calc(0.66rem*var(--glint-ui-scale,1))] leading-[calc(0.98rem*var(--glint-ui-scale,1))] text-v3-text-muted"
          >
            eformsign 계약서가 도착하거나 완결되면 산모를 고객 목록에 자동으로 등록합니다.
          </span>
        </div>
        <Switch
          data-component={sub("client-auto-registration_switch")}
          thumbDataComponent={sub("client-auto-registration_switch_thumb")}
          aria-label="eformsign 계약서 도착 시 고객 자동 등록"
          checked={policy?.clientAutoRegistration === true}
          disabled={switchesDisabled || !policy}
          className="[--v3-ui-scale:var(--glint-ui-scale,1)]"
          onCheckedChange={(checked) =>
            updatePolicy.mutate({ clientAutoRegistration: checked })
          }
        />
      </div>

      <div
        data-component={sub("greeting-on-auto-registration")}
        data-slot="info-row"
        className="flex items-center gap-[calc(14px*var(--glint-ui-scale,1))] py-[calc(11px*var(--glint-ui-scale,1))]"
      >
        <div
          data-component={sub("greeting-on-auto-registration_copy")}
          className="flex min-w-0 flex-1 flex-col gap-[calc(4px*var(--glint-ui-scale,1))]"
        >
          <span
            data-component={sub("greeting-on-auto-registration_copy_label")}
            className="text-[calc(0.78rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.08rem*var(--glint-ui-scale,1))] text-v3-dark"
          >
            자동 등록 시 인사 문자 발송
          </span>
          <span
            data-component={sub("greeting-on-auto-registration_copy_description")}
            className="text-[calc(0.66rem*var(--glint-ui-scale,1))] leading-[calc(0.98rem*var(--glint-ui-scale,1))] text-v3-text-muted"
          >
            자동 등록된 고객에게 인사 문자를 함께 발송합니다.
          </span>
        </div>
        <Switch
          data-component={sub("greeting-on-auto-registration_switch")}
          thumbDataComponent={sub("greeting-on-auto-registration_switch_thumb")}
          aria-label="자동 등록 시 인사 문자 발송"
          checked={policy?.greetingOnAutoRegistration === true}
          disabled={
            switchesDisabled || !policy?.clientAutoRegistration
          }
          className="[--v3-ui-scale:var(--glint-ui-scale,1)]"
          onCheckedChange={(checked) =>
            updatePolicy.mutate({ greetingOnAutoRegistration: checked })
          }
        />
      </div>
    </section>
  );
}
