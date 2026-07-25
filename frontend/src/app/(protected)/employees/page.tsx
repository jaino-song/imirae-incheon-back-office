"use client";

import { useMemo, useState } from "react";
import {
    EMPLOYEE_STATUS_LABELS,
    OPEN_TO_NEXT_WORK_LABELS,
} from "@babyjamjam/shared/constants/employee-status";
import { getApiErrorMessage } from "@babyjamjam/shared";
import { cn } from "@/lib/utils";
import {
    Users,
    UserCheck,
    Clock,
    Briefcase,
    CircleOff,
    Plus,
    Phone,
    Calendar,
    MoreVertical,
    Pencil,
    Trash2,
} from "lucide-react";
import {
    Employee,
    useDeleteEmployee,
} from "@/hooks/useEmployees";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";
import {
    EmployeeFormDialog,
    EmployeeFormPanel,
} from "@/components/app/employees/EmployeeFormDialog";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import {
    StatsBar,
    SplitLayout,
    ListPanel,
    DetailPanel,
    InfoCard,
    InfoRow,
    HeaderActionButton,
    AnimatedSlotList,
    AnimatedSlotListItemContent,
    EmptyState,
    PageSection,
    ListEmptyState,
} from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/app/ui/status-badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatWorkAreaLabel } from "@/components/app/employees/employee-form.constants";
import { getEmployeeGradeBadgeStyle, normalizeEmployeeGrade } from "@/features/employees/grade";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

const filterItems = [
    { label: "전체", value: "all" },
    { label: EMPLOYEE_STATUS_LABELS.available, value: "active" },
    { label: EMPLOYEE_STATUS_LABELS.unavailable, value: "inactive" },
];

function getGradeBadge(grade: string) {
    const { label, variant } = getEmployeeGradeBadgeStyle(grade);

    return (
        <StatusPill variant={variant} size="sm" className="px-2.5 py-0.5 text-[0.6rem]">
            {label}
        </StatusPill>
    );
}

function getOpenToNextWorkBadge(openToNextWork: boolean) {
    return (
        <StatusPill variant={openToNextWork ? "success" : "neutral"} size="sm" className="px-2.5 py-0.5 text-[0.6rem]">
            {OPEN_TO_NEXT_WORK_LABELS[openToNextWork ? "true" : "false"]}
        </StatusPill>
    );
}

function getEmployeeAvatarClassName(openToNextWork: boolean): string {
    return openToNextWork
        ? "border border-[hsl(137,34%,84%)] bg-[hsl(137,60%,94%)] text-v3-green"
        : "border border-[hsl(220,20%,90%)] bg-[hsl(220,20%,97%)] text-v3-text-muted";
}

function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return "-";
    return formatDateForDisplay(dateStr);
}

function formatPhoneNumber(phone: string | null | undefined): string {
    if (!phone) return "-";

    const numbers = phone.replace(/[^\d]/g, "");
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;

    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
}

