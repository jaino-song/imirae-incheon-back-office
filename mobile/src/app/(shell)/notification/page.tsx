"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Mail, Send, type LucideIcon } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { usePushNotification } from "@/hooks/usePushNotification";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api/client";
import { useInitialUser } from "@/providers/UserProvider";
import { settingsApi } from "@/services/api";
import {
  NOTIFICATION_EMAIL_ENABLED,
  PWA_NOTIFICATIONS_ENABLED,
} from "@/lib/notification-config";
import "@/components/app/mobile-redesign/redesign.css";

/** Canonical data-component base for the /notification settings route. */
const NOTIFICATION_SETTINGS_BASE = "mobile_notification_settings";
const NOTIFICATION_SETTINGS_SCROLL = `${NOTIFICATION_SETTINGS_BASE}_content_card_scroll`;
const NOTIFICATION_SETTINGS_CHANNEL_SECTION = `${NOTIFICATION_SETTINGS_SCROLL}_channel-section`;
const NOTIFICATION_SETTINGS_ADMIN_SECTION = `${NOTIFICATION_SETTINGS_SCROLL}_admin-section`;

const NOTIFICATION_ROUTE_BODY_CLASS = "mobile-all-route";

interface BroadcastResult {
  sent: number;
  failed: number;
}

interface NotificationSettingsRowProps {
  /** Canonical data-component value for this row. */
  dataComponent: string;
  label: string;
  icon: LucideIcon;
  tone: "primary" | "orange" | "green" | "purple" | "muted" | "burgundy";
  description: ReactNode;
  rightContent?: ReactNode;
  className?: string;
}

function NotificationSettingsRow({
  dataComponent,
  label,
  icon: Icon,
  tone,
  description,
  rightContent,
  className,
}: NotificationSettingsRowProps) {
  return (
    <div
      className={`list-item notification-settings-row ${className ?? ""}`}
      data-component={dataComponent}
      data-slot="notification-settings-row"
    >
      <div
        className={`trigger-icon trigger-icon-${tone}`}
        data-component={`${dataComponent}_icon`}
      >
        <Icon size={18} strokeWidth={2.5} />
      </div>

      <div className="trigger-info" data-component={`${dataComponent}_info`}>
        <div className="trigger-title" data-component={`${dataComponent}_info_title`}>
          {label}
        </div>
        <div className="trigger-meta" data-component={`${dataComponent}_info_meta`}>
          {description}
        </div>
      </div>

      {rightContent ? (
        <div className="notification-row-control" data-component={`${dataComponent}_control`}>
          {rightContent}
        </div>
      ) : null}
    </div>
  );
}

