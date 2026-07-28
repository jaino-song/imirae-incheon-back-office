"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    useUnreadCount,
    useNotifications,
    useMarkAsRead,
    useMarkAllAsRead,
    usePushNotification,
    Notification,
} from "@/hooks/usePushNotification";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { FilteredClientsDialog } from "./FilteredClientsDialog";
import { cn } from "@/lib/utils";
import { useScrollActivity } from "@/components/app/v3/useScrollActivity";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

type FilterType = "starting-soon" | "ending-soon" | "incomplete-contracts" | "no-contract";

export type ParsedNotificationUrl =
    | { type: "filter"; filterType: FilterType }
    | { type: "client"; clientId: number }
    | null;

export function parseNotificationUrl(url: string): ParsedNotificationUrl {
    // Match both formats:
    // - /clients/filtered?filter=starting-soon (new format)
    // - /clients?filter=starting-soon (old format)
    const filteredMatch = url.match(/\/clients(?:\/filtered)?\?filter=(.+)/);
    if (filteredMatch) {
        return { type: "filter", filterType: filteredMatch[1] as FilterType };
    }

    const clientMatch = url.match(/\/clients\?id=(\d+)/);
    if (clientMatch) {
        return { type: "client", clientId: parseInt(clientMatch[1]) };
    }

    return null;
}

interface GroupedNotifications {
    date: string;
    label: string;
    notifications: Notification[];
}

function formatDateLabel(date: Date): string {
    return formatDateForDisplay(date);
}

function groupNotificationsByDate(notifications: Notification[]): GroupedNotifications[] {
    if (!Array.isArray(notifications)) {
        return [];
    }
    
    const groups = new Map<string, Notification[]>();

    notifications.forEach((notification) => {
        const date = new Date(notification.sentAt);
        const dateKey = format(date, "yyyy-MM-dd");

        if (!groups.has(dateKey)) {
            groups.set(dateKey, []);
        }
        groups.get(dateKey)!.push(notification);
    });

    return Array.from(groups.entries()).map(([dateKey, items]) => ({
        date: dateKey,
        label: formatDateLabel(new Date(dateKey)),
        notifications: items,
    }));
}

/**
 * Unified Notification Bell Component
 *
 * Handles both subscription and notification display:
 * - Not subscribed: Click to enable notifications (dark gray icon)
 * - Subscribed: Click to view notifications (white icon with primary border)
 */