export default function EmployeesPage() {
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState("all");
    const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [deleteTargetEmployeeId, setDeleteTargetEmployeeId] = useState<number | null>(null);
    const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

    const {
        employees,
        allEmployees,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
    } = useInfiniteEmployees({ filter, search });
    const deleteEmployee = useDeleteEmployee();

    const stats = useMemo(() => {
        return {
            total: allEmployees.length,
            working: allEmployees.filter((e: Employee) => e.status === "working").length,
            available: allEmployees.filter((e: Employee) => e.status === "available").length,
            unavailable: allEmployees.filter((e: Employee) => e.status === "unavailable").length,
        };
    }, [allEmployees]);

    const handleAddNew = () => {
        setEditingEmployee(null);
        setFormDialogOpen(false);
        setSelectedEmployee(null);
        setIsCreatingEmployee(true);
    };

    const handleSelectEmployee = (employee: Employee) => {
        setIsCreatingEmployee(false);
        setSelectedEmployee(employee);
    };

    const handleEdit = (employee: Employee) => {
        setIsCreatingEmployee(false);
        setEditingEmployee(employee);
        setFormDialogOpen(true);
    };

    const handleDeleteRequest = (id: number) => {
        setDeleteTargetEmployeeId(id);
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetEmployeeId === null) return;

        try {
            await deleteEmployee.mutateAsync(deleteTargetEmployeeId);

            if (selectedEmployee?.id === deleteTargetEmployeeId) {
                setSelectedEmployee(null);
            }

            setDeleteTargetEmployeeId(null);
        } catch (err) {
            console.error("Failed to delete employee:", err);
            setDeleteTargetEmployeeId(null);
            setDeleteErrorMessage(getApiErrorMessage(
                err,
                "제공인력 삭제에 실패했습니다. 다시 시도해 주세요.",
            ));
        }
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingEmployee(null);
    };

    const handleFormPanelClose = () => {
        setIsCreatingEmployee(false);
    };

    const handleFormPanelSuccess = (employee: Employee) => {
        setIsCreatingEmployee(false);
        setSelectedEmployee(employee);
    };

    return (
        <PageSection name="employees">
            <StatsBar
                name="employees"
                isLoading={isLoading}
                items={[
                    { icon: Users, value: stats.total, label: "전체 직원", counter: "명" },
                    { icon: Briefcase, value: stats.working, label: "근무 중", counter: "명", colorIndex: 2 },
                    { icon: Clock, value: stats.available, label: EMPLOYEE_STATUS_LABELS.available, counter: "명", colorIndex: 1 },
                    { icon: CircleOff, value: stats.unavailable, label: EMPLOYEE_STATUS_LABELS.unavailable, counter: "명", colorIndex: 3 },
                ]}
            />

            <SplitLayout data-component="desktop_employees_split-layout"
                hasSelection={isCreatingEmployee || !!selectedEmployee}
                onBack={() => {
                    if (isCreatingEmployee) {
                        handleFormPanelClose();
                        return;
                    }

                    setSelectedEmployee(null);
                }}
            >
                <ListPanel data-component="desktop_employees_split-layout_list-panel"
                    title="직원 목록"
                    tabs={filterItems}
                    activeTab={filter}
                    onTabChange={setFilter}
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="이름, 연락처, 지역으로 검색..."
                    isLoading={isLoading}
                    headerActions={
                        <HeaderActionButton
                            icon={Plus}
                            label="직원 추가"
                            onClick={handleAddNew}
                            data-component="employees-header-add"
                            className="text-[calc(12px*var(--glint-ui-scale,1))]"
                        />
                    }
                    emptyState={!isLoading && employees.length === 0 ? (
                        <ListEmptyState
                            name="employees-empty"
                            message={search || filter !== "all" ? "검색 결과가 없습니다" : "등록된 직원이 없습니다"}
                        />
                    ) : undefined}
                >
                    <AnimatedSlotList<Employee>
                            items={employees}
                            isLoading={isLoading}
                            loadingCount={6}
                            className="space-y-2"
                            getSlotState={({ item, isLoading: slotLoading }) => {
                                const isActive = !slotLoading && item && selectedEmployee?.id === item.id;
                                return {
                                    isActive: Boolean(isActive),
                                    isInteractive: !slotLoading && Boolean(item),
                                };
                            }}
                            onSlotClick={(employee) => handleSelectEmployee(employee)}
                            hasMore={hasNextPage}
                            onLoadMore={() => fetchNextPage()}
                            isFetchingMore={isFetchingNextPage}
                            render={({ item: employee, isLoading: slotLoading }) => {
                                if (slotLoading) {
                                    return (
                                        <>
                                            <div data-component="employees-list-item-avatar-skeleton" className="w-11 h-11 rounded-[14px] shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center">
                                                <Skeleton className="w-5 h-5 rounded-md bg-white/70" />
                                            </div>
                                            <div data-component="employees-list-item-info-skeleton" className="flex-1 min-w-0">
                                                <Skeleton className="h-4 w-24 mb-1.5 bg-v3-dim-white" />
                                                <Skeleton className="h-3 w-40 bg-v3-dim-white" />
                                            </div>
                                            <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white shrink-0" />
                                        </>
                                    );
                                }

                                if (!employee) return null;

                                return (
                                    <AnimatedSlotListItemContent
                                        dataComponent="employees-list-item"
                                        icon={UserCheck}
                                        iconContainerClassName={getEmployeeAvatarClassName(employee.openToNextWork)}
                                        title={employee.name}
                                        subtitle={
                                            <span className="flex items-center gap-1 truncate">
                                                <Phone className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))]" />
                                                {formatPhoneNumber(employee.phone)}
                                            </span>
                                        }
                                        status={getOpenToNextWorkBadge(employee.openToNextWork)}
                                    />
                                );
                            }}
                        />
                </ListPanel>

                {isCreatingEmployee ? (
                    <EmployeeFormPanel
                        onClose={handleFormPanelClose}
                        onSuccess={handleFormPanelSuccess}
                        renderLayout={({ content, footer }) => (
                            <DetailPanel data-component="desktop_employees_split-layout_detail-panel_create"
                                compactBackLabel="직원 목록으로 돌아가기"
                                title="직원 추가"
                                subtitle="이름, 연락처, 등급과 근무 가능 지역을 입력합니다."
                                avatar={
                                    <div
                                        data-component="employees-create-avatar"
                                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
                                    >
                                        <UserCheck className="h-5 w-5" />
                                    </div>
                                }
                                footer={footer}
                            >
                                {content}
                            </DetailPanel>
                        )}
                    />
                ) : selectedEmployee ? (
                    <EmployeeDetail
                        employee={selectedEmployee}
                        onEdit={handleEdit}
                        onDelete={handleDeleteRequest}
                    />
                ) : (
                    <EmptyState name="employees-empty-detail" icon={Users} message="직원을 선택하면 상세 정보가 표시됩니다" />
                )}
            </SplitLayout>

            <EmployeeFormDialog
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                employee={editingEmployee}
            />

            <TwoButtonModal
                open={deleteTargetEmployeeId !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTargetEmployeeId(null);
                }}
                dataComponent="employees-delete-approval"
                title="직원을 삭제하시겠습니까?"
                description="삭제한 직원 정보는 복구할 수 없습니다."
                approvalLabel="삭제"
                pendingLabel="삭제 중..."
                approvalVariant="destructive"
                isPending={deleteEmployee.isPending}
                onApprove={() => void handleDeleteConfirm()}
            />
            <NotificationOneButtonModal
                open={deleteErrorMessage !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteErrorMessage(null);
                }}
                dataComponent="employees-delete-error-notification"
                title="직원을 삭제하지 못했습니다."
                description={deleteErrorMessage ?? ""}
                isDescriptionVisuallyHidden={false}
                onAcknowledge={() => setDeleteErrorMessage(null)}
            />
        </PageSection>
    );
}

