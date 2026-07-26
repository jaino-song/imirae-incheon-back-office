"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

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
      const { data } = await api.post<BroadcastResult>('/notifications/test-broadcast');
      setResult(data);
    } catch {
      setError('알림 전송에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-component="mobile_notification_settings_test-section"
      className="space-y-4"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-2xl bg-primary/10">
          <Bell size={18} className="text-primary" />
        </div>
        <div>
           <h3 className="text-lg font-bold">알림 테스트</h3>
           <p className="text-sm text-muted-foreground">
             모든 구독된 디바이스에 테스트 알림을 전송합니다.
           </p>
        </div>
      </div>

      <Button
        onClick={handleTestBroadcast}
        disabled={loading}
        className="gap-2 rounded-full px-6"
      >
        {loading ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <Bell size={16} />
        )}
        {loading ? '전송 중...' : '테스트 알림 보내기'}
      </Button>


      {result && (
        <Alert className="mt-4 bg-success/10 border-success/30 text-success">
          <AlertDescription>
            전송 완료 - 성공: {result.sent}건 / 실패: {result.failed}건
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
