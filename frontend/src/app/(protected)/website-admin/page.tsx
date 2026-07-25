"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Save } from "lucide-react";
import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  DetailPanel,
  ListPanel,
  PageSection,
  SplitLayout,
  useSplitLayoutSelection,
} from "@/components/app/v3";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { settingsApi, type RibbonConfig } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

const SECTIONS = [
  { id: "ribbon", label: "리본 배너", icon: Flag },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];
const SECTION_IDS = SECTIONS.map((section) => section.id);

const DEFAULT_CONFIG: RibbonConfig = {
  enabled: false,
  message: "",
  backgroundColor: "#004AAD",
  textColor: "#FFFFFF",
  linkText: "",
  linkHref: "",
  linkColor: "#FFB27B",
};

function RibbonConfigSkeleton() {
  return (
    <div data-component="website-admin-ribbon-loading-skeleton" className="space-y-6">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          data-component="website-admin-ribbon-loading-row"
          className="flex items-center justify-between gap-6 rounded-xl p-3"
        >
          <div data-component="website-admin-ribbon-loading-copy" className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-28 bg-v3-dim-white" />
            <Skeleton className="h-3 w-64 max-w-full bg-v3-dim-white" />
          </div>
          <Skeleton className="h-9 w-16 rounded-full bg-v3-dim-white" />
        </div>
      ))}
      <div data-component="website-admin-ribbon-loading-actions" className="flex justify-end">
        <Skeleton className="h-10 w-24 rounded-xl bg-v3-dim-white" />
      </div>
    </div>
  );
}

