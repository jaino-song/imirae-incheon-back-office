"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Headset, MapPin, Phone, Search, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

import {
    AnimatedSlotList,
    AnimatedSlotListItemContent,
    DetailPanel,
    DetailTabPanels,
    DetailTabs,
    EmptyState,
    InfoCard,
    InfoRow,
    ListEmptyState,
    ListPanel,
    PageSection,
    SplitLayout,
    StatsBar,
} from "@/components/app/v3";
import { SelectedServicesCard } from "@/components/app/consultations/SelectedServicesCard";
import {
    getDisplayedConsultationInquiries,
    getConsultationIdentityKey,
} from "./list-state";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    useAllConsultationInquiries,
    useConsultationInquiries,
    useMarkConsultationInquiryRead,
} from "@/hooks/useConsultationInquiries";
import type { ConsultationInquiry } from "@/services/api";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

const READ_TABS = [
    { label: "읽지 않음", value: "unread" },
    { label: "읽음", value: "read" },
];

const CONSULTATION_DETAIL_TABS = [
    { key: "customer", label: "고객 정보" },
    { key: "inquiry", label: "문의 내용" },
] as const;

type ConsultationDetailTabKey = (typeof CONSULTATION_DETAIL_TABS)[number]["key"];

function formatDate(value: string): string {
    return formatDateForDisplay(value);
}

function formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function getInquirySourceLabel(source: string): string {
    if (source === "website") return "웹사이트";
    if (source === "app") return "앱";
    if (source === "phone") return "전화";
    return source || "-";
}

function getInquiryRegion(address: string): string {
    const parts = address.trim().split(/\s+/);
    return parts.slice(0, 2).join(" ") || address || "-";
}

function getInquiryStatusLabel(status: string): string {
    if (status === "new") return "신규";
    if (status === "contacted") return "연락 중";
    if (status === "closed") return "완료";
    return status || "-";
}

function getReadLabel(readAt: string | null): string {
    return readAt ? "읽음" : "읽지 않음";
}

function getReadVariant(readAt: string | null): "neutral" | "warning" {
    return readAt ? "neutral" : "warning";
}

function getConsultationAvatarClassName(readAt: string | null): string {
    return readAt
        ? "border border-[hsl(220,20%,90%)] bg-[hsl(220,20%,97%)] text-v3-text-muted"
        : "border border-[hsla(38,92%,35%,0.18)] bg-[hsl(47,100%,92%)] text-[hsl(38,92%,35%)]";
}

