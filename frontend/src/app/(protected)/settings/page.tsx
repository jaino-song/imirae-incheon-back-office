"use client";

import { forwardRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Bell,
  type LucideProps,
  Palette,
  Shield,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { ContentPaper } from "@/components/app/root/content-paper";
import { SectionNav } from "@/components/app/v3";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { usePushNotification } from "@/hooks/usePushNotification";
import { getRoleLabel } from "@/lib/constants/roles";
import { useInitialUser } from "@/providers/UserProvider";
import { settingsApi } from "@/services/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/toaster";
import { KakaoLinkResultModal } from "@/features/auth/settings/kakao-link-result-modal";

const UserKeyIcon = forwardRef<SVGSVGElement, LucideProps>(function UserKeyIcon(
  { size = 20, className, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="m16 11 2 2 4-4" />
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  );
});

const BASE_NAV_SECTIONS = [
  { id: "profile", label: "계정", icon: UserKeyIcon },
  { id: "notifications", label: "알림", icon: Bell },
  { id: "theme", label: "테마", icon: Palette },
  { id: "security", label: "보안", icon: Shield },
] as const;

type SectionId = "profile" | "notifications" | "theme" | "security" | "pricing";

const THEME_OPTIONS = [
  { id: "light", label: "라이트", icon: Sun, description: "밝은 테마" },
  { id: "dark", label: "다크", icon: Moon, description: "어두운 테마" },
  { id: "system", label: "시스템", icon: Monitor, description: "시스템 설정" },
] as const;

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("profile");
  const [selectedTheme, setSelectedTheme] = useState<string>("light");
  const initialUser = useInitialUser();
  const authUserQuery = useGetAuthUser({ initialData: initialUser });
  const { data: user } = authUserQuery;
  const queryClient = useQueryClient();
  const notificationPreferencesQuery = useQuery({
    queryKey: ["settings", "notification-preferences"],
    queryFn: settingsApi.getNotificationPreferences,
  });
  const {
    isSupported: isBrowserNotificationSupported,
    isSubscribed: isBrowserNotificationEnabled,
    permission: browserNotificationPermission,
    isLoading: isBrowserNotificationLoading,
    error: browserNotificationError,
    subscribe: enableBrowserNotifications,
    unsubscribe: disableBrowserNotifications,
  } = usePushNotification();

  const emailNotificationsEnabled =
    notificationPreferencesQuery.data?.emailNotificationsEnabled ?? true;

  const updateNotificationPreferencesMutation = useMutation({
    mutationFn: settingsApi.updateNotificationPreferences,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", "notification-preferences"], data);
    },
  });

  const handleBrowserNotificationToggle = async (checked: boolean) => {
    if (checked) {
      await enableBrowserNotifications();
      return;
    }

    await disableBrowserNotifications();
  };

  const handleEmailNotificationToggle = async (checked: boolean) => {
    await updateNotificationPreferencesMutation.mutateAsync(checked);
  };

  const accountInitials = user?.name ? user.name.slice(0, 2) : "사용";
  const isProfileSummaryLoading = authUserQuery.isLoading && !user;

  return (
    <section data-component="desktop_settings_sections" className="space-y-6">
      <KakaoLinkResultModal />
      <div
        data-slot="page-sections"
        className="flex flex-col lg:flex-row gap-8"
      >
        <SectionNav
          data-component="desktop_settings_sections_section-nav"
          items={BASE_NAV_SECTIONS}
          activeId={activeSection}
          onSelect={(id) => setActiveSection(id as SectionId)}
        />

        <div className="flex-1 min-w-0">
          {activeSection === "profile" && (
          <section data-component="desktop_settings_sections_profile">
            <ContentPaper variant="v3">
              <div data-component="desktop_settings_sections_profile_profile-header" className="mb-4 flex items-center gap-3">
                <div data-component="desktop_settings_sections_profile_profile-header_profile-icon" className="flex items-center justify-center w-10 h-10 rounded-xl bg-[hsl(var(--v3-primary))]/10">
                  <UserKeyIcon size={20} className="text-[hsl(var(--v3-primary))]" />
                </div>
                <div data-component="desktop_settings_sections_profile_profile-header_profile-title-group">
                  <h2 className="text-lg font-bold text-foreground">계정</h2>
                  <p className="text-sm text-muted-foreground">회원가입 시 입력한 계정 정보를 관리합니다.</p>
                </div>
              </div>
              <Separator className="mb-6" />

              <div data-component="desktop_settings_sections_profile_profile-summary-wrap" className="flex justify-center">
                <div data-component="desktop_settings_sections_profile_profile-summary-wrap_profile-summary" className="mb-6 flex w-full flex-col gap-5 rounded-[24px] bg-[hsl(var(--v3-bg))] p-5 lg:w-1/2">
                  <div data-component="desktop_settings_sections_profile_profile-summary-wrap_profile-summary_profile-summary-header" className="flex items-center gap-4">
                    <Avatar
                      data-component="desktop_settings_sections_profile-summary-avatar"
                      className="h-16 w-16 rounded-full border border-[hsl(var(--v3-border))]/60 bg-[hsl(var(--v3-primary))]/10"
                    >
                      {!isProfileSummaryLoading ? (
                        <>
                          <AvatarImage src={user?.profileImage || ""} alt={user?.name || "사용자"} />
                          <AvatarFallback className="bg-[hsl(var(--v3-primary))]/10 text-[hsl(var(--v3-primary))] text-lg font-bold">
                            {accountInitials}
                          </AvatarFallback>
                        </>
                      ) : (
                        <AvatarFallback className="bg-[hsl(var(--v3-primary))]/10 p-0">
                          <Skeleton className="h-full w-full rounded-full bg-[hsl(var(--v3-primary))]/15" />
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <div data-component="desktop_settings_sections_profile_profile-summary-wrap_profile-summary_profile-summary-header_profile-summary-text">
                      {isProfileSummaryLoading ? (
                        <div data-component="desktop_settings_sections_profile_profile-summary-wrap_profile-summary_profile-summary-header_profile-summary-text_profile-summary-loading" className="space-y-2 pt-1">
                          <Skeleton className="h-4 w-20 bg-[hsl(var(--v3-border))]/70" />
                          <Skeleton className="h-3 w-12 bg-[hsl(var(--v3-border))]/55" />
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-foreground">
                            {user?.name || "사용자"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {getRoleLabel(user?.role || "user")}
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  <div data-component="desktop_settings_sections_profile_profile-summary-wrap_profile-summary_profile-readonly-grid" className="flex flex-col gap-4">
                    <div data-component="desktop_settings_sections_profile_profile-summary-wrap_profile-summary_profile-readonly-grid_profile-email-field" className="rounded-2xl border border-[hsl(var(--v3-border))] bg-white px-4 py-3">
                      <p className="text-[0.72rem] font-semibold text-[hsl(var(--v3-text-muted))]">이메일</p>
                      {isProfileSummaryLoading ? (
                        <Skeleton className="mt-2 h-4 w-[78%] bg-[hsl(var(--v3-border))]/60" />
                      ) : (
                        <p className="mt-1 text-sm font-medium text-foreground break-all">{user?.email || "-"}</p>
                      )}
                    </div>
                    <div data-component="desktop_settings_sections_profile_profile-summary-wrap_profile-summary_profile-readonly-grid_profile-phone-field" className="rounded-2xl border border-[hsl(var(--v3-border))] bg-white px-4 py-3">
                      <p className="text-[0.72rem] font-semibold text-[hsl(var(--v3-text-muted))]">전화번호</p>
                      {isProfileSummaryLoading ? (
                        <Skeleton className="mt-2 h-4 w-28 bg-[hsl(var(--v3-border))]/60" />
                      ) : (
                        <p className="mt-1 text-sm font-medium text-foreground">{user?.phone || "-"}</p>
                      )}
                    </div>
                    <div data-component="desktop_settings_sections_profile_profile-summary-wrap_profile-summary_profile-readonly-grid_profile-branch-field" className="rounded-2xl border border-[hsl(var(--v3-border))] bg-white px-4 py-3">
                      <p className="text-[0.72rem] font-semibold text-[hsl(var(--v3-text-muted))]">지점</p>
                      {isProfileSummaryLoading ? (
                        <Skeleton className="mt-2 h-4 w-24 bg-[hsl(var(--v3-border))]/60" />
                      ) : (
                        <p className="mt-1 text-sm font-medium text-foreground">{user?.branchName || "-"}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </ContentPaper>
          </section>
          )}

          {activeSection === "notifications" && (
          <section data-component="desktop_settings_sections_notifications">
            <ContentPaper variant="v3">
              <div data-component="desktop_settings_sections_notifications_notifications-header" className="mb-4 flex items-center gap-3">
                <div data-component="desktop_settings_sections_notifications_notifications-header_notifications-icon" className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10">
                  <Bell size={20} className="text-amber-500" />
                </div>
                <div data-component="desktop_settings_sections_notifications_notifications-header_notifications-title-group">
                  <h2 className="text-lg font-bold text-foreground">알림</h2>
                  <p className="text-sm text-muted-foreground">알림 수신 설정을 관리합니다.</p>
                </div>
              </div>
              <Separator className="mb-4" />

              <div data-component="desktop_settings_sections_notifications_notifications-content" className="space-y-4">
                <div data-component="desktop_settings_sections_notifications_notifications-content_notifications-email" className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 transition-colors">
                  <div data-component="desktop_settings_sections_notifications_notifications-content_notifications-email_notifications-email-text" className="space-y-0.5">
                    <Label htmlFor="notif-email" className="text-sm font-medium">
                      이메일 알림
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      시스템 알림 및 중요 업데이트를 이메일로 수신합니다.
                    </p>
                  </div>
                  <Switch
                    id="notif-email"
                    checked={emailNotificationsEnabled}
                    onCheckedChange={handleEmailNotificationToggle}
                    disabled={notificationPreferencesQuery.isLoading || updateNotificationPreferencesMutation.isPending}
                  />
                </div>

                <div data-component="desktop_settings_sections_notifications_notifications-content_notifications-browser" className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 transition-colors">
                  <div data-component="desktop_settings_sections_notifications_notifications-content_notifications-browser_notifications-browser-text" className="space-y-0.5">
                    <Label htmlFor="notif-browser" className="text-sm font-medium">
                      브라우저 알림
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {isBrowserNotificationSupported
                        ? browserNotificationPermission === "denied"
                          ? "브라우저 설정에서 알림 권한을 허용해 주세요."
                          : "브라우저 푸시 알림을 수신합니다."
                        : "이 브라우저는 푸시 알림을 지원하지 않습니다."}
                    </p>
                  </div>
                  {isBrowserNotificationLoading ? (
                    <Spinner size="sm" />
                  ) : (
                    <Switch
                      id="notif-browser"
                      checked={isBrowserNotificationEnabled}
                      onCheckedChange={handleBrowserNotificationToggle}
                      disabled={!isBrowserNotificationSupported || browserNotificationPermission === "denied"}
                    />
                  )}
                </div>

                {browserNotificationError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{browserNotificationError}</AlertDescription>
                  </Alert>
                ) : null}

                {updateNotificationPreferencesMutation.isError ? (
                  <Alert variant="destructive">
                    <AlertDescription>이메일 알림 설정을 저장하지 못했습니다.</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </ContentPaper>
          </section>
          )}

          {activeSection === "theme" && (
          <section data-component="desktop_settings_sections_theme">
            <ContentPaper variant="v3">
              <div data-component="desktop_settings_sections_theme_theme-header" className="mb-4 flex items-center gap-3">
                <div data-component="desktop_settings_sections_theme_theme-header_theme-icon" className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10">
                  <Palette size={20} className="text-violet-500" />
                </div>
                <div data-component="desktop_settings_sections_theme_theme-header_theme-title-group">
                  <h2 className="text-lg font-bold text-foreground">테마</h2>
                  <p className="text-sm text-muted-foreground">화면 테마를 선택합니다.</p>
                </div>
              </div>
              <Separator className="mb-6" />

              <div data-component="desktop_settings_sections_theme_theme-options" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {THEME_OPTIONS.map((theme) => {
                  const Icon = theme.icon;
                  const isSelected = selectedTheme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedTheme(theme.id)}
                      disabled={theme.id === "dark"}
                      className={`relative flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all duration-200 ${
                        isSelected
                          ? "border-[hsl(var(--v3-primary))] bg-[hsl(var(--v3-primary))]/5"
                          : "border-[hsl(var(--v3-border))] hover:border-[hsl(var(--v3-primary))]/30"
                      } ${theme.id === "dark" ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <div
                        data-component="desktop_settings_sections_theme_theme-options_theme-option-icon"
                        className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          isSelected
                            ? "bg-[hsl(var(--v3-primary))]/10"
                            : "bg-muted/50"
                        }`}
                      >
                        <Icon
                          size={24}
                          className={
                            isSelected
                              ? "text-[hsl(var(--v3-primary))]"
                              : "text-muted-foreground"
                          }
                        />
                      </div>
                      <div data-component="desktop_settings_sections_theme_theme-options_theme-option-text" className="text-center">
                        <p className="text-sm font-medium">{theme.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {theme.description}
                        </p>
                      </div>
                      {theme.id === "dark" && (
                        <span className="absolute top-2 right-2 text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                          준비 중
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </ContentPaper>
          </section>
          )}

          {activeSection === "security" && (
          <section data-component="desktop_settings_sections_security">
            <ContentPaper variant="v3">
              <div data-component="desktop_settings_sections_security_security-header" className="mb-4 flex items-center gap-3">
                <div data-component="desktop_settings_sections_security_security-header_security-icon" className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-500/10">
                  <Shield size={20} className="text-red-500" />
                </div>
                <div data-component="desktop_settings_sections_security_security-header_security-title-group">
                  <h2 className="text-lg font-bold text-foreground">보안</h2>
                  <p className="text-sm text-muted-foreground">계정 보안 설정을 관리합니다.</p>
                </div>
              </div>
              <Separator className="mb-6" />

              <div data-component="desktop_settings_sections_security_security-content" className="space-y-4">
                <div data-component="desktop_settings_sections_security_security-content_security-current-password-field">
                  <Label htmlFor="current-password" className="text-sm font-medium">
                    현재 비밀번호
                  </Label>
                  <input
                    id="current-password"
                    type="password"
                    placeholder="현재 비밀번호를 입력하세요"
                    className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                  />
                </div>
                <div data-component="desktop_settings_sections_security_security-content_security-new-password-field">
                  <Label htmlFor="new-password" className="text-sm font-medium">
                    새 비밀번호
                  </Label>
                  <input
                    id="new-password"
                    type="password"
                    placeholder="새 비밀번호를 입력하세요"
                    className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                  />
                </div>
                <div data-component="desktop_settings_sections_security_security-content_security-confirm-password-field">
                  <Label htmlFor="confirm-password" className="text-sm font-medium">
                    비밀번호 확인
                  </Label>
                  <input
                    id="confirm-password"
                    type="password"
                    placeholder="새 비밀번호를 다시 입력하세요"
                    className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                  />
                </div>

                <Separator className="my-2" />

                <div data-component="desktop_settings_sections_security_security-content_security-two-factor" className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 transition-colors">
                  <div data-component="desktop_settings_sections_security_security-content_security-two-factor_security-two-factor-text" className="space-y-0.5">
                    <Label htmlFor="two-factor" className="text-sm font-medium text-muted-foreground">
                      2단계 인증 (준비 중)
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      로그인 시 추가 인증을 요구합니다. (추후 지원 예정)
                    </p>
                  </div>
                  <Switch id="two-factor" checked={false} disabled />
                </div>
              </div>
            </ContentPaper>
          </section>
          )}

        </div>
      </div>

      <Toaster />
    </section>
  );
}
