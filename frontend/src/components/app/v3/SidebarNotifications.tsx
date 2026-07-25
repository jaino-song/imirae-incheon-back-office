"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell, Headset, Users, X } from "lucide-react";

import { useClientAlerts } from "@/hooks/useClientAlerts";
import { useMarkAsRead, useNotifications, type Notification } from "@/hooks/usePushNotification";
import type { ActionRequiredReason, ActionRequiredStatus } from "@/lib/client/action-required";
import { PanelTitleGroup } from "@/components/app/v3/PanelTitleGroup";
import { useScrollActivity } from "@/components/app/v3/useScrollActivity";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { AnimatedSlotList } from "@/components/app/v3/AnimatedSlotList";
import { AnimatedSlotListItemContent } from "@/components/app/v3/AnimatedSlotListItemContent";
import { cn } from "@/lib/utils";

interface SidebarNotificationItem {
    id: string;
    name: string;
    createdAt: string | null;
    notificationId?: number;
    message: string;
    url?: string;
    timeLabel: string;
    unread: boolean;
    tone: "default" | "warning";
    icon: "client" | "consultation";
    actionReason?: ActionRequiredReason;
    actionPriority?: ActionRequiredStatus["priority"];
}

const SIDEBAR_NOTIFICATIONS_MODAL_WIDTH = 400;

const getNotificationIconContainerClassName = (notification: SidebarNotificationItem) => {
  if (notification.tone === "warning") {
    return "border border-[hsla(38,92%,35%,0.18)] bg-[hsl(47,100%,92%)] text-[hsl(38,92%,35%)]";
  }

  if (notification.icon === "consultation") {
    return "border border-[hsl(214,70%,85%)] bg-[hsl(214,80%,95%)] text-v3-primary";
  }

  return "border border-[hsl(214,70%,85%)] bg-[hsl(214,80%,95%)] text-v3-primary";
};

const getNotificationStatusVariant = (
  priority: ActionRequiredStatus["priority"] = 3,
) => {
  return priority === 1 ? "danger" : priority === 2 ? "warning" : "primary";
};

const getNotificationUrl = (notification: Notification): string | undefined => {
  const url = notification.data?.url;
  return typeof url === "string" ? url : undefined;
};

