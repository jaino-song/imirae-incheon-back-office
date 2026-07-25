"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiErrorMessage } from "@babyjamjam/shared";
import {
    Workflow,
    Users,
    Calendar,
    CalendarDays,
    Plus,
    Clock,
    UserCheck,
    AlertTriangle,
    MoreVertical,
    Pencil,
    RotateCcw,
    Trash2,
    FileSignature,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    useClients,
    useDeleteClient,
    useClient,
} from "@/features/clients/hooks/use-clients";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { getScheduleChangeErrorMessage } from "@/features/service-records/utils/schedule-change-error";
import { useToast } from "@/hooks/use-toast";
import type { Client, ServiceStatus } from "@/lib/client/types";
import {
    getClientBadgeAvatarClassName,
    getClientBadges,
    getPrimaryClientBadge,
    prioritizeClientBadges,
} from "@/lib/client/badges";
import {
    CLIENT_FORM_STEPPER_STEPS,
    ClientFormDialog,
    ClientFormPanel,
} from "@/components/app/clients/ClientFormDialog";
import { ClientDetailPanel } from "@/components/app/clients/ClientDetailPanel";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { ServiceRecordLinkResetResultModal } from "@/components/app/clients/ServiceRecordLinkResetResultModal";
import { ServiceScheduleChangeModal } from "@/components/app/clients/ServiceScheduleChangeModal";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
    StatsBar,
    SplitLayout,
    ListPanel,
    DetailPanel,
    InfoCard,
    StatusBadge,
    AnimatedSlotList,
    AnimatedSlotListItemContent,
    HeaderActionButton,
    EmptyState,
    PageSection,
    ListEmptyState,
    SectionNav,
    SteppedWizardStepper,
} from "@/components/app/v3";
import { matchesSearchQuery } from "@/lib/search/korean-search";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { settingsApi, type ClientRegistrationPolicy } from "@/services/api";

const FILTER_CHIPS = [
    { label: "전체", value: "all" },
    { label: "예약 전", value: "pre_booking" },
    { label: "대기", value: "waiting" },
    { label: "교체 요청", value: "replacement_requested" },
    { label: "진행중", value: "active" },
    { label: "완료", value: "completed" },
    { label: "중단", value: "terminated" },
];

const CLIENT_SECTIONS = [
    { id: "list", label: "고객 목록", icon: Users },
    { id: "automation", label: "자동화", icon: Workflow },
] as const;

type ClientSectionId = (typeof CLIENT_SECTIONS)[number]["id"];

type ClientAutomationItem = {
    id: "eformsign-auto-client-registration";
    title: string;
    subtitle: string;
    icon: typeof FileSignature;
};

const CLIENT_AUTOMATION_ITEMS: readonly ClientAutomationItem[] = [
    {
        id: "eformsign-auto-client-registration",
        title: "전자문서 자동 고객 등록",
        subtitle: "전자문서 생성 시 고객 정보가 자동으로 등록됩니다.",
        icon: FileSignature,
    },
];

const toDate = (value: string | null): Date | null => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const getTodayIsoDate = (): string => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

interface ServiceScheduleChangeTarget {
    scheduleId: number;
    sessionIndex: number;
    currentDate: string;
    minimumDate: string;
}

const filterValueToStatus = (filter: string): ServiceStatus | null => {
    switch (filter) {
        case "pre_booking":
            return "pre_booking";
        case "waiting":
            return "waiting";
        case "replacement_requested":
            return "replacement_requested";
        case "active":
            return "active";
        case "completed":
            return "completed";
        case "terminated":
            return "terminated";
        default:
            return null;
    }
};