export default function NotificationPage() {
  const [isAppNotificationUpdating, setIsAppNotificationUpdating] = useState(false);

  const { toast } = useToast();
  const initialUser = useInitialUser();
  const { data: user } = useGetAuthUser({ initialData: initialUser });
  const queryClient = useQueryClient();
  const {
    isSupported: isAppNotificationSupported,
    isSubscribed: isAppNotificationEnabled,
    permission: appNotificationPermission,
    isLoading: isAppNotificationLoading,
    error: appNotificationError,
    subscribe: subscribeAppNotifications,
    unsubscribe: unsubscribeAppNotifications,
  } = usePushNotification();
  const isOwner = user?.role === "owner";
  const accountEmail = user?.email?.trim() ?? "";
  const emailNotificationUserId = user?.id ?? "";
  const notificationPreferencesQueryKey = [
    "settings",
    "notification-preferences",
    emailNotificationUserId,
  ] as const;
  const notificationPreferencesQuery = useQuery({
    queryKey: notificationPreferencesQueryKey,
    queryFn: settingsApi.getNotificationPreferences,
    enabled: Boolean(emailNotificationUserId),
  });
  const updateNotificationPreferencesMutation = useMutation({
    mutationFn: settingsApi.updateNotificationPreferences,
    onSuccess: (data) => {
      queryClient.setQueryData(notificationPreferencesQueryKey, data);
    },
    onError: () => {
      toast({
        title: "이메일 알림 설정을 저장하지 못했어요",
        description: "이전 설정을 유지합니다",
        variant: "destructive",
      });
    },
  });
  const appNotificationDisabled =
    isAppNotificationLoading
    || isAppNotificationUpdating
    || !PWA_NOTIFICATIONS_ENABLED
    || !isAppNotificationSupported
    || appNotificationPermission === "denied";
  const appNotificationDescription = !PWA_NOTIFICATIONS_ENABLED
    ? "앱 알림은 현재 비활성화되어 있습니다."
    : !isAppNotificationSupported
    ? "이 브라우저는 앱 알림을 지원하지 않습니다."
    : appNotificationPermission === "denied"
      ? "브라우저에서 알림 권한이 차단되어 있습니다."
      : isAppNotificationEnabled
        ? "앱에서 중요한 업무 알림을 받고 있습니다."
        : "앱에서 중요한 업무 알림을 받지 않습니다.";
  const emailNotificationDescription = !NOTIFICATION_EMAIL_ENABLED
    ? "이메일 알림은 현재 비활성화되어 있습니다."
    : !accountEmail
      ? "현재 계정 이메일을 불러오는 중입니다."
      : notificationPreferencesQuery.isFetching
        ? "이메일 알림 설정을 불러오는 중입니다."
        : notificationPreferencesQuery.isError
          ? "이메일 알림 설정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
          : updateNotificationPreferencesMutation.isError
            ? "이메일 알림 설정을 저장하지 못했어요. 이전 설정을 유지합니다."
            : `${accountEmail}로 주요 알림을 받습니다.`;

  const testNotificationMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<BroadcastResult>("/notifications/test-broadcast");
      return data;
    },
    onSuccess: (data) => {
      toast({
        variant: "success",
        title: "테스트 알림을 보냈어요",
        description: `성공 ${data.sent}건 · 실패 ${data.failed}건`,
      });
    },
    onError: () => {
      toast({
        title: "테스트 알림을 보내지 못했어요",
        description: "잠시 후 다시 시도해 주세요",
        variant: "destructive",
      });
    },
  });

  const handleAppNotificationChange = async (checked: boolean) => {
    setIsAppNotificationUpdating(true);
    const success = checked
      ? await subscribeAppNotifications()
      : await unsubscribeAppNotifications();
    setIsAppNotificationUpdating(false);

    if (!success) {
      toast({
        title: "앱 알림 설정을 바꾸지 못했어요",
        description: checked
          ? "앱 알림을 켜지 못했어요. 브라우저 알림 권한을 확인해 주세요"
          : "앱 알림을 끄지 못했어요. 잠시 후 다시 시도해 주세요",
        variant: "destructive",
      });
    }
  };

  const handleEmailNotificationChange = (checked: boolean) => {
    updateNotificationPreferencesMutation.mutate(checked);
  };

  useEffect(() => {
    document.body.classList.add(NOTIFICATION_ROUTE_BODY_CLASS);

    return () => {
      document.body.classList.remove(NOTIFICATION_ROUTE_BODY_CLASS);
    };
  }, []);

  return (
    <section
      data-component={NOTIFICATION_SETTINGS_BASE}
      data-slot="notification-settings-page"
      className="messages-page notification-settings-page"
    >
      <div
        className="shell-content"
        data-component={`${NOTIFICATION_SETTINGS_BASE}_content`}
        data-slot="notification-settings-content"
      >
        <div
          className="list-card pop-up notification-settings-card"
          data-component={`${NOTIFICATION_SETTINGS_BASE}_content_card`}
          data-slot="notification-settings-card"
        >
          <div className="list-title" data-component={`${NOTIFICATION_SETTINGS_BASE}_content_card_title`}>
            <span className="list-title-text">알림 설정</span>
          </div>

          <div className="list-card-scroll" data-component={NOTIFICATION_SETTINGS_SCROLL}>
            <div className="section-block" data-component={NOTIFICATION_SETTINGS_CHANNEL_SECTION}>
              <div className="section-header" data-component={`${NOTIFICATION_SETTINGS_CHANNEL_SECTION}_header`}>
                수신 채널
              </div>

              <NotificationSettingsRow
                dataComponent={`${NOTIFICATION_SETTINGS_CHANNEL_SECTION}_app-row`}
                label="앱 알림"
                icon={BellRing}
                tone={isAppNotificationEnabled ? "primary" : "muted"}
                description={(
                  <>
                    {appNotificationDescription}
                    {appNotificationError ? (
                      <span className="notification-row-error">{appNotificationError}</span>
                    ) : null}
                  </>
                )}
                rightContent={(
                  <label className="flex h-[44px] w-[44px] cursor-pointer items-center justify-center" htmlFor="notif-app">
                    <Switch
                      id="notif-app"
                      checked={isAppNotificationEnabled}
                      onCheckedChange={handleAppNotificationChange}
                      disabled={appNotificationDisabled}
                      aria-label="앱 알림 설정"
                    />
                  </label>
                )}
              />

              <NotificationSettingsRow
                dataComponent={`${NOTIFICATION_SETTINGS_CHANNEL_SECTION}_email-row`}
                label="이메일 알림"
                icon={Mail}
                tone="orange"
                description={emailNotificationDescription}
                rightContent={(
                  <label className="flex h-[44px] w-[44px] cursor-pointer items-center justify-center" htmlFor="notif-email">
                    <Switch
                      id="notif-email"
                      checked={
                        NOTIFICATION_EMAIL_ENABLED
                        && Boolean(accountEmail)
                        && notificationPreferencesQuery.data?.emailNotificationsEnabled === true
                      }
                      onCheckedChange={handleEmailNotificationChange}
                      disabled={
                        !NOTIFICATION_EMAIL_ENABLED
                        || !accountEmail
                        || !emailNotificationUserId
                        || notificationPreferencesQuery.isFetching
                        || notificationPreferencesQuery.isError
                        || updateNotificationPreferencesMutation.isPending
                      }
                      aria-label="이메일 알림 설정"
                    />
                  </label>
                )}
              />
            </div>

            {isOwner ? (
              <div className="section-block" data-component={NOTIFICATION_SETTINGS_ADMIN_SECTION}>
                <div className="section-header" data-component={`${NOTIFICATION_SETTINGS_ADMIN_SECTION}_header`}>
                  관리자
                </div>

                <NotificationSettingsRow
                  dataComponent={`${NOTIFICATION_SETTINGS_ADMIN_SECTION}_test-row`}
                  label="테스트 알림"
                  icon={Send}
                  tone="primary"
                  description="모든 구독된 디바이스에 테스트 알림을 전송합니다."
                  rightContent={(
                    <button
                      type="button"
                      data-component={`${NOTIFICATION_SETTINGS_ADMIN_SECTION}_test-row_control_send-button`}
                      className="notification-action-pill"
                      onClick={() => testNotificationMutation.mutate()}
                      disabled={testNotificationMutation.isPending}
                    >
                      {testNotificationMutation.isPending ? "전송 중" : "발송"}
                    </button>
                  )}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
