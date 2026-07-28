"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { useClients, useDeleteClient, useClient } from "@/hooks/useClients";
import { Client, SERVICE_STATUS_OPTIONS, type ServiceStatus } from "@/lib/client/types";
import { ClientFormDialog } from "./ClientFormDialog";
import { ClientDetailModal } from "./ClientDetailModal";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { ExpandableSearch } from "@/components/app/v3/ExpandableSearch";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ContentPaper } from "../root/content-paper";
import { DataTablePagination } from "../ui/datatable/DataTablePagination";
import { cn } from "@/lib/utils";

const STATUS_FILTER_OPTIONS: Array<{ value: ServiceStatus | null; label: string }> = [
    { value: null, label: "전체" },
    { value: "pre_booking", label: "예약 전" },
    { value: "waiting", label: "대기" },
    { value: "replacement_requested", label: "교체 요청" },
    { value: "active", label: "진행중" },
    { value: "completed", label: "완료" },
    { value: "terminated", label: "중단" },
];

const getStatusBadgeVariant = (status: ServiceStatus | null) => {
    switch (status) {
        case "pre_booking": return "outline";
        case "waiting": return "v3-pending";
        case "replacement_requested": return "v3-expired";
        case "active": return "v3-active";
        case "terminated": return "v3-expired";
        case "completed": return "outline";
        default: return "outline";
    }
};

const getStatusLabel = (status: ServiceStatus | null) => {
    const option = SERVICE_STATUS_OPTIONS.find(o => o.value === status);
    return option ? option.label : "-";
};

const getAvatarGradient = (name: string) => {
    const charCode = name.charCodeAt(0);
    const gradients = [
        "bg-gradient-to-br from-[hsl(214,100%,34%)] to-[hsl(214,100%,28%)]",
        "bg-gradient-to-br from-[hsl(137,34%,31%)] to-[hsl(137,34%,25%)]",
        "bg-gradient-to-br from-[hsl(355,36%,45%)] to-[hsl(355,36%,38%)]",
        "bg-gradient-to-br from-[hsl(34,100%,55%)] to-[hsl(34,100%,45%)]",
        "bg-gradient-to-br from-[hsl(175,60%,40%)] to-[hsl(175,60%,30%)]",
        "bg-gradient-to-br from-[hsl(270,60%,55%)] to-[hsl(270,60%,45%)]",
    ];
    return gradients[charCode % gradients.length];
};