function ClientAutomationSection() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: policy, isLoading } = useQuery({
        queryKey: ["settings", "client-registration-policy"],
        queryFn: settingsApi.getClientRegistrationPolicy,
    });
    const [selectedAutomationId, setSelectedAutomationId] = useState<ClientAutomationItem["id"] | null>(null);
    const updatePolicy = useMutation({
        mutationFn: settingsApi.updateClientRegistrationPolicy,
        onMutate: async ({ clientAutoRegistration }: { clientAutoRegistration?: boolean }) => {
            await queryClient.cancelQueries({ queryKey: ["settings", "client-registration-policy"] });
            const previous = queryClient.getQueryData<ClientRegistrationPolicy>(["settings", "client-registration-policy"]);
            queryClient.setQueryData<ClientRegistrationPolicy>(["settings", "client-registration-policy"], (current) =>
                current && clientAutoRegistration !== undefined ? { ...current, clientAutoRegistration } : current,
            );
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) queryClient.setQueryData(["settings", "client-registration-policy"], context.previous);
            toast({ variant: "destructive", description: "고객 자동 등록 설정 저장 중 오류가 발생했습니다." });
        },
        onSuccess: (saved) => queryClient.setQueryData(["settings", "client-registration-policy"], saved),
        onSettled: () => void queryClient.invalidateQueries({ queryKey: ["settings", "client-registration-policy"] }),
    });
    const selectedAutomation =
        CLIENT_AUTOMATION_ITEMS.find((item) => item.id === selectedAutomationId) ?? null;
    const selectedAutomationEnabled = selectedAutomation ? policy?.clientAutoRegistration === true : false;

    return (
        <section data-component="clients-automation-section" className="flex h-full min-h-0 flex-1 flex-col">
            <SplitLayout data-component="desktop_clients_split-layout"
                hasSelection={selectedAutomation !== null}
                onBack={() => setSelectedAutomationId(null)}
            >
                <ListPanel data-component="desktop_clients_split-layout_list-panel"
                    title="고객 자동화"
                    subtitle="고객 등록과 문서 흐름을 자동화합니다."
                >
                    <div data-component="clients-automation-list" className="space-y-2">
                        <AnimatedSlotList<ClientAutomationItem>
                            items={CLIENT_AUTOMATION_ITEMS}
                            isLoading={false}
                            className="space-y-2"
                            getItemKey={(item) => item.id}
                            itemVariant="card"
                            getSlotState={({ item }) => ({
                                isActive: item?.id === selectedAutomationId,
                                isInteractive: Boolean(item),
                            })}
                            onSlotClick={(item) => setSelectedAutomationId(item.id)}
                            render={({ item }) => {
                                if (!item) return null;

                                return (
                                    <AnimatedSlotListItemContent
                                        dataComponent="clients-automation-item"
                                        icon={item.icon}
                                        iconContainerClassName="text-v3-primary"
                                        title={item.title}
                                        subtitle={item.subtitle}
                                        status={(
                                            <Switch
                                                data-component="clients-automation-item-toggle"
                                                aria-label={`${item.title} 사용`}
                                                checked={policy?.clientAutoRegistration === true}
                                                disabled={isLoading || updatePolicy.isPending}
                                                onClick={(event) => event.stopPropagation()}
                                                onCheckedChange={(checked) => updatePolicy.mutate({ clientAutoRegistration: checked })}
                                                className="ml-auto shrink-0"
                                            />
                                        )}
                                    />
                                );
                            }}
                        />
                    </div>
                </ListPanel>

                {selectedAutomation ? (
                    <DetailPanel data-component="desktop_clients_split-layout_detail-panel"
                        compactBackLabel="자동화 목록으로 돌아가기"
                        title={selectedAutomation.title}
                        subtitle={selectedAutomation.subtitle}
                    >
                        <InfoCard data-component="desktop_clients_detail-panel_info-card" title="자동화 안내">
                            <p data-component="clients-automation-detail-temporary-copy" className="text-[0.85rem] leading-6 text-v3-text-muted">
                                {selectedAutomationEnabled
                                    ? "전자문서 생성 시에 자동으로 고객이 등록됩니다."
                                    : "자동 고객 등록이 꺼져 있습니다."}
                            </p>
                        </InfoCard>
                    </DetailPanel>
                ) : (
                    <DetailPanel data-component="desktop_clients_split-layout_detail-panel-2"
                        overlay={(
                            <ListEmptyState
                                name="clients-automation-detail-empty"
                                icon={Workflow}
                                message="왼쪽 목록에서 자동화 항목을 선택해 주세요."
                                className="flex-none min-h-0"
                            />
                        )}
                    >
                        {null}
                    </DetailPanel>
                )}
            </SplitLayout>
        </section>
    );
}