const formatNotificationTime = (value: string | Date | null | undefined) => {
  if (!value) {
    return "-";
  }

  const createdAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(createdAt.getTime())) {
    return "-";
  }

  const now = new Date();
  const diffMinutes = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60));

  if (diffMinutes < 0) {
    return createdAt.toLocaleTimeString("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  if (diffMinutes < 1) {
    return "방금 전";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  if (diffMinutes <= 180) {
    return `${Math.floor(diffMinutes / 60)}시간 전`;
  }

  return createdAt.toLocaleTimeString("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

export function SidebarNotifications() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [modalPosition, setModalPosition] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const { isScrollActive, handleScroll } = useScrollActivity();
  const { data: alerts = [] } = useClientAlerts(3);
  const { data: savedNotifications = [] } = useNotifications(5, 0, true);
  const markAsRead = useMarkAsRead();

  const notifications = React.useMemo<SidebarNotificationItem[]>(() => {
    const actionItems: SidebarNotificationItem[] = alerts.map((alert) => {
      const message = alert.reason === "교체 요청"
        ? "교체 요청이 접수되었습니다."
        : alert.reason === "이용자 완료 필요"
          ? "서비스 시작 전 서명이 필요합니다."
          : "서비스 시작 전 문서 발송이 필요합니다.";

      return {
        id: `action-${alert.id}`,
        name: alert.name,
        createdAt: alert.createdAt,
        message,
        url: `/dashboard?clientId=${alert.id}`,
        timeLabel: formatNotificationTime(alert.createdAt),
        unread: true,
        tone: alert.priority === 1 ? "warning" : "default",
        icon: "client" as const,
        actionReason: alert.reason,
        actionPriority: alert.priority,
      };
    });

    const notificationItems: SidebarNotificationItem[] = savedNotifications.map((notification) => {
      const url = getNotificationUrl(notification);
      const isConsultation = notification.data?.type === "consultation-inquiry";

      return {
        id: `notification-${notification.id}`,
        notificationId: notification.id,
        name: notification.title,
        createdAt: notification.sentAt,
        message: notification.body,
        url,
        timeLabel: formatNotificationTime(notification.sentAt),
        unread: !notification.isRead,
        tone: isConsultation ? "warning" : "default",
        icon: isConsultation ? "consultation" as const : "client" as const,
      };
    });

    return [...notificationItems, ...actionItems]
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .slice(0, 6);
  }, [alerts, savedNotifications]);

  const unreadCount = notifications.filter((item) => item.unread).length;

  const handleNotificationClick = (notification: SidebarNotificationItem) => {
    if (notification.notificationId && notification.unread) {
      markAsRead.mutate(notification.notificationId);
    }

    if (notification.url) {
      setOpen(false);
      router.push(notification.url);
    }
  };

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open) {
      setModalPosition(null);
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const modalWidth = SIDEBAR_NOTIFICATIONS_MODAL_WIDTH;
      const viewportWidth = window.innerWidth;
      const maxLeft = Math.max(12, viewportWidth - modalWidth - 12);
      setModalPosition({
        top: rect.bottom + 12,
        left: Math.min(maxLeft, Math.max(12, rect.left)),
      });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open]);

  const portalContent = open
    ? createPortal(
        <>
          <button
            type="button"
            aria-label="알림 닫기"
            data-component="sidebar-notifications-backdrop"
            className="fixed inset-0 z-[999] bg-slate-950/34 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />

          {modalPosition ? (
            <div
              data-component="sidebar-notifications-modal"
              className="fixed z-[1000] w-[25rem] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden"
              style={{ top: modalPosition.top, left: modalPosition.left }}
            >
              <div className="flex items-start justify-between p-6 pb-4 shrink-0">
                <PanelTitleGroup
                  data-component="desktop_chrome_sidebar_notifications-modal_title-group"
                  title="알림"
                  titleClassName="text-xl"
                />
                <button
                  type="button"
                  aria-label="알림 닫기"
                  data-component="sidebar-notifications-close"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-v3-text-muted transition-colors hover:bg-v3-dim-white hover:text-v3-dark"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div
                className="relative overflow-y-auto scrollbar-on-scroll min-h-0 flex-1 px-6 pt-3 flex flex-col"
                data-scroll-active={isScrollActive ? "true" : "false"}
                onScroll={handleScroll}
              >
                {notifications.length ? (
                  <AnimatedSlotList<SidebarNotificationItem>
                    items={notifications}
                    isLoading={false}
                    itemDataComponent="sidebar-notifications-item"
                    getItemKey={(notification) => notification.id}
                    onSlotClick={(notification) => handleNotificationClick(notification)}
                    getSlotState={({ item }) => ({
                      isInteractive: Boolean(item),
                    })}
                    slotClassName={({ item }) =>
                      cn(
                        "hover:!border-transparent hover:!bg-v3-primary-light/55",
                        item?.unread && "border-v3-primary/20 bg-v3-primary-light/20 hover:!border-v3-primary/20 hover:!bg-v3-primary-light/65",
                      )
                    }
                    render={({ item }) => {
                      if (!item) return null;

                      const Icon = item.icon === "consultation" ? Headset : Users;

                      return (
                        <AnimatedSlotListItemContent
                          dataComponent="sidebar-notifications-item-content"
                          icon={Icon}
                          iconContainerClassName={getNotificationIconContainerClassName(item)}
                          title={item.name}
                          subtitle={item.message}
                          status={
                            <div className="relative flex shrink-0 items-center justify-center">
                              {item.actionReason ? (
                                <StatusPill
                                  variant={getNotificationStatusVariant(item.actionPriority)}
                                  size="sm"
                                >
                                  {item.actionReason}
                                </StatusPill>
                              ) : null}
                              <span className="absolute left-1/2 top-full mt-[calc(4px*var(--glint-ui-scale,1))] inline-flex -translate-x-1/2 items-center whitespace-nowrap text-center text-[calc(10.4px*var(--glint-ui-scale,1))] font-medium text-v3-text-muted">
                                {item.timeLabel}
                              </span>
                            </div>
                          }
                        />
                      );
                    }}
                  />
                ) : (
                  <div
                    data-component="sidebar-notifications-empty"
                    className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center"
                  >
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-v3-dim-white text-v3-text-muted">
                      <Bell className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[0.85rem] font-semibold text-v3-dark">새 알림이 없습니다</p>
                      <p className="mt-1 text-[0.74rem] leading-5 text-v3-text-muted">
                        확인이 필요한 일정이나 상태 변경이 생기면 여기에 표시됩니다.
                      </p>
                    </div>
                  </div>
                )}
                <div className="sticky bottom-0 h-6 bg-white shrink-0" />
              </div>
            </div>
          ) : null}
        </>,
        document.body
      )
    : null;

  return (
    <div data-component="sidebar-notifications" className="relative ml-auto">
      <Button
        ref={triggerRef}
        type="button"
        size="icon"
        variant="ghost"
        data-component="sidebar-notifications-trigger"
        aria-label="알림 열기"
        aria-expanded={open}
        className={cn(
          "relative z-50 h-[calc(32px*var(--glint-ui-scale,1))] w-[calc(32px*var(--glint-ui-scale,1))] rounded-full border-0 bg-white text-v3-primary shadow-none [&_svg]:!size-[calc(20px*var(--glint-ui-scale,1))]",
          "hover:bg-v3-primary-light hover:text-v3-primary"
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={20} />
        {unreadCount > 0 ? (
          <span
            data-component="sidebar-notifications-badge"
            className="absolute -right-[calc(4px*var(--glint-ui-scale,1))] -top-[calc(4px*var(--glint-ui-scale,1))] inline-flex h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(16px*var(--glint-ui-scale,1))] items-center justify-center rounded-full bg-v3-primary p-0 text-[calc(8.8px*var(--glint-ui-scale,1))] font-bold leading-none text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </Button>
      {portalContent}
    </div>
  );
}
