"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useFilteredClients, useDeleteClient } from "@/hooks/useClients";
import { Client, DocumentStatus } from "@/lib/client/types";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { ClientFormDialog } from "@/components/app/clients/ClientFormDialog";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

type FilterType = "starting-soon" | "ending-soon" | "incomplete-contracts" | "no-contract";

const FILTER_CONFIG: Record<FilterType, { title: string }> = {
    "starting-soon": { title: "7일 내 서비스 시작 예정" },
    "ending-soon": { title: "7일 내 서비스 종료 예정" },
    "incomplete-contracts": { title: "계약서 미완료" },
    "no-contract": { title: "계약서 미발송" },
};

const getDocumentStatusBadge = (status: DocumentStatus) => {
    switch (status) {
        case "completed":
            return <Badge variant="success">완료</Badge>;
        case "opened":
        case "requested":
            return <Badge variant="warning">진행중</Badge>;
        case "created":
            return <Badge variant="info">생성됨</Badge>;
        default:
            return <Badge variant="outline">미발송</Badge>;
    }
};

const formatDate = (dateStr: string | null): string => {
    return formatDateForDisplay(dateStr);
};

function FilteredClientsTableSkeleton() {
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="whitespace-nowrap">이름</TableHead>
                    <TableHead className="whitespace-nowrap">시작일</TableHead>
                    <TableHead className="whitespace-nowrap">계약서</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {Array.from({ length: 6 }).map((_, index) => (
                    <TableRow
                        key={index}
                        data-component="desktop_clients-filtered_page_content_loading_table_row"
                    >
                        <TableCell>
                            <Skeleton className="h-4 w-24 bg-v3-dim-white" />
                        </TableCell>
                        <TableCell>
                            <Skeleton className="h-4 w-20 bg-v3-dim-white" />
                        </TableCell>
                        <TableCell>
                            <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white" />
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

export default function FilteredClientsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const filter = searchParams.get("filter") as FilterType | null;

    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);

    const { data: clients, isLoading, error } = useFilteredClients(filter || "");
    const deleteClient = useDeleteClient();

    const filterConfig = filter ? FILTER_CONFIG[filter] : null;

    const handleClose = () => router.push("/");

    const handleRowClick = (client: Client) => {
        setSelectedClient(client);
        setDetailModalOpen(true);
    };

    const handleEdit = (client: Client) => {
        setEditingClient(client);
        setFormDialogOpen(true);
        setDetailModalOpen(false);
    };

    const handleDeleteRequest = (id: number) => {
        setDeleteTargetClientId(id);
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetClientId === null) return;

        try {
            await deleteClient.mutateAsync(deleteTargetClientId);
            setDetailModalOpen(false);
            setDeleteTargetClientId(null);
        } catch (err) {
            console.error("Failed to delete client:", err);
        }
    };

    if (!filter || !filterConfig) {
        return (
            <div data-component="desktop_clients-filtered_invalid" className="p-6">
                <Alert variant="destructive">잘못된 필터입니다</Alert>
            </div>
        );
    }

    return (
        <section data-component="desktop_clients-filtered_page" className="bg-card min-h-screen">
            {/* Header */}
            <div data-component="desktop_clients-filtered_page_header" className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h1 className="text-lg font-semibold text-foreground">
                    {filterConfig.title}
                </h1>
                <Button variant="ghost" size="icon" onClick={handleClose} aria-label="닫기">
                    <X className="w-6 h-6" />
                </Button>
            </div>

            {/* Content */}
            <div data-component="desktop_clients-filtered_page_content" className="px-4 sm:px-6 py-4">
                {isLoading ? (
                    <div data-component="desktop_clients-filtered_page_content_loading">
                        <FilteredClientsTableSkeleton />
                    </div>
                ) : error ? (
                    <Alert variant="destructive">데이터를 불러오는데 실패했습니다</Alert>
                ) : !clients?.length ? (
                    <Alert variant="info">해당하는 클라이언트가 없습니다</Alert>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="whitespace-nowrap">이름</TableHead>
                                <TableHead className="whitespace-nowrap">시작일</TableHead>
                                <TableHead className="whitespace-nowrap">계약서</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {clients.map((client, index) => (
                                <TableRow
                                    key={client.id}
                                    className="cursor-pointer transition-all duration-200 hover:bg-muted/50 opacity-0 animate-fade-in"
                                    style={{ animationDelay: `${150 + index * 30}ms` }}
                                    onClick={() => handleRowClick(client)}
                                >
                                    <TableCell className="font-medium whitespace-nowrap">
                                        {client.name}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground whitespace-nowrap">
                                        {formatDate(client.startDate)}
                                    </TableCell>
                                    <TableCell>
                                        {getDocumentStatusBadge(client.documentStatus)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            <ClientDetailModal
                open={detailModalOpen}
                onClose={() => setDetailModalOpen(false)}
                client={selectedClient}
                onEdit={handleEdit}
                onDelete={handleDeleteRequest}
            />

            <ClientFormDialog
                data-component="desktop_clients-filtered_form-dialog"
                open={formDialogOpen}
                onClose={() => {
                    setFormDialogOpen(false);
                    setEditingClient(null);
                }}
                client={editingClient}
            />

            <TwoButtonModal
                open={deleteTargetClientId !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTargetClientId(null);
                }}
                data-component="desktop_clients-filtered_delete-approval"
                title="고객을 삭제하시겠습니까?"
                description="삭제한 고객 정보는 복구할 수 없습니다."
                approvalLabel="삭제"
                pendingLabel="삭제 중..."
                approvalVariant="destructive"
                isPending={deleteClient.isPending}
                onApprove={() => void handleDeleteConfirm()}
            />
        </section>
    );
}
