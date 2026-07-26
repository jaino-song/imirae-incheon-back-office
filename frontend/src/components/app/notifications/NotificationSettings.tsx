"use client";

import { useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { usePushNotification } from "@/hooks/usePushNotification";

/**
 * Notification Settings Component
 *
 * Allows users to subscribe/unsubscribe from PWA push notifications.
 * Shows current subscription status and handles permission requests.
 */
export function NotificationSettings() {
    const {
        isSupported,
        isSubscribed,
        permission,
        isLoading,
        error,
        subscribe,
        unsubscribe,
    } = usePushNotification();

    const [actionLoading, setActionLoading] = useState(false);

    const handleToggle = async () => {
        setActionLoading(true);
        try {
            if (isSubscribed) {
                await unsubscribe();
            } else {
                await subscribe();
            }
        } finally {
            setActionLoading(false);
        }
    };

    // Not supported message
    if (!isSupported) {
        return (
            <Alert variant="warning" className="mt-4">
                <AlertDescription>
                    이 브라우저는 푸시 알림을 지원하지 않습니다.
                    <span className="block text-xs mt-2">
                        Chrome, Firefox, Edge 또는 Safari에서 사용해 주세요.
                    </span>
                </AlertDescription>
            </Alert>
        );
    }

    // iOS PWA requirement message
    const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isPWA = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;

    if (isIOS && !isPWA) {
        return (
            <Alert className="mt-4">
                <AlertDescription>
                    <p className="font-bold text-sm">iOS에서 알림을 받으려면:</p>
                    <span className="block text-xs mt-2">
                        1. Safari에서 공유 버튼 탭<br />
                        2. &quot;홈 화면에 추가&quot; 선택<br />
                        3. 홈 화면에서 앱 실행 후 알림 설정
                    </span>
                </AlertDescription>
            </Alert>
        );
    }

    // Permission denied message
    if (permission === 'denied') {
        return (
            <Alert variant="destructive" className="mt-4">
                <AlertDescription>
                    알림 권한이 차단되어 있습니다.
                    <span className="block text-xs mt-2">
                        브라우저 설정에서 이 사이트의 알림 권한을 허용해 주세요.
                    </span>
                </AlertDescription>
            </Alert>
        );
    }

    const loading = isLoading || actionLoading;

    return (
        <Card data-component="desktop_admin_notification-settings" className="p-4 mt-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {isSubscribed ? (
                        <Bell className="h-5 w-5 text-primary" />
                    ) : (
                        <BellOff className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                        <p className="text-base font-medium">푸시 알림</p>
                        <p className="text-xs text-muted-foreground">
                            {isSubscribed ? '알림을 받고 있습니다' : '알림이 비활성화되어 있습니다'}
                        </p>
                    </div>
                </div>

                {loading ? (
                    <Spinner size="sm" />
                ) : (
                    <div className="flex items-center gap-2">
                        <Label htmlFor="notification-switch" className="sr-only">
                            푸시 알림 설정
                        </Label>
                        <Switch
                            id="notification-switch"
                            checked={isSubscribed}
                            onCheckedChange={handleToggle}
                            disabled={loading}
                        />
                    </div>
                )}
            </div>

            {error && (
                <Alert variant="destructive" className="mt-4">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
        </Card>
    );
}

/**
 * Quick Subscribe Button
 *
 * Simple button to enable notifications from anywhere in the app.
 */
export function NotificationSubscribeButton() {
    const { isSupported, isSubscribed, isLoading, subscribe } = usePushNotification();
    const [loading, setLoading] = useState(false);

    if (!isSupported || isSubscribed) {
        return null;
    }

    const handleClick = async () => {
        setLoading(true);
        try {
            await subscribe();
        } finally {
            setLoading(false);
        }
    };

    return (
        <Button
            variant="outline"
            size="sm"
            onClick={handleClick}
            disabled={isLoading || loading}
        >
            {loading ? (
                <Spinner size="sm" className="mr-2" />
            ) : (
                <Bell className="h-4 w-4 mr-2" />
            )}
            알림 받기
        </Button>
    );
}
