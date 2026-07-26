"use client";

import { useState } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/client";

interface BroadcastResult {
  sent: number;
  failed: number;
}

export function NotificationTestSection() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTestBroadcast = async () => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const { data } = await api.post<BroadcastResult>("/notifications/test-broadcast");
      setResult(data);
    } catch {
      setError("알림 전송에 실패했습니다. 구독 상태와 서버 설정을 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-component="desktop_settings_sections_notification-test" className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-v3-primary-light text-v3-primary">
            <Bell className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-v3-dark">전체 구독 디바이스</p>
            <p className="mt-0.5 text-sm leading-5 text-v3-text-muted">
              실제 테스트 푸시가 즉시 전송됩니다.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="md"
          variant="positive"
          onClick={handleTestBroadcast}
          disabled={loading}
          className="w-full gap-2 sm:w-auto sm:self-start"
        >
          {loading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <Bell className="h-4 w-4" aria-hidden="true" />
          )}
          {loading ? "전송 중…" : "테스트 알림 보내기"}
        </Button>
      </div>

      <div aria-live="polite">
        {result ? (
          <div
            role="status"
            className="rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          >
            전송 완료: 성공 {result.sent}건, 실패 {result.failed}건
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
