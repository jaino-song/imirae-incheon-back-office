"use client";

import { useState, useMemo } from "react";
import { Plus } from "lucide-react";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { ContentPaper } from "../root/content-paper";
import {
    Employee,
    EmployeeStatus,
    useEmployees,
    useDeleteEmployee,
} from "@/hooks/useEmployees";
import { EmployeeFormDialog } from "./EmployeeFormDialog";
import { EmployeeDetailModal } from "./EmployeeDetailModal";
import { DataTable, type DataTableColumn, type FilterOption } from "@/components/app/ui/datatable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { EMPLOYEE_STATUS_LABELS } from "@babyjamjam/shared/constants/employee-status";
import { getApiErrorMessage } from "@babyjamjam/shared";

const EMPLOYEES_TABLE_BASE = "mobile_employees_table";

const formatPhoneNumber = (phone: string | null | undefined): string => {
    if (!phone) return "-";
    const numbers = phone.replace(/[^\d]/g, "");
    if (numbers.length <= 3) return numbers || "-";
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
};

const getStatusBadge = (status: EmployeeStatus | undefined) => {
    switch (status) {
        case "available":
            return (
                <Badge variant="success" className="min-w-[65px] justify-center">
                    {EMPLOYEE_STATUS_LABELS.available}
                </Badge>
            );
        case "working":
            return (
                <Badge variant="warning" className="min-w-[65px] justify-center">
                    {EMPLOYEE_STATUS_LABELS.working}
                </Badge>
            );
        case "unavailable":
        default:
            return (
                <Badge variant="secondary" className="min-w-[65px] justify-center">
                    {EMPLOYEE_STATUS_LABELS.unavailable}
                </Badge>
            );
    }
};

const statusFilterOptions: FilterOption[] = [
    { label: "전체", value: null, color: "default" },
    { label: EMPLOYEE_STATUS_LABELS.available, value: "available", color: "success" },
    { label: EMPLOYEE_STATUS_LABELS.working, value: "working", color: "warning" },
    { label: EMPLOYEE_STATUS_LABELS.unavailable, value: "unavailable", color: "default" },
];

export function EmployeesTable() {
    const locale = useLocale();
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
    const [deleteTargetEmployeeId, setDeleteTargetEmployeeId] = useState<number | null>(null);
    const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

    const { data: employees, isLoading, error } = useEmployees();
    const deleteEmployee = useDeleteEmployee();

    const filteredEmployees = useMemo(() => {
        if (!selectedFilter) return employees || [];
        return (employees || []).filter(emp => emp.status === selectedFilter);
    }, [employees, selectedFilter]);

    const handleAddNew = () => {
        setEditingEmployee(null);
        setFormDialogOpen(true);
    };

    const handleRowClick = (employee: Employee) => {
        setSelectedEmployee(employee);
        setDetailModalOpen(true);
    };

    const handleEdit = (employee: Employee) => {
        setEditingEmployee(employee);
        setFormDialogOpen(true);
    };

    const handleDelete = (id: number) => {
        setDeleteTargetEmployeeId(id);
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetEmployeeId === null) return;

        try {
            await deleteEmployee.mutateAsync(deleteTargetEmployeeId);
            setDeleteTargetEmployeeId(null);
            handleDetailModalClose();
        } catch (err) {
            console.error("Failed to delete employee:", err);
            setDeleteTargetEmployeeId(null);
            setDeleteErrorMessage(getApiErrorMessage(
                err,
                t(locale, "employees.delete-confirm.error"),
            ));
        }
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingEmployee(null);
    };

    const handleDetailModalClose = () => {
        setDetailModalOpen(false);
        setSelectedEmployee(null);
    };

    type EmployeeRow = Employee & Record<string, unknown>;
    const tableData = (filteredEmployees || []) as EmployeeRow[];

    const columns: DataTableColumn<EmployeeRow>[] = [
        {
            key: "name",
            header: t(locale, "employees.table.name"),
            width: "30%",
            align: "center",
        },
        {
            key: "status",
            header: t(locale, "employees.table.open-status"),
            width: "30%",
            align: "center",
            render: (employee) => getStatusBadge(employee.status as EmployeeStatus | undefined),
        },
        {
            key: "phone",
            header: t(locale, "employees.table.contact"),
            width: "40%",
            align: "center",
            render: (employee) => formatPhoneNumber(employee.phone as string | null | undefined),
        },
    ];

    const toolbarActions = (
        <Button
            data-component={`${EMPLOYEES_TABLE_BASE}_data-table_toolbar_add`}
            className="gap-2 w-[100px]"
            onClick={handleAddNew}
        >
            <Plus className="h-4 w-4" />
            {t(locale, "employees.add")}
        </Button>
    );

    if (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return (
            <ContentPaper
                title={t(locale, "employees.title")}
                subtitle={t(locale, "employees.subtitle")}
                className="min-h-[70vh] flex-grow w-full"
            >
                <div data-component={`${EMPLOYEES_TABLE_BASE}_error`} className="p-3">
                    <Alert variant="destructive">
                        <AlertDescription>
                            직원 목록을 불러오는데 실패했습니다: {errorMessage}
                        </AlertDescription>
                    </Alert>
                </div>
            </ContentPaper>
        );
    }

    return (
        <ContentPaper
            title={t(locale, "employees.title")}
            subtitle={t(locale, "employees.subtitle")}
            className="min-h-[70vh] flex-grow w-full"
        >
            <div data-component={EMPLOYEES_TABLE_BASE}>
                <DataTable<EmployeeRow>
                    data-component={`${EMPLOYEES_TABLE_BASE}_data-table`}
                    data={tableData}
                    columns={columns}
                    isLoading={isLoading}
                    getRowKey={(employee) => String(employee.id)}
                    searchEnabled={true}
                    searchPlaceholder="검색"
                    searchFields={["name", "phone"]}
                    filterOptions={statusFilterOptions}
                    filterValue={selectedFilter}
                    onFilterChange={(value) => setSelectedFilter(value)}
                    pageSize={8}
                    onRowClick={handleRowClick}
                    toolbarActions={toolbarActions}
                    emptyMessage={t(locale, "employees.no-employees")}
                />

                {/* Detail Modal */}
                <EmployeeDetailModal
                    open={detailModalOpen}
                    onClose={handleDetailModalClose}
                    employee={selectedEmployee}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                />

                {/* Form Dialog */}
                <EmployeeFormDialog
                    open={formDialogOpen}
                    onClose={handleFormDialogClose}
                    employee={editingEmployee}
                />

                <ApprovalTwoButtonModal
                    open={deleteTargetEmployeeId !== null}
                    onOpenChange={(open) => {
                        if (!open) setDeleteTargetEmployeeId(null);
                    }}
                    data-component="mobile_employees_table_delete-approval"
                    title={t(locale, "employees.delete-confirm.title")}
                    description={t(locale, "employees.delete-confirm.message")}
                    approvalLabel={t(locale, "common.delete")}
                    pendingLabel="삭제 중..."
                    approvalVariant="destructive"
                    isPending={deleteEmployee.isPending}
                    onApprove={handleDeleteConfirm}
                />

                <NotificationOneButtonModal
                    open={deleteErrorMessage !== null}
                    onOpenChange={(open) => {
                        if (!open) setDeleteErrorMessage(null);
                    }}
                    data-component="mobile_employees_table_delete-error-notification"
                    title="직원을 삭제하지 못했습니다."
                    description={deleteErrorMessage ?? ""}
                    isDescriptionVisuallyHidden={false}
                    onAcknowledge={() => setDeleteErrorMessage(null)}
                />
            </div>
        </ContentPaper>
    );
}