export default function ConsultationsPage() {
    const [activeReadState, setActiveReadState] = useState("unread");
    const [activeDetailTab, setActiveDetailTab] = useState<ConsultationDetailTabKey>("customer");
    const [search, setSearch] = useState("");
    const [selectedInquiry, setSelectedInquiry] = useState<ConsultationInquiry | null>(null);

    const queryParams = useMemo(
        () => ({
            page: 1,
            limit: 50,
            readState: activeReadState,
        }),
        [activeReadState],
    );
    const searchQueryParams = useMemo(
        () => ({ readState: activeReadState }),
        [activeReadState],
    );

    const statsQueryParams = useMemo(
        () => ({
            page: 1,
            limit: 100,
            readState: "all",
        }),
        [],
    );

    const hasSearchQuery = search.trim().length > 0;
    const { data, isLoading } = useConsultationInquiries(queryParams);
    const { data: searchData, isLoading: isSearchLoading } =
        useAllConsultationInquiries(searchQueryParams, hasSearchQuery);
    const { data: statsData, isLoading: isStatsLoading } = useConsultationInquiries(statsQueryParams);
    const markRead = useMarkConsultationInquiryRead();
    const inquiries = useMemo(
        () => (hasSearchQuery ? searchData?.data ?? [] : data?.data ?? []),
        [data?.data, hasSearchQuery, searchData?.data],
    );
    const isListLoading = hasSearchQuery ? isSearchLoading : isLoading;
    const statsInquiries = useMemo(() => statsData?.data ?? [], [statsData?.data]);
    const visibleInquiries = useMemo(
        () => getDisplayedConsultationInquiries({
            inquiries,
            selectedInquiry,
            activeReadState,
            search,
        }),
        [activeReadState, inquiries, search, selectedInquiry],
    );
    const activeInquiry = selectedInquiry
        ? inquiries.find((item) => item.id === selectedInquiry.id) ?? selectedInquiry
        : null;
    const phoneHistoryParams = useMemo(
        () => ({
            page: 1,
            limit: 20,
            phone: activeInquiry?.phone ?? "",
            readState: "all",
        }),
        [activeInquiry?.phone],
    );
    const { data: phoneHistoryData, isLoading: isPhoneHistoryLoading } =
        useConsultationInquiries(phoneHistoryParams, Boolean(activeInquiry?.phone));
    const phoneHistoryItems = useMemo(
        () => (phoneHistoryData?.data ?? []).filter((item) => {
            if (!activeInquiry) return false;
            const activeInquiryIdentityKey = getConsultationIdentityKey(activeInquiry);
            if (!activeInquiryIdentityKey) return false;
            return item.id !== activeInquiry?.id && getConsultationIdentityKey(item) === activeInquiryIdentityKey;
        }),
        [activeInquiry, phoneHistoryData?.data],
    );
    const previousConsultationDates = useMemo(() => {
        if (isPhoneHistoryLoading) return [];
        return phoneHistoryItems.map((item) => formatDateTime(item.createdAt));
    }, [isPhoneHistoryLoading, phoneHistoryItems]);

    const stats = useMemo(() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        return {
            currentMonthTotal: statsInquiries.filter((item) => {
                const createdAt = new Date(item.createdAt);
                if (Number.isNaN(createdAt.getTime())) return false;

                return createdAt.getFullYear() === currentYear && createdAt.getMonth() === currentMonth;
            }).length,
            unreadCount: statsInquiries.filter((item) => !item.readAt).length,
            newCount: statsInquiries.filter((item) => item.status === "new").length,
            contactedCount: statsInquiries.filter((item) => item.status === "contacted").length,
            closedCount: statsInquiries.filter((item) => item.status === "closed").length,
        };
    }, [statsInquiries]);

    return (
        <PageSection name="consultations">
            <StatsBar
                name="consultations"
                isLoading={isListLoading || isStatsLoading}
                items={[
                    { icon: Headset, value: stats.currentMonthTotal, label: "이번달 전체 상담", counter: "건" },
                    { icon: CalendarClock, value: stats.unreadCount, label: "읽지 않음", counter: "건", colorIndex: 1 },
                    { icon: Phone, value: stats.contactedCount, label: "연락 완료", counter: "건", colorIndex: 2 },
                    { icon: Search, value: stats.closedCount, label: "종료", counter: "건", colorIndex: 3 },
                ]}
            />

            <SplitLayout data-component="desktop_consultations_split-layout"
                hasSelection={!!activeInquiry}
                onBack={() => {
                    setSelectedInquiry(null);
                    setActiveDetailTab("customer");
                }}
            >
                <ListPanel data-component="desktop_consultations_split-layout_list-panel"
                    title="상담 문의"
                    tabs={READ_TABS}
                    activeTab={activeReadState}
                    onTabChange={(value) => {
                        setActiveReadState(value);
                        setSelectedInquiry(null);
                        setActiveDetailTab("customer");
                    }}
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="이름, 연락처, 주소 검색..."
                    isLoading={isListLoading}
                    emptyState={!isListLoading && visibleInquiries.length === 0 ? (
                        <ListEmptyState
                            name="consultations-empty"
                            message={search ? "검색 결과가 없습니다" : "상담 문의가 없습니다"}
                        />
                    ) : undefined}
                >
                    <AnimatedSlotList<ConsultationInquiry>
                        items={visibleInquiries}
                        isLoading={isListLoading}
                        loadingCount={6}
                        className="space-y-2"
                        getItemKey={(item) => item.id}
                        getSlotState={({ item, isLoading: slotLoading }) => {
                            const isActive = !slotLoading && item?.id === activeInquiry?.id;

                            return {
                                isActive,
                                isInteractive: !slotLoading && Boolean(item),
                            };
                        }}
                        onSlotClick={(inquiry) => {
                            setSelectedInquiry(inquiry);
                            setActiveDetailTab("customer");
                            if (!inquiry.readAt) {
                                markRead.mutate(inquiry.id, {
                                    onSuccess: (updatedInquiry) => {
                                        setSelectedInquiry(updatedInquiry);
                                    },
                                });
                            }
                        }}
                        render={({ item, isLoading: slotLoading }) => {
                            if (slotLoading) {
                                return (
                                    <>
                                        <Skeleton className="h-11 w-11 shrink-0 rounded-[14px] bg-v3-dim-white" />
                                        <div data-component="consultations-list-item-skeleton-content" className="min-w-0 flex-1">
                                            <Skeleton className="mb-2 h-4 w-28 bg-v3-dim-white" />
                                            <Skeleton className="h-3 w-44 bg-v3-dim-white" />
                                        </div>
                                        <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white" />
                                    </>
                                );
                            }

                            if (!item) return null;

                            return (
                                <AnimatedSlotListItemContent
                                    dataComponent="consultations-list-item"
                                    icon={Headset}
                                    iconContainerClassName={getConsultationAvatarClassName(item.readAt)}
                                    title={item.motherName}
                                    subtitle={
                                        <>
                                            <Phone className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))] shrink-0" />
                                            <span className="shrink-0">{item.phone}</span>
                                            <span className="truncate">{item.address}</span>
                                        </>
                                    }
                                    status={(
                                        <StatusPill variant={getReadVariant(item.readAt)} size="sm">
                                            {getReadLabel(item.readAt)}
                                        </StatusPill>
                                    )}
                                />
                            );
                        }}
                    />
                </ListPanel>

                {activeInquiry ? (
                    <DetailPanel data-component="desktop_consultations_split-layout_detail-panel"
                        avatar={
                            <div data-component="consultations-detail-avatar" className={cn("flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] shadow-lg", getConsultationAvatarClassName(activeInquiry.readAt))}>
                                <UserRound className="h-7 w-7" />
                            </div>
                        }
                        title={activeInquiry.motherName}
                        subtitle={`${activeInquiry.branchName ?? "현재 지점"} · ${formatDateTime(activeInquiry.createdAt)}`}
                        badges={
                            <StatusPill variant={getReadVariant(activeInquiry.readAt)} size="sm">
                                {getReadLabel(activeInquiry.readAt)}
                            </StatusPill>
                        }
                        tabs={
                            <DetailTabs
                                tabs={[...CONSULTATION_DETAIL_TABS]}
                                activeTab={activeDetailTab}
                                onTabChange={(key) => setActiveDetailTab(key as ConsultationDetailTabKey)}
                            />
                        }
                    >
                        <DetailTabPanels
                            activeTab={activeDetailTab}
                            dataComponent="consultations-detail"
                            panelDataComponent="consultations-detail-panel"
                            panels={[
                                {
                                    key: "customer",
                                    children: (
                                        <div data-component="consultations-detail-basic-grid" className="grid grid-cols-1 gap-4">
                                            <InfoCard data-component="desktop_consultations_detail-panel_info-card" title="고객 정보">
                                                <InfoRow label="이름" value={activeInquiry.motherName} />
                                                <InfoRow label="연락처" value={activeInquiry.phone} />
                                                <InfoRow label="주소" value={activeInquiry.address} />
                                                <InfoRow label="출산 예정일" value={formatDate(activeInquiry.dueDate)} />
                                                <InfoRow label="출산 경험" value={activeInquiry.birthExperience} />
                                                <InfoRow label="바우처 유형" value={activeInquiry.voucherType || "-"} />
                                            </InfoCard>
                                        </div>
                                    ),
                                },
                                {
                                    key: "inquiry",
                                    children: (
                                        <div data-component="consultations-detail-inquiry-grid" className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-4">
                                            <InfoCard data-component="desktop_consultations_detail-panel_info-card-2" title="문의 정보" className="min-w-0 content-start">
                                                <InfoRow label="근무 지역" value={getInquiryRegion(activeInquiry.address)} />
                                                <InfoRow label="추천 경로" value={activeInquiry.referralSource || "-"} />
                                                <InfoRow label="선호 매니저" value={activeInquiry.preferredCaregiverName || "-"} />
                                                <InfoRow label="출처" value={getInquirySourceLabel(activeInquiry.source)} />
                                                <InfoRow label="담당 지점" value={activeInquiry.branchName ?? "-"} />
                                                <InfoRow
                                                    label="추가 사항"
                                                    value={
                                                        activeInquiry.additionalNotes?.trim() ? (
                                                            <span className="whitespace-pre-wrap text-left inline-block">
                                                                {activeInquiry.additionalNotes.trim()}
                                                            </span>
                                                        ) : (
                                                            "-"
                                                        )
                                                    }
                                                />
                                                {previousConsultationDates.length > 0 ? (
                                                    <div data-component="consultations-phone-history" className="flex items-start gap-4 py-2.5 border-b border-v3-border last:border-b-0">
                                                        <span className="shrink-0 text-[0.8rem] text-v3-text-muted">이전 상담</span>
                                                        <span data-component="consultations-phone-history-values" className="ml-auto min-w-0 flex-1 text-[0.8rem] font-semibold text-v3-dark text-right">
                                                            {previousConsultationDates.map((date) => (
                                                                <span key={date} className="block">
                                                                    {date}
                                                                </span>
                                                            ))}
                                                        </span>
                                                    </div>
                                                ) : null}
                                            </InfoCard>

                                            <SelectedServicesCard inquiry={activeInquiry} className="min-w-0 content-start" />

                                            <InfoCard data-component="desktop_consultations_detail-panel_info-card-3" title="문의 상태" className="min-w-0 content-start">
                                                <InfoRow
                                                    label="확인 여부"
                                                    value={
                                                        activeInquiry.readAt
                                                            ? `읽음 · ${formatDateTime(activeInquiry.readAt)}`
                                                            : "읽지 않음"
                                                    }
                                                />
                                                <InfoRow label="진행 상태" value={getInquiryStatusLabel(activeInquiry.status)} />
                                                <InfoRow label="개인정보 동의" value={formatDateTime(activeInquiry.privacyAcceptedAt)} />
                                            </InfoCard>
                                        </div>
                                    ),
                                },
                            ]}
                        />
                    </DetailPanel>
                ) : (
                    <EmptyState
                        name="consultations-empty-detail"
                        icon={MapPin}
                        message="상담 문의를 선택하면 상세 정보가 표시됩니다"
                    />
                )}
            </SplitLayout>
        </PageSection>
    );
}