export default function WebsiteAdminPage() {
  const {
    selectedId: activeSection,
    setSelectedId: setActiveSection,
    setSplitLayoutMode,
  } = useSplitLayoutSelection<SectionId>(SECTION_IDS);
  const [draft, setDraft] = useState<Partial<RibbonConfig>>({});
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const ribbonQuery = useQuery({
    queryKey: ["settings", "ribbon-config"],
    queryFn: settingsApi.getRibbonConfig,
  });

  const baseConfig = ribbonQuery.data ?? DEFAULT_CONFIG;
  const isDirty = Object.keys(draft).length > 0;
  const form = useMemo<RibbonConfig>(
    () => ({ ...baseConfig, ...draft }),
    [baseConfig, draft],
  );

  const updateMutation = useMutation({
    mutationFn: settingsApi.updateRibbonConfig,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", "ribbon-config"], data);
      setDraft({});
      toast({ title: "저장 완료", description: "리본 배너 설정이 저장되었습니다." });
    },
    onError: () => {
      toast({ title: "저장 실패", description: "설정 저장 중 오류가 발생했습니다.", variant: "destructive" });
    },
  });

  const updateField = <K extends keyof RibbonConfig>(key: K, value: RibbonConfig[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    updateMutation.mutate(form);
  };

  return (
    <PageSection name="website-admin">
      <SplitLayout data-component="desktop_website-admin_split-layout"
        hasSelection={activeSection !== null}
        onBack={() => setActiveSection(null)}
        onModeChange={setSplitLayoutMode}
      >
        <ListPanel data-component="desktop_website-admin_split-layout_list-panel"
          title="홈페이지 관리"
          subtitle="홈페이지에 노출되는 콘텐츠와 설정을 관리합니다."
        >
          <AnimatedSlotList<(typeof SECTIONS)[number]>
            items={SECTIONS}
            isLoading={false}
            getItemKey={(section) => section.id}
            getSlotState={({ item }) => ({
              isActive: item?.id === activeSection,
              isInteractive: Boolean(item),
            })}
            onSlotClick={(section) => setActiveSection(section.id)}
            render={({ item }) => {
              if (!item) return null;

              return (
                <AnimatedSlotListItemContent
                  dataComponent="website-admin-list-item"
                  icon={item.icon}
                  iconContainerClassName="bg-v3-primary-light"
                  iconClassName="text-v3-primary"
                  title={item.label}
                  subtitle="홈페이지 상단 알림 리본 설정"
                />
              );
            }}
          />
        </ListPanel>

        <DetailPanel data-component="desktop_website-admin_split-layout_detail-panel"
          title="리본 배너"
          subtitle="홈페이지 상단에 표시되는 알림 리본을 관리합니다."
          compactBackLabel="홈페이지 관리 목록으로 돌아가기"
        >
          <div data-component="website-admin-ribbon">
                {ribbonQuery.isLoading ? (
                  <div data-component="website-admin-ribbon-loading">
                    <RibbonConfigSkeleton />
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Enable toggle */}
                    <div className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 transition-colors">
                      <div className="space-y-0.5">
                        <Label htmlFor="ribbon-enabled" className="text-sm font-medium">활성화</Label>
                        <p className="text-sm text-muted-foreground">리본 배너를 홈페이지에 표시합니다.</p>
                      </div>
                      <Switch
                        id="ribbon-enabled"
                        checked={form.enabled}
                        onCheckedChange={(checked) => updateField("enabled", checked)}
                      />
                    </div>

                    <Separator />

                    {/* Message */}
                    <div>
                      <Label htmlFor="ribbon-message" className="text-sm font-medium">메시지</Label>
                      <input
                        id="ribbon-message"
                        type="text"
                        value={form.message}
                        onChange={(e) => updateField("message", e.target.value)}
                        placeholder="리본에 표시할 메시지를 입력하세요"
                        className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                      />
                    </div>

                    {/* Colors */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="ribbon-bg" className="text-sm font-medium">배경 색상</Label>
                        <div className="mt-1.5 flex items-center gap-2">
                          <input
                            id="ribbon-bg"
                            type="color"
                            value={form.backgroundColor}
                            onChange={(e) => updateField("backgroundColor", e.target.value)}
                            className="w-10 h-10 rounded-lg border border-[hsl(var(--v3-border))] cursor-pointer"
                          />
                          <input
                            type="text"
                            value={form.backgroundColor}
                            onChange={(e) => updateField("backgroundColor", e.target.value)}
                            className="flex-1 px-3 py-2 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="ribbon-text-color" className="text-sm font-medium">텍스트 색상</Label>
                        <div className="mt-1.5 flex items-center gap-2">
                          <input
                            id="ribbon-text-color"
                            type="color"
                            value={form.textColor}
                            onChange={(e) => updateField("textColor", e.target.value)}
                            className="w-10 h-10 rounded-lg border border-[hsl(var(--v3-border))] cursor-pointer"
                          />
                          <input
                            type="text"
                            value={form.textColor}
                            onChange={(e) => updateField("textColor", e.target.value)}
                            className="flex-1 px-3 py-2 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="ribbon-link-color" className="text-sm font-medium">링크 색상</Label>
                        <div className="mt-1.5 flex items-center gap-2">
                          <input
                            id="ribbon-link-color"
                            type="color"
                            value={form.linkColor}
                            onChange={(e) => updateField("linkColor", e.target.value)}
                            className="w-10 h-10 rounded-lg border border-[hsl(var(--v3-border))] cursor-pointer"
                          />
                          <input
                            type="text"
                            value={form.linkColor}
                            onChange={(e) => updateField("linkColor", e.target.value)}
                            className="flex-1 px-3 py-2 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Link settings */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="ribbon-link-text" className="text-sm font-medium">링크 텍스트</Label>
                        <input
                          id="ribbon-link-text"
                          type="text"
                          value={form.linkText}
                          onChange={(e) => updateField("linkText", e.target.value)}
                          placeholder="자세히 보기"
                          className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                        />
                      </div>
                      <div>
                        <Label htmlFor="ribbon-link-href" className="text-sm font-medium">링크 URL</Label>
                        <input
                          id="ribbon-link-href"
                          type="text"
                          value={form.linkHref}
                          onChange={(e) => updateField("linkHref", e.target.value)}
                          placeholder="/pricing"
                          className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                        />
                      </div>
                    </div>

                    <Separator />

                    {/* Preview */}
                    <div>
                      <Label className="text-sm font-medium mb-3 block">미리보기</Label>
                      <div
                        className="rounded-xl overflow-hidden border border-[hsl(var(--v3-border))]"
                      >
                        <div
                          style={{
                            background: form.backgroundColor,
                            color: form.textColor,
                            padding: "10px 24px",
                            fontSize: "13px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            letterSpacing: "-0.01em",
                            opacity: form.enabled ? 1 : 0.4,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: form.linkColor,
                              flexShrink: 0,
                            }}
                          />
                          <span>{form.message || "메시지를 입력하세요"}</span>
                          {form.linkText && (
                            <span style={{ color: form.linkColor, fontWeight: 600 }}>
                              {form.linkText} ›
                            </span>
                          )}
                        </div>
                        {!form.enabled && (
                          <div className="bg-muted/50 text-center py-1 text-xs text-muted-foreground">
                            비활성 상태 — 홈페이지에 표시되지 않습니다
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Save button */}
                    <div className="flex justify-end">
                      <button
                        onClick={handleSave}
                        disabled={!isDirty || updateMutation.isPending}
                        className={`
                          inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                          ${isDirty
                            ? "bg-[hsl(var(--v3-primary))] text-white hover:bg-[hsl(var(--v3-primary-hover))] shadow-md shadow-blue-500/20"
                            : "bg-muted text-muted-foreground cursor-not-allowed"
                          }
                        `}
                      >
                        {updateMutation.isPending ? (
                          <Spinner size="sm" />
                        ) : (
                          <Save size={16} />
                        )}
                        저장
                      </button>
                    </div>
                  </div>
                )}
          </div>
        </DetailPanel>
      </SplitLayout>
    </PageSection>
  );
}