export function NotificationBell({ className }: { className?: string }) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [subscribeLoading, setSubscribeLoading] = useState(false);
    const { isScrollActive, handleScroll } = useScrollActivity();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogFilterType, setDialogFilterType] = useState<FilterType | null>(null);
    const [dialogClientId, setDialogClientId] = useState<number | undefined>(undefined);

    // Subscription state
    const {
        isSupported,
        isSubscribed,
        permission,
        error: subscriptionError,
        subscribe,
    } = usePushNotification();

    // Notification data (only fetch when subscribed)
    const { data: unreadCount = 0 } = useUnreadCount(isSubscribed);
    const { data: notificationsData, isLoading: notificationsLoading } = useNotifications(10, 0, isSubscribed);
    const notifications = Array.isArray(notificationsData) ? notificationsData : [];

    // Lock body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);
    const markAsRead = useMarkAsRead();
    const markAllAsRead = useMarkAllAsRead();

    const handleClick = async () => {
        if (!isSubscribed) {
            // Not subscribed - try to subscribe
            setSubscribeLoading(true);
            const success = await subscribe();
            setSubscribeLoading(false);

            if (!success) {
                // Show error in popover
                setIsOpen(true);
            }
            // If success, state will update and next click will show notifications
        } else {
            // Subscribed - toggle popover
            setIsOpen(!isOpen);
        }
    };

    const handleNotificationClick = (notification: Notification) => {
        if (!notification.isRead) {
            markAsRead.mutate(notification.id);
        }
        setIsOpen(false);

        if (notification.data?.url) {
            const url = notification.data.url as string;
            const parsed = parseNotificationUrl(url);

            if (parsed) {
                if (parsed.type === "filter") {
                    setDialogFilterType(parsed.filterType);
                    setDialogClientId(undefined);
                } else {
                    setDialogFilterType(null);
                    setDialogClientId(parsed.clientId);
                }
                setDialogOpen(true);
            } else {
                router.push(url);
            }
        }
    };

    const handleDialogClose = () => {
        setDialogOpen(false);
        setDialogFilterType(null);
        setDialogClientId(undefined);
    };

    const handleMarkAllAsRead = () => {
        markAllAsRead.mutate();
    };

    // Render error/warning content in popover
    const renderPopoverContent = () => {
        // Not supported
        if (!isSupported) {
            return (
                <div className="p-4">
                    <Alert variant="warning">
                        <AlertDescription>
                            이 브라우저는 푸시 알림을 지원하지 않습니다.
                            <span className="block text-xs mt-2">
                                Chrome, Firefox, Edge 또는 Safari에서 사용해 주세요.
                            </span>
                        </AlertDescription>
                    </Alert>
                </div>
            );
        }

        // iOS PWA requirement
        const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isPWA = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;

        if (isIOS && !isPWA && !isSubscribed) {
            return (
                <div className="p-4">
                    <Alert>
                        <AlertDescription>
                            <p className="font-bold text-sm">iOS에서 알림을 받으려면:</p>
                            <span className="block text-xs mt-2">
                                1. Safari에서 공유 버튼 탭<br />
                                2. &quot;홈 화면에 추가&quot; 선택<br />
                                3. 홈 화면에서 앱 실행 후 알림 설정
                            </span>
                        </AlertDescription>
                    </Alert>
                </div>
            );
        }

        // Permission denied
        if (permission === 'denied') {
            return (
                <div className="p-4">
                    <Alert variant="destructive">
                        <AlertDescription>
                            알림 권한이 차단되어 있습니다.
                            <span className="block text-xs mt-2">
                                브라우저 설정에서 이 사이트의 알림 권한을 허용해 주세요.
                            </span>
                        </AlertDescription>
                    </Alert>
                </div>
            );
        }

        // Subscription error
        if (subscriptionError && !isSubscribed) {
            return (
                <div className="p-4">
                    <Alert variant="destructive">
                        <AlertDescription>
                            알림 설정 중 오류가 발생했습니다.
                            <span className="block text-xs mt-2">
                                {subscriptionError}
                            </span>
                        </AlertDescription>
                    </Alert>
                </div>
            );
        }

        // Subscribed - show notifications list
        return (
            <>
                <div className="p-4 flex justify-between items-center bg-popover border-b">
                    <h2 className="text-lg font-semibold">알림</h2>
                    {unreadCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleMarkAllAsRead}
                            disabled={markAllAsRead.isPending}
                        >
                            모두 읽음
                        </Button>
                    )}
                </div>

                {notificationsLoading ? (
                    <div className="p-8 flex justify-center">
                        <Spinner size="default" />
                    </div>
                ) : notifications.length === 0 ? (
                    <div className="p-8 text-center">
                        <p className="text-muted-foreground">알림이 없습니다</p>
                    </div>
                ) : (
                    <div
                        className="max-h-80 overflow-y-auto scrollbar-on-scroll"
                        data-scroll-active={isScrollActive ? "true" : "false"}
                        onScroll={handleScroll}
                    >
                        {groupNotificationsByDate(notifications).map((group) => (
                            <div key={group.date}>
                                <div className="px-4 py-2 bg-muted sticky top-0">
                                    <span className="text-xs font-bold text-muted-foreground">
                                        {group.label}
                                    </span>
                                </div>
                                {group.notifications.map((notification) => (
                                    <button
                                        type="button"
                                        key={notification.id}
                                        onClick={() => handleNotificationClick(notification)}
                                        data-testid={notification.isRead ? 'notification-item' : 'notification-item-unread'}
                                        className={`
                                            w-full px-4 py-3 cursor-pointer border-b transition-colors text-left
                                            ${notification.isRead ? 'bg-transparent' : 'bg-accent'}
                                            hover:bg-accent/80
                                        `}
                                    >
                                        <div className="flex justify-between items-center">
                                            <p className={`text-sm ${notification.isRead ? 'font-normal' : 'font-bold'}`}>
                                                {notification.title}
                                            </p>
                                            <span className="text-xs text-muted-foreground ml-2 shrink-0">
                                                {format(new Date(notification.sentAt), "a h:mm", { locale: ko })}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground truncate mt-1">
                                            {notification.body}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </>
        );
    };

    const isLoading = subscribeLoading;

    return (
        <>
            {isOpen && typeof document !== "undefined" && createPortal(
                <button
                    type="button"
                    aria-label="닫기"
                    className={`fixed inset-0 top-16 bg-black/30 backdrop-blur-[4px] z-40 sm:hidden transition-all duration-300 ${isOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}
                    onClick={() => setIsOpen(false)}
                />,
                document.body
            )}
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleClick}
                        disabled={isLoading}
                        data-component="desktop_chrome_notification-bell"
                        data-testid="notification-bell"
                        className={cn("relative transition-transform duration-200 hover:scale-110 active:scale-95", className)}
                    >
                        {isLoading ? (
                            <Spinner size="sm" />
                        ) : isSubscribed ? (
                            <>
                                <Bell className="!h-5 !w-5" />
                                {unreadCount > 0 && (
                                    <Badge
                                        data-testid="notification-badge"
                                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full p-0 text-xs animate-bounce-subtle"
                                    >
                                        {unreadCount > 99 ? '99+' : unreadCount}
                                    </Badge>
                                )}
                            </>
                        ) : (
                            <BellOff className="h-5 w-5 text-muted-foreground" />
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="end"
                    sideOffset={8}
                    avoidCollisions={true}
                    collisionPadding={16}
                    className="!w-[80vw] sm:!w-[360px] max-h-[480px] p-0 overflow-hidden"
                    data-component="desktop_chrome_notification-bell_popover"
                    data-testid="notification-popover"
                >
                    {renderPopoverContent()}
                </PopoverContent>
            </Popover>

            <FilteredClientsDialog
                open={dialogOpen}
                onClose={handleDialogClose}
                filterType={dialogFilterType}
                clientId={dialogClientId}
            />
        </>
    );
}