export function ClientsTable() {
    const locale = useLocale();
    const router = useRouter();
    const searchParams = useSearchParams();
    const clientIdParam = searchParams.get("id");

    const [page, setPage] = useState(0);
    const [rowsPerPage] = useState(8);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<ServiceStatus | null>(null);

    const { data, isLoading } = useClients(
        page + 1,
        rowsPerPage,
        searchQuery.trim() ? searchQuery.trim() : undefined
    );
    const deleteClient = useDeleteClient();

    const { data: clientFromParam } = useClient(clientIdParam ? Number(clientIdParam) : 0);

    useEffect(() => {
        if (clientIdParam && clientFromParam) {
            queueMicrotask(() => {
                setSelectedClient(clientFromParam);
                setDetailModalOpen(true);
            });
        }
    }, [clientIdParam, clientFromParam]);

    const handleAddNew = () => {
        setEditingClient(null);
        setFormDialogOpen(true);
    };

    const handleRowClick = (client: Client) => {
        setSelectedClient(client);
        setDetailModalOpen(true);
    };

    const handleEdit = (client: Client) => {
        setEditingClient(client);
        setFormDialogOpen(true);
    };

    const handleDeleteRequest = (id: number) => {
        setDeleteTargetClientId(id);
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetClientId === null) return;

        try {
            await deleteClient.mutateAsync(deleteTargetClientId);
            setDeleteTargetClientId(null);
        } catch (err) {
            console.error("Failed to delete client:", err);
        }
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingClient(null);
    };

    const handleDetailModalClose = () => {
        setDetailModalOpen(false);
        setSelectedClient(null);
        if (clientIdParam) {
            router.replace("/clients");
        }
    };

    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        setPage(0);
    };

    const handleFilterChange = (value: ServiceStatus | null) => {
        setStatusFilter(value);
        setPage(0);
    };

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
    };

    const clients = useMemo(() => data?.data ?? [], [data?.data]);
    const filteredClients = useMemo(() => {
        if (!statusFilter) return clients;
        return clients.filter((client) => client.serviceStatus === statusFilter);
    }, [clients, statusFilter]);

    const total = data?.total || 0;

    return (
        <div data-component="desktop_clients_table" className="space-y-6 animate-slide-up pb-10">
            <div data-component="desktop_clients_table_header" className="flex justify-between items-center">
                 <div className="space-y-1">
                    <h1 className="text-2xl font-bold text-[hsl(214,40%,18%)]">고객 관리 👥</h1>
                    <p className="text-sm text-muted-foreground">전체 고객 정보를 확인하고 관리하세요</p>
                 </div>
                 <div className="flex gap-3">
                     <Button variant="neutral" className="hidden sm:flex">📊 내보내기</Button>
                     <Button variant="positive" onClick={handleAddNew} data-testid="add-client-button">
                        <Plus className="h-4 w-4 mr-1" />
                        {t(locale, "clients.add")}
                     </Button>
                 </div>
            </div>

            <div data-component="desktop_clients_table_filters" className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
                <ExpandableSearch
                    value={searchQuery}
                    onChange={handleSearchChange}
                    placeholder={t(locale, "clients.search-placeholder")}
                    expandedWidth="flex-1"
                    className="h-12 w-full rounded-full bg-white px-4 shadow-sm transition-transform focus-within:scale-[1.01] lg:max-w-md"
                />
                <div className="flex gap-2 overflow-x-auto pb-2 lg:pb-0 w-full no-scrollbar">
                    {STATUS_FILTER_OPTIONS.map((opt) => (
                        <Button
                            key={opt.value || "all"}
                            variant={statusFilter === opt.value ? "positive" : "subtle"}
                            onClick={() => handleFilterChange(opt.value)}
                            className={cn(
                                "rounded-full px-5 h-10 text-xs font-bold shadow-sm transition-transform hover:-translate-y-0.5",
                                statusFilter !== opt.value && "bg-white text-muted-foreground hover:bg-[hsl(214,80%,95%)] hover:text-[hsl(214,100%,34%)]"
                            )}
                        >
                            {opt.label}
                        </Button>
                    ))}
                </div>
            </div>

            <div data-component="desktop_clients_table_stats" className="flex flex-wrap gap-4">
                <div className="bg-white p-5 rounded-[20px] shadow-[0_4px_24px_hsla(214,50%,20%,0.06)] flex items-center gap-4 hover:-translate-y-1 transition-transform duration-300">
                    <div className="w-12 h-12 rounded-[14px] bg-[hsl(214,80%,95%)] flex items-center justify-center text-xl">👥</div>
                    <div>
                        <h3 className="text-2xl font-bold text-[hsl(214,40%,18%)] leading-none">{total}</h3>
                        <p className="text-[11px] text-muted-foreground mt-1">전체 고객</p>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-[20px] shadow-[0_4px_24px_hsla(214,50%,20%,0.06)] flex items-center gap-4 hover:-translate-y-1 transition-transform duration-300">
                    <div className="w-12 h-12 rounded-[14px] bg-[hsl(137,40%,93%)] flex items-center justify-center text-xl">✅</div>
                    <div>
                        <h3 className="text-2xl font-bold text-[hsl(214,40%,18%)] leading-none">-</h3>
                        <p className="text-[11px] text-muted-foreground mt-1">진행중</p>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-[20px] shadow-[0_4px_24px_hsla(214,50%,20%,0.06)] flex items-center gap-4 hover:-translate-y-1 transition-transform duration-300">
                    <div className="w-12 h-12 rounded-[14px] bg-[hsl(34,100%,94%)] flex items-center justify-center text-xl">⏳</div>
                    <div>
                        <h3 className="text-2xl font-bold text-[hsl(214,40%,18%)] leading-none">-</h3>
                        <p className="text-[11px] text-muted-foreground mt-1">대기중</p>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-[20px] shadow-[0_4px_24px_hsla(214,50%,20%,0.06)] flex items-center gap-4 hover:-translate-y-1 transition-transform duration-300">
                    <div className="w-12 h-12 rounded-[14px] bg-[hsl(355,40%,94%)] flex items-center justify-center text-xl">⚠️</div>
                    <div>
                        <h3 className="text-2xl font-bold text-[hsl(214,40%,18%)] leading-none">-</h3>
                        <p className="text-[11px] text-muted-foreground mt-1">만료임박</p>
                    </div>
                </div>
            </div>

            <ContentPaper variant="v3" className="flex flex-col min-h-[600px] overflow-hidden p-0">
                <div className="px-6 py-5 border-b border-border flex justify-between items-center bg-white">
                    <h3 className="font-bold text-base text-[hsl(214,40%,18%)]">고객 목록</h3>
                    <div className="flex gap-1 bg-[hsl(220,20%,97%)] p-1 rounded-xl">
                        <Button variant="ghost" size="sm" className="bg-white shadow-sm h-7 rounded-[10px] text-xs font-semibold text-[hsl(214,100%,34%)]">목록</Button>
                        <Button variant="ghost" size="sm" className="text-muted-foreground h-7 rounded-[10px] text-xs hover:text-foreground">카드</Button>
                    </div>
                </div>
                
                <div data-component="desktop_clients_table_body" className="p-3 bg-[hsl(220,20%,99%)] flex-1 overflow-y-auto">
                    <div className="space-y-2">
                        {isLoading ? (
                             <div className="p-8 text-center text-muted-foreground">Loading...</div>
                        ) : filteredClients.length === 0 ? (
                             <div className="p-8 text-center text-muted-foreground">{t(locale, "clients.no-data")}</div>
                        ) : (
                            filteredClients.map((client: Client, idx: number) => (
                                <Card 
                                    key={client.id} 
                                    variant="v3" 
                                    data-component="desktop_clients_table_body_row"
                                    className="flex items-center gap-4 p-5 cursor-pointer animate-pop-in border-2 border-transparent hover:border-[hsl(214,100%,34%)] hover:bg-[hsl(214,80%,98%)] group" 
                                    style={{ animationDelay: `${idx * 0.05}s` }} 
                                    onClick={() => handleRowClick(client)}
                                >
                                    <div className={cn(
                                        "w-14 h-14 rounded-[18px] flex items-center justify-center shrink-0 shadow-md transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3",
                                        getAvatarGradient(client.name)
                                    )}>
                                        <Users className="w-5 h-5 shrink-0 transition-colors text-white" aria-hidden="true" />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-bold text-[0.95rem] text-[hsl(214,40%,18%)]">{client.name}</span>
                                            <Badge variant="secondary" className="bg-[hsl(270,60%,94%)] text-[hsl(270,60%,55%)] border-none rounded-full px-2 py-0.5 text-[10px] font-bold">
                                                {client.type || "일반"}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span>📱 {client.phone}</span>
                                            <span>📍 {client.address?.split(" ")[1] || client.address}</span>
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end gap-1.5">
                                        <Badge variant={getStatusBadgeVariant(client.serviceStatus)} className="rounded-full px-3 py-1 text-[10px]">
                                            {getStatusLabel(client.serviceStatus)}
                                        </Badge>
                                        <span className="text-[10px] text-muted-foreground">
                                            {client.duration ? `${client.duration}일` : "-"}
                                        </span>
                                    </div>
                                </Card>
                            ))
                        )}
                    </div>
                </div>

                <div className="border-t border-border p-2 bg-white">
                    <DataTablePagination
                        count={total}
                        page={page}
                        rowsPerPage={rowsPerPage}
                        onPageChange={handlePageChange}
                    />
                </div>
            </ContentPaper>

            <ClientDetailModal
                open={detailModalOpen}
                onClose={handleDetailModalClose}
                client={selectedClient}
                onEdit={handleEdit}
                onDelete={handleDeleteRequest}
            />

            <ClientFormDialog
                data-component="desktop_clients_table_form-dialog"
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                client={editingClient}
            />

            <TwoButtonModal
                open={deleteTargetClientId !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTargetClientId(null);
                }}
                dataComponent="desktop_clients_table_delete-approval"
                title={t(locale, "clients.delete-confirm")}
                description="삭제한 고객 정보는 복구할 수 없습니다."
                approvalLabel={t(locale, "common.delete")}
                pendingLabel="삭제 중..."
                approvalVariant="destructive"
                isPending={deleteClient.isPending}
                onApprove={() => void handleDeleteConfirm()}
            />
        </div>
    );
}
