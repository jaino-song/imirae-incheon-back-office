"use client";

import type { ClientRegistrationPolicyAutomationStatus } from "@/services/api";

const SOURCE_COMPONENT = "AutomationStatusNotice";

interface AutomationStatusNoticeProps {
    enabled: boolean;
    /** 구버전 백엔드 응답에는 없다. 없으면 트리거 상태 줄을 숨긴다. */
    automation?: ClientRegistrationPolicyAutomationStatus;
    "data-component": string;
}

function describeWebhookDelivery(webhookConfigured: boolean): string {
    return webhookConfigured
        ? "웹훅 수신 설정 완료 — 계약서 변경이 즉시 반영됩니다."
        : "웹훅 수신 설정 없음 — 변경 사항이 최대 6시간 내 주기 동기화로 반영됩니다.";
}

function describeSweep(automation: ClientRegistrationPolicyAutomationStatus): string {
    if (automation.sweepRunnable) {
        return "주기 동기화 정상 — 웹훅 유실분을 6시간마다 다시 확인합니다.";
    }
    if (automation.sweepEnabled) {
        return "주기 동기화 중단 — VALKEY_URL 설정 또는 단일 인스턴스 실행 승인이 필요합니다.";
    }
    return "주기 동기화 비활성 — eformsign 연동 설정을 확인해 주세요.";
}

/**
 * 자동 고객 등록의 실제 트리거와 운영 상태를 안내한다. 토글 자체는 정책 스위치일
 * 뿐이고, 등록은 웹훅·주기 동기화(미러) 트리거가 현실화하므로 그 상태를 함께
 * 보여준다.
 */
export function AutomationStatusNotice({
    enabled,
    automation,
    "data-component": dataComponent,
}: AutomationStatusNoticeProps) {
    return (
        <div
            data-component={dataComponent}
            data-source-component={SOURCE_COMPONENT}
            className="space-y-2"
        >
            <p className="text-[0.85rem] leading-6 text-v3-text-muted">
                {enabled
                    ? "앱에서 발송한 계약서는 발송 시점에 고객이 먼저 등록됩니다. eformsign에서 직접 만든 계약서는 도착하거나 완결되는 시점에 고객이 자동으로 등록·연결됩니다."
                    : "자동 고객 등록이 꺼져 있습니다. 켜면 eformsign에서 직접 만든 계약서가 도착할 때 고객이 자동으로 등록됩니다."}
            </p>
            {enabled && automation ? (
                <ul
                    data-component={`${dataComponent}_status-list`}
                    data-slot="automation-status-list"
                    className="space-y-1 text-[0.8rem] leading-5 text-v3-text-muted"
                >
                    <li
                        data-component={`${dataComponent}_status-list_webhook-item`}
                        data-slot="automation-status-webhook"
                    >
                        {describeWebhookDelivery(automation.webhookConfigured)}
                    </li>
                    <li
                        data-component={`${dataComponent}_status-list_sweep-item`}
                        data-slot="automation-status-sweep"
                    >
                        {describeSweep(automation)}
                    </li>
                </ul>
            ) : null}
        </div>
    );
}
