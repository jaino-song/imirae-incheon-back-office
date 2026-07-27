"use client";

import { Bell, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

const NOTIFICATION_PROMPT_DISMISSED_AT_KEY =
    "babyjamjam-admin:notification-prompt-dismissed-at";
const NOTIFICATION_PROMPT_DISMISSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function NotificationPermissionPrompt() {
    const [showBanner, setShowBanner] = useState(false);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'default') {
            try {
                window.localStorage.removeItem(NOTIFICATION_PROMPT_DISMISSED_AT_KEY);
            } catch {
                // Ignore unavailable storage after the browser has resolved permission.
            }
            return;
        }

        try {
            const dismissedAt = Number(
                window.localStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_AT_KEY),
            );
            const elapsedSinceDismissal = Date.now() - dismissedAt;
            if (
                dismissedAt > 0
                && elapsedSinceDismissal >= 0
                && elapsedSinceDismissal < NOTIFICATION_PROMPT_DISMISSAL_TTL_MS
            ) {
                return;
            }
        } catch {
            // Continue when storage is unavailable so permission can still be requested.
        }

        queueMicrotask(() => {
            setShowBanner(true);
        });
    }, []);

    if (!showBanner) return null;

    const handleEnable = async () => {
        const permission = await Notification.requestPermission();
        setShowBanner(false);

        try {
            if (permission === 'default') {
                window.localStorage.setItem(
                    NOTIFICATION_PROMPT_DISMISSED_AT_KEY,
                    String(Date.now()),
                );
            } else {
                window.localStorage.removeItem(NOTIFICATION_PROMPT_DISMISSED_AT_KEY);
            }
        } catch {
            // Keep the current-session dismissal when storage is unavailable.
        }
    };

    const handleDismiss = () => {
        setShowBanner(false);
        if (typeof window === 'undefined') return;

        try {
            window.localStorage.setItem(
                NOTIFICATION_PROMPT_DISMISSED_AT_KEY,
                String(Date.now()),
            );
        } catch {
            // Keep the current-session dismissal when storage is unavailable.
        }
    };

    return (
        <div
            data-component="desktop_chrome_notification-permission-prompt"
            role="dialog"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="fixed bottom-20 left-4 right-4 z-50 flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-lg animate-in slide-in-from-bottom-4 dark:border-gray-700 dark:bg-gray-800 md:bottom-6 md:left-auto md:right-[calc(24px+72px*var(--glint-ui-scale,1))] md:w-96"
        >
            <div
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-v3-orange-light text-v3-orange"
            >
                <Bell className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
                <p id={titleId} className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    알림을 허용하시겠습니까?
                </p>
                <p id={descriptionId} className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    서비스 일정, 계약서 알림 등을 받을 수 있습니다.
                </p>
                <div className="flex gap-2 mt-2">
                    <button
                        type="button"
                        onClick={handleEnable}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                    >
                        허용
                    </button>
                    <button
                        type="button"
                        onClick={handleDismiss}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-2 dark:text-gray-400 dark:hover:bg-gray-700"
                    >
                        나중에
                    </button>
                </div>
            </div>
            <button
                type="button"
                onClick={handleDismiss}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-2 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                aria-label="알림 권한 안내 닫기"
            >
                <X className="h-4 w-4" aria-hidden="true" />
            </button>
        </div>
    );
}