export default function ClientsPage() {
    const locale = useLocale();
    const router = useRouter();
    const searchParams = useSearchParams();
    const clientIdParam = searchParams.get("id");
    const shouldOpenClientFormFromUrl = searchParams.get("openClientForm") === "1";

    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [isCreatingClient, setIsCreatingClient] = useState(false);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);
    const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
    const [resetLinkTargetClientId, setResetLinkTargetClientId] = useState<number | null>(null);
    const [resetServiceRecordUrl, setResetServiceRecordUrl] = useState<string | null>(null);
    const [isResettingLink, setIsResettingLink] = useState(false);
    const [scheduleChangeTarget, setScheduleChangeTarget] = useState<ServiceScheduleChangeTarget | null>(null);
    const [selectedScheduleChangeDate, setSelectedScheduleChangeDate] = useState("");
    const [isPreparingScheduleChange, setIsPreparingScheduleChange] = useState(false);
    const [isApplyingScheduleChange, setIsApplyingScheduleChange] = useState(false);
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("all");
    const [activeSection, setActiveSection] = useState<ClientSectionId>("list");
    const [clientFormActiveStep, setClientFormActiveStep] = useState(0);
    const [detailModalOpen, setDetailModalOpen] = useState(false);

    const { data, isLoading } = useClients(1, 50);
    const deleteClient = useDeleteClient();

    const { data: clientFromParam } = useClient(
        clientIdParam ? Number(clientIdParam) : 0
    );

    const clients = useMemo(() => data?.data || [], [data?.data]);
    const selectedClientFromList = useMemo(
        () =>
            selectedClient
                ? clients.find((client) => client.id === selectedClient.id) ?? selectedClient
                : null,
        [clients, selectedClient]
    );
    const clientFromParamList = useMemo(() => {
        if (!clientIdParam) return null;

        const parsedClientId = Number(clientIdParam);
        if (!Number.isFinite(parsedClientId)) return null;

        return clients.find((client) => client.id === parsedClientId) ?? null;
    }, [clientIdParam, clients]);
    const activeSelectedClient = selectedClientFromList ?? (clientIdParam ? clientFromParamList ?? clientFromParam ?? null : null);
    const panelFormClient = null;
    const shouldShowClientFormPanel = isCreatingClient || shouldOpenClientFormFromUrl;

    const filteredClients = useMemo(() => {
        let result = clients;
        const statusValue = filterValueToStatus(activeFilter);
        if (statusValue) result = result.filter((c) => c.serviceStatus === statusValue);
        if (searchQuery.trim()) {
            result = result.filter((c) =>
                matchesSearchQuery(searchQuery, [c.name, c.phone, c.address]),
            );
        }
        return result;
    }, [clients, activeFilter, searchQuery]);

    const stats = useMemo(() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const nextMonthDate = new Date(currentYear, currentMonth + 1, 1);
        const nextMonthYear = nextMonthDate.getFullYear();
        const nextMonth = nextMonthDate.getMonth();

        const today = new Date(currentYear, currentMonth, now.getDate());
        const threeDaysLater = new Date(currentYear, currentMonth, now.getDate() + 3);

        const thisMonthCount = clients.filter((c) => {
            const dueDate = toDate(c.dueDate);
            return dueDate
                ? dueDate.getFullYear() === currentYear && dueDate.getMonth() === currentMonth
                : false;
        }).length;

        const nextMonthCount = clients.filter((c) => {
            const dueDate = toDate(c.dueDate);
            return dueDate
                ? dueDate.getFullYear() === nextMonthYear && dueDate.getMonth() === nextMonth
                : false;
        }).length;

        const activeCount = clients.filter((c) => c.serviceStatus === "active").length;
        const pendingCount = clients.filter((c) => c.serviceStatus === "waiting").length;

        const endingSoonCount = clients.filter((c) => {
            const endDate = toDate(c.endDate);
            if (!endDate) return false;

            const normalizedEndDate = new Date(
                endDate.getFullYear(),
                endDate.getMonth(),
                endDate.getDate()
            );

            return normalizedEndDate >= today && normalizedEndDate <= threeDaysLater;
        }).length;

        return { thisMonthCount, nextMonthCount, activeCount, pendingCount, endingSoonCount };
    }, [clients]);

    const handleSectionSelect = (sectionId: string) => {
        const nextSection = sectionId as ClientSectionId;
        setActiveSection(nextSection);

        if (nextSection === "automation") {
            setIsCreatingClient(false);
            setSelectedClient(null);
            setClientFormActiveStep(0);

            if (clientIdParam || shouldOpenClientFormFromUrl) {
                router.replace("/clients");
            }
        }
    };

    const handleAddNew = () => {
        setActiveSection("list");

        if (clientIdParam || shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }

        setSelectedClient(null);
        setEditingClient(null);
        setClientFormActiveStep(0);
        setIsCreatingClient(true);
    };

    const handleSelectClient = (client: Client) => {
        setActiveSection("list");

        if (clientIdParam || shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }

        setIsCreatingClient(false);
        setSelectedClient(client);
    };

    const handleEdit = (client: Client) => {
        setEditingClient(client);
        setFormDialogOpen(true);
    };

    const handleDeleteRequest = (id: number) => {
        setDeleteTargetClientId(id);
    };

    const handleResetServiceRecordLinkConfirm = async () => {
        if (resetLinkTargetClientId === null) return;

        setIsResettingLink(true);
        try {
            const overview = await serviceRecordsApi.getClientOverview(resetLinkTargetClientId);
            const assignments = overview.data.assignments ?? [];
            const activeAssignment = assignments.find((assignment) => !assignment.replaced)
                ?? assignments[0]
                ?? null;
            if (!activeAssignment) {
                toast({
                    description: "관리사 배정이 없어 링크를 재설정할 수 없습니다.",
                    variant: "destructive",
                });
                return;
            }

            const reset = await serviceRecordsApi.resetLink(activeAssignment.scheduleId);
            setResetLinkTargetClientId(null);
            setResetServiceRecordUrl(reset.data.serviceRecordUrl);
        } catch {
            toast({
                description: "제공기록지 링크 재설정에 실패했습니다. 잠시 후 다시 시도해 주세요.",
                variant: "destructive",
            });
        } finally {
            setIsResettingLink(false);
        }
    };

    const handleOpenServiceScheduleChange = async (clientId: number) => {
        setIsPreparingScheduleChange(true);
        try {
            const overview = await serviceRecordsApi.getClientOverview(clientId);
            const assignments = overview.data.assignments ?? [];
            const activeAssignment = assignments.find((assignment) => !assignment.replaced)
                ?? assignments[0]
                ?? null;
            if (!activeAssignment) {
                toast({
                    description: "관리사 배정이 없어 서비스 일정을 변경할 수 없습니다.",
                    variant: "destructive",
                });
                return;
            }

            const preview = await serviceRecordsApi.previewScheduleChange(activeAssignment.scheduleId);
            const today = getTodayIsoDate();
            const minimumDate = preview.data.minimumDate > today
                ? preview.data.minimumDate
                : today;
            setSelectedScheduleChangeDate(minimumDate);
            setScheduleChangeTarget({
                scheduleId: activeAssignment.scheduleId,
                sessionIndex: preview.data.sessionIndex,
                currentDate: preview.data.fromDate,
                minimumDate,
            });
        } catch {
            toast({
                description: "변경할 수 있는 다음 서비스 일정을 불러오지 못했습니다.",
                variant: "destructive",
            });
        } finally {
            setIsPreparingScheduleChange(false);
        }
    };

    const handleApplyServiceScheduleChange = async () => {
        if (!scheduleChangeTarget) return;

        setIsApplyingScheduleChange(true);
        try {
            const changed = await serviceRecordsApi.applyScheduleChange(scheduleChangeTarget.scheduleId, {
                toDate: selectedScheduleChangeDate,
            });
            setSelectedClient((currentClient) => {
                if (!currentClient || currentClient.id !== changed.data.clientId) return currentClient;
                return {
                    ...currentClient,
                    endDate: changed.data.newEndDate,
                    pendingScheduleChange: null,
                };
            });
            setScheduleChangeTarget(null);
            setSelectedScheduleChangeDate("");
            await queryClient.invalidateQueries({ queryKey: ["clients"] });
            toast({
                description: `서비스 일정과 종료일(${changed.data.newEndDate})이 변경되었습니다.`,
            });
        } catch (error) {
            toast({
                description: getScheduleChangeErrorMessage(error),
                variant: "destructive",
            });
        } finally {
            setIsApplyingScheduleChange(false);
        }
    };

    const handleCopyResetServiceRecordLink = async (serviceRecordUrl: string) => {
        try {
            await navigator.clipboard.writeText(serviceRecordUrl);
            toast({ description: "제공기록지 링크를 복사했습니다." });
        } catch {
            toast({
                description: "링크 복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.",
                variant: "destructive",
            });
        }
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetClientId === null) return;

        try {
            await deleteClient.mutateAsync(deleteTargetClientId);
            if (activeSelectedClient?.id === deleteTargetClientId) {
                setSelectedClient(null);
            }
            setDeleteTargetClientId(null);
        } catch (err) {
            console.error("Failed to delete client:", err);
            setDeleteTargetClientId(null);
            setDeleteErrorMessage(
                getApiErrorMessage(
                    err,
                    "고객 삭제에 실패했습니다. 다시 시도해 주세요.",
                ),
            );
        }
    };

    const clearSelectedClientScheduleChange = (clientId: number) => {
        setSelectedClient((currentClient) => {
            if (!currentClient || currentClient.id !== clientId) {
                return currentClient;
            }

            return { ...currentClient, pendingScheduleChange: null };
        });
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingClient(null);

        if (shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }
    };

    const handleClientFormDialogSuccess = (client: Client) => {
        setSelectedClient((currentClient) => {
            if (!currentClient || currentClient.id === client.id) {
                return client;
            }

            return currentClient;
        });
        setEditingClient((currentClient) => (
            currentClient?.id === client.id ? client : currentClient
        ));
    };

    const handleClientFormPanelClose = () => {
        setIsCreatingClient(false);
        setClientFormActiveStep(0);

        if (shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }
    };

    const handleClientFormPanelSuccess = (client: Client) => {
        setIsCreatingClient(false);
        setSelectedClient(client);
        setClientFormActiveStep(0);

        if (shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }
    };

    const handleDetailModalClose = () => {
        setDetailModalOpen(false);
        if (clientIdParam) {
            router.replace("/clients");
        }
    };

    return (
        <PageSection name="clients">
            <StatsBar
                name="clients"
                isLoading={isLoading}
                items={[
                    { icon: Calendar, value: stats.thisMonthCount, label: "이번달 고객", counter: "명" },
                    { icon: CalendarDays, value: stats.nextMonthCount, label: "다음달 고객", counter: "명", colorIndex: 1 },
                    { icon: UserCheck, value: stats.activeCount, label: "서비스 진행중", counter: "명", colorIndex: 2 },
                    { icon: Clock, value: stats.pendingCount, label: "서비스 대기중", counter: "명", colorIndex: 1 },
                    { icon: AlertTriangle, value: stats.endingSoonCount, label: "3일내 종료", counter: "명", colorIndex: 3 },
                ]}
            />

            <div data-component="clients-sections" className="flex flex-1 min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch">
                <SectionNav
                    items={CLIENT_SECTIONS}
                    activeId={activeSection}
                    onSelect={handleSectionSelect}
                />

                <div data-component="clients-section-content" className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {activeSection === "list" ? (
                        <section data-component="clients-list-section" className="flex min-h-0 flex-1 flex-col">
                            <SplitLayout data-component="desktop_clients_split-layout-2"
                                hasSelection={shouldShowClientFormPanel || !!activeSelectedClient}
                                onBack={() => {
                                    if (shouldShowClientFormPanel) {
                                        handleClientFormPanelClose();
                                        return;
                                    }

                                    if (clientIdParam) {
                                        router.replace("/clients");
                                    }

                                    setSelectedClient(null);
                                }}
                            >
                <ListPanel data-component="desktop_clients_split-layout_list-panel"
                    title="고객 목록"
                    tabs={FILTER_CHIPS}
                    activeTab={activeFilter}
                    onTabChange={setActiveFilter}
                    searchValue={searchQuery}
                    onSearchChange={setSearchQuery}
                    searchPlaceholder={t(locale, "clients.search-placeholder")}
                    isLoading={isLoading}
                    headerActions={
                        <HeaderActionButton
                            icon={Plus}
                            label={t(locale, "clients.add")}
                            onClick={handleAddNew}
                            data-testid="add-client-button"
                            data-component="clients-header-add"
                            className={
                                shouldShowClientFormPanel
                                    ? "bg-v3-primary text-white hover:bg-v3-primary"
                                    : undefined
                            }
                        />
                    }
                    emptyState={!isLoading && filteredClients.length === 0 ? (
                        <ListEmptyState message={t(locale, "clients.no-data")} />
                    ) : undefined}
                >
                    <div data-component="clients-list-content" className="space-y-2">
                        <AnimatedSlotList<Client>
	                                    items={filteredClients}
	                                    isLoading={isLoading}
	                                    loadingCount={10}
	                                    className="space-y-2"
	                                    itemVariant="card"
	                                    getSlotState={({ item, isLoading }) => ({
	                                        isActive: !isLoading && item?.id === activeSelectedClient?.id,
	                                        isInteractive: !isLoading && Boolean(item),
	                                    })}
	                                    onSlotClick={(client) => handleSelectClient(client)}
	                                    render={({ item, isLoading }) => {
	                                        const client = item;
	                                        if (isLoading) {
	                                            return (
	                                                <>
	                                                    <div data-component="clients-list-item-avatar-skeleton" className="flex h-[calc(44px*var(--glint-ui-scale,1))] w-[calc(44px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white shadow-md">
	                                                        <Skeleton className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))] rounded-md bg-white/70" />
	                                                    </div>
	                                                    <div data-component="clients-list-item-info-skeleton" className="flex-1 min-w-0">
	                                                        <Skeleton className="h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(112px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
	                                                        <Skeleton className="mt-[calc(6px*var(--glint-ui-scale,1))] h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(192px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
	                                                    </div>
	                                                    <Skeleton className="h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(56px*var(--glint-ui-scale,1))] rounded-full bg-v3-dim-white" />
	                                                </>
	                                            );
	                                        }

	                                        if (!client) return null;
	                                        const clientBadges = getClientBadges(client);
	                                        const sortedClientBadges = prioritizeClientBadges(clientBadges);
	                                        const primaryClientBadge = getPrimaryClientBadge(clientBadges);

	                                        return (
	                                            <AnimatedSlotListItemContent
	                                                dataComponent="clients-list-item"
	                                                icon={Users}
	                                                iconContainerClassName={getClientBadgeAvatarClassName(primaryClientBadge)}
	                                                title={client.name}
	                                                subtitle={
	                                                    <>
	                                                        {client.phone ? <span>{formatKoreanPhoneNumber(client.phone)}</span> : null}
	                                                        {client.address ? (
	                                                            <span className="truncate">
	                                                                {client.address.split(" ")[1] || client.address}
	                                                            </span>
	                                                        ) : null}
	                                                    </>
	                                                }
			                                                status={sortedClientBadges.map((badge, badgeIndex) => (
			                                                    <StatusBadge
			                                                        key={badge.key ?? `${badge.status}-${badge.label ?? badgeIndex}`}
			                                                        status={badge.status}
			                                                        label={badge.label}
			                                                    />
			                                                ))}
			                                            />
	                                        );
	                                    }}
	                                />
	                        </div>
	                </ListPanel>

                {shouldShowClientFormPanel ? (
                    <ClientFormPanel
                        client={panelFormClient}
                        onClose={handleClientFormPanelClose}
                        onSuccess={handleClientFormPanelSuccess}
                        activeStep={clientFormActiveStep}
                        onActiveStepChange={setClientFormActiveStep}
                        renderLayout={({ content, footer }) => (
                            <DetailPanel data-component="desktop_clients_split-layout_detail-panel-3"
                                compactBackLabel="고객 목록으로 돌아가기"
                                title={panelFormClient ? t(locale, "clients.form.edit-title") : t(locale, "clients.form.add-title")}
                                subtitle={
                                    panelFormClient
                                        ? "기본 정보, 담당 인력, 서비스 조건을 한 번에 수정합니다."
                                        : "고객의 기본 정보와 서비스 조건을 단계별로 입력합니다."
                                }
                                stepper={
                                    <SteppedWizardStepper
                                        steps={CLIENT_FORM_STEPPER_STEPS}
                                        currentStep={clientFormActiveStep}
                                    />
                                }
                                footer={footer}
                            >
                                {content}
                            </DetailPanel>
                        )}
                    />
                ) : activeSelectedClient ? (
                    <div
                        key={`clients-detail-${activeSelectedClient.id}`}
                        data-component="clients-detail-selection-slide-up"
                        className="h-full min-h-0 animate-v3-slide-up"
                    >
                        <ClientDetailPanel
                            client={activeSelectedClient}
                            compactBackLabel="고객 목록으로 돌아가기"
                            onScheduleChangeDecided={clearSelectedClientScheduleChange}
                            trailing={
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label="고객 작업 메뉴 열기"
                                            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-v3-dim-white transition-colors"
                                        >
                                            <MoreVertical className="w-5 h-5 text-v3-text-muted" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="min-w-[140px]">
                                        <DropdownMenuItem onClick={() => handleEdit(activeSelectedClient)} className="gap-2">
                                            <Pencil className="w-4 h-4" />
                                            {t(locale, "common.edit")}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            data-component="clients-detail-menu-change-service-schedule"
                                            disabled={isPreparingScheduleChange}
                                            onClick={() => void handleOpenServiceScheduleChange(activeSelectedClient.id)}
                                            className="gap-2"
                                        >
                                            <CalendarDays className="w-4 h-4" />
                                            서비스 일정 변경
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            data-component="clients-detail-menu-reset-service-record-link"
                                            onClick={() => setResetLinkTargetClientId(activeSelectedClient.id)}
                                            className="gap-2"
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                            제공기록지 링크 재설정
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            data-component="clients-detail-menu-delete"
                                            onClick={() => handleDeleteRequest(activeSelectedClient.id)}
                                            className="gap-2 text-destructive focus:text-destructive"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            {t(locale, "common.delete")}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            }
                        />
                    </div>
                ) : (
                    <EmptyState name="clients-empty-state" icon={Users} message="고객을 선택하면 상세 정보가 표시됩니다" />
                )}
                            </SplitLayout>
                        </section>
                    ) : (
                        <ClientAutomationSection />
                    )}
                </div>
            </div>

                <ClientDetailModal
                    open={detailModalOpen}
                    onClose={handleDetailModalClose}
                    client={activeSelectedClient}
                    onEdit={handleEdit}
                    onDelete={handleDeleteRequest}
                />

            <ClientFormDialog
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                client={editingClient ?? null}
                onSuccess={handleClientFormDialogSuccess}
            />

            <TwoButtonModal
                open={resetLinkTargetClientId !== null}
                onOpenChange={(open) => {
                    if (!open && !isResettingLink) setResetLinkTargetClientId(null);
                }}
                dataComponent="clients-detail-reset-service-record-link-approval"
                title="제공기록지 링크를 재설정하시겠습니까?"
                description="기존 링크는 만료되고 새 링크가 생성됩니다. 메시지는 발송되지 않습니다."
                isDescriptionVisuallyHidden={false}
                approvalLabel="링크 재설정"
                pendingLabel="재설정 중..."
                isPending={isResettingLink}
                onApprove={() => void handleResetServiceRecordLinkConfirm()}
            />

            <ServiceRecordLinkResetResultModal
                open={resetServiceRecordUrl !== null}
                serviceRecordUrl={resetServiceRecordUrl ?? ""}
                onClose={() => setResetServiceRecordUrl(null)}
                onCopy={(serviceRecordUrl) => void handleCopyResetServiceRecordLink(serviceRecordUrl)}
            />

            {scheduleChangeTarget ? (
                <ServiceScheduleChangeModal
                    open
                    sessionIndex={scheduleChangeTarget.sessionIndex}
                    currentDate={scheduleChangeTarget.currentDate}
                    minimumDate={scheduleChangeTarget.minimumDate}
                    selectedDate={selectedScheduleChangeDate}
                    isPending={isApplyingScheduleChange}
                    onDateChange={setSelectedScheduleChangeDate}
                    onClose={() => {
                        setScheduleChangeTarget(null);
                        setSelectedScheduleChangeDate("");
                    }}
                    onSubmit={() => void handleApplyServiceScheduleChange()}
                />
            ) : null}

            <TwoButtonModal
                open={deleteTargetClientId !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTargetClientId(null);
                }}
                dataComponent="clients-delete-approval"
                title={t(locale, "clients.delete-confirm")}
                description="삭제한 고객 정보는 복구할 수 없습니다."
                approvalLabel={t(locale, "common.delete")}
                pendingLabel="삭제 중..."
                approvalVariant="destructive"
                isPending={deleteClient.isPending}
                onApprove={() => void handleDeleteConfirm()}
            />

            <NotificationOneButtonModal
                open={deleteErrorMessage !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteErrorMessage(null);
                }}
                dataComponent="clients-delete-error-notification"
                title="고객을 삭제하지 못했습니다."
                description={deleteErrorMessage ?? ""}
                isDescriptionVisuallyHidden={false}
                onAcknowledge={() => setDeleteErrorMessage(null)}
            />
        </PageSection>
    );
}
