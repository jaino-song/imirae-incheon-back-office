"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";

const NOTIFICATION_PROMPT_DISMISSED_AT_KEY =
    "babyjamjam-mobile:notification-prompt-dismissed-at";
const NOTIFICATION_PROMPT_DISMISSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function NotificationPermissionPrompt() {
    const [showBanner, setShowBanner] = useState(false);
    const pathname = usePathname() ?? "";
    const excluded = isLayoutExcluded(pathname);
    const hasBottomNav =
        !excluded && !pathname.startsWith("/clients/new");

    useEffect(() => {
        if (typeof window === 'undefined' || excluded) return;
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'default') return;

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

        const timer = window.setTimeout(() => setShowBanner(true), 0);
        return () => window.clearTimeout(timer);
    }, [excluded]);

    if (!showBanner || excluded) return null;

    const handleEnable = async () => {
        const permission = await Notification.requestPermission();
        if (permission !== 'default') {
            setShowBanner(false);
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
            className="fixed left-4 right-4 md:left-auto md:right-6 md:w-96 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4"
            style={{
                bottom: hasBottomNav
                    ? "calc(env(safe-area-inset-bottom) + 5rem)"
                    : "calc(env(safe-area-inset-bottom) + 1rem)",
            }}
        >
            <div className="flex-shrink-0 text-2xl">🔔</div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    알림을 허용하시겠습니까?
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    서비스 일정, 계약서 알림 등을 받을 수 있습니다.
                </p>
                <div className="flex gap-2 mt-2">
                    <button
                        onClick={handleEnable}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-2xl transition-colors"
                    >
                        허용
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-2xl transition-colors"
                    >
                        나중에
                    </button>
                </div>
            </div>
            <button
                onClick={handleDismiss}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label="닫기"
            >
                ✕
            </button>
        </div>
    );
}