interface EmployeeDetailProps {
    employee: Employee;
    onEdit: (employee: Employee) => void;
    onDelete: (id: number) => void;
}

function EmployeeDetail({ employee, onEdit, onDelete }: EmployeeDetailProps) {
    return (
        <DetailPanel data-component="desktop_employees_split-layout_detail-panel"
            avatar={
                <div data-component="employees-detail-avatar" className={cn("w-12 h-12 rounded-[16px] flex items-center justify-center shadow-lg shrink-0", getEmployeeAvatarClassName(employee.openToNextWork))}>
                    <UserCheck className="w-5 h-5 shrink-0 transition-colors" aria-hidden="true" />
                </div>
            }
            title={employee.name}
            badges={
                <>
                    {getGradeBadge(employee.grade)}
                    {getOpenToNextWorkBadge(employee.openToNextWork)}
                </>
            }
            subtitle={
                <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    등록일 {formatDate(employee.registeredDate)}
                </span>
            }
            trailing={
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label="직원 작업 메뉴 열기"
                            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-v3-dim-white transition-colors"
                        >
                            <MoreVertical className="w-5 h-5 text-v3-text-muted" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[140px]">
                        <DropdownMenuItem onClick={() => onEdit(employee)} className="gap-2">
                            <Pencil className="w-4 h-4" />
                            수정
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            data-component="employees-detail-menu-delete"
                            onClick={() => onDelete(employee.id)}
                            className="gap-2 text-destructive focus:text-destructive"
                        >
                            <Trash2 className="w-4 h-4" />
                            삭제
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            }
        >
            <div data-component="employees-detail" className="space-y-5">
                <InfoCard data-component="desktop_employees_detail-panel_info-card" title="기본 정보">
                    <InfoRow label="이름" value={employee.name} />
                    <InfoRow label="연락처" value={formatPhoneNumber(employee.phone)} />
                    <InfoRow label="근무 상태" value={EMPLOYEE_STATUS_LABELS[employee.status]} />
                </InfoCard>

                <InfoCard data-component="desktop_employees_detail-panel_info-card-2" title="업무 정보">
                    <InfoRow label="등급" value={normalizeEmployeeGrade(employee.grade)} />
                    <InfoRow
                        label="다음 업무 가능"
                        value={employee.openToNextWork ? "가능" : "불가"}
                    />
                    <InfoRow
                        label="근무 지역"
                        value={
                            <div data-component="employees-detail-work-area-tags" className="flex flex-wrap gap-1.5">
                                {employee.workArea.map((area) => (
                                    <span
                                        key={area}
                                        className="inline-flex items-center rounded-full bg-v3-primary-light text-v3-primary px-2 py-0.5 text-[0.65rem] font-medium"
                                    >
                                        {formatWorkAreaLabel(area)}
                                    </span>
                                ))}
                            </div>
                        }
                    />
                </InfoCard>

                <InfoCard data-component="desktop_employees_detail-panel_info-card-3" title="등록 정보">
                    <InfoRow label="등록일" value={formatDate(employee.registeredDate)} />
                </InfoCard>
            </div>
        </DetailPanel>
    );
}
