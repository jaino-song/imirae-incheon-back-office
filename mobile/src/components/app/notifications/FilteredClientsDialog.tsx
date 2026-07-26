"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useFilteredClients, useClient, useDeleteClient } from "@/hooks/useClients";
import { Client, DocumentStatus } from "@/lib/client/types";
import { ClientDetailModal } from "../clients/ClientDetailModal";
import { ClientFormDialog } from "../clients/ClientFormDialog";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

type FilterType = "starting-soon" | "ending-soon" | "incomplete-contracts" | "no-contract";

const FILTER_CONFIG: Record<FilterType, { title: string }> = {
    "starting-soon": { title: "7일 내 서비스 시작 예정" },
    "ending-soon": { title: "7일 내 서비스 종료 예정" },
    "incomplete-contracts": { title: "계약서 미완료" },
    "no-contract": { title: "계약서 미발송" },
};

interface FilteredClientsDialogProps {
    open: boolean;
    onClose: () => void;
    filterType: FilterType | null;
    clientId?: number;
}

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

export function FilteredClientsDialog({
    open,
    onClose,
    filterType,
    clientId,
}: FilteredClientsDialogProps) {
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);

    const { data: filteredClients, isLoading: filteredLoading, error: filteredError } =
        useFilteredClients(filterType || "");

    const { data: singleClient, isLoading: singleLoading, error: singleError } =
        useClient(clientId || 0);

    const deleteClient = useDeleteClient();

    const isIndividualClient = !filterType && clientId;
    const clients = isIndividualClient
        ? (singleClient ? [singleClient] : [])
        : (filteredClients || []);
    const isLoading = isIndividualClient ? singleLoading : filteredLoading;
    const error = isIndividualClient ? singleError : filteredError;

    const title = filterType
        ? FILTER_CONFIG[filterType]?.title
        : (singleClient?.name || "클라이언트 상세");

    const handleRowClick = (client: Client) => {
        setSelectedClient(client);
        setDetailModalOpen(true);
    };

    const handleEdit = (client: Client) => {
        setEditingClient(client);
        setFormDialogOpen(true);
        setDetailModalOpen(false);
    };

    const handleDelete = (id: number) => {
        setDeleteTargetClientId(id);
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetClientId === null) return;

        try {
            await deleteClient.mutateAsync(deleteTargetClientId);
            setDeleteTargetClientId(null);
            setDetailModalOpen(false);
            if (isIndividualClient) {
                onClose();
            }
        } catch (err) {
            console.error("Failed to delete client:", err);
            setDeleteTargetClientId(null);
        }
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingClient(null);
    };

    return (
        <>
            <Dialog open={open} onOpenChange={(open: boolean) => !open && onClose()}>
                <DialogContent data-component="mobile_notifications_filtered-clients_dialog" className="max-w-[440px] max-h-[80vh] rounded-2xl border-none bg-white text-foreground shadow-v3 p-0 flex flex-col overflow-hidden">
                    <DialogHeader data-component="mobile_notifications_filtered-clients_dialog_header" className="px-6 pt-6 pb-3 text-center">
                        <DialogTitle className="text-lg md:text-xl font-extrabold text-v3-dark">{title}</DialogTitle>
                        <Button variant="ghost" size="icon" onClick={onClose} className="absolute right-3 top-3 h-8 w-8">
                            <X className="h-5 w-5" />
                        </Button>
                    </DialogHeader>

                    <div data-component="mobile_notifications_filtered-clients_dialog_body" className="overflow-y-auto flex-1">
                        {isLoading ? (
                            <div className="flex justify-center py-16">
                                <Spinner size="default" />
                            </div>
                        ) : error ? (
                            <div className="p-4">
                                <Alert variant="destructive">
                                    <AlertDescription>데이터를 불러오는데 실패했습니다</AlertDescription>
                                </Alert>
                            </div>
                        ) : clients.length === 0 ? (
                            <div className="p-4">
                                <Alert>
                                    <AlertDescription>해당하는 클라이언트가 없습니다</AlertDescription>
                                </Alert>
                            </div>
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
                                            onClick={() => handleRowClick(client)}
                                            className="cursor-pointer transition-all duration-200 hover:bg-muted/50 opacity-0 animate-fade-in"
                                            style={{ animationDelay: `${150 + index * 30}ms` }}
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
                </DialogContent>
            </Dialog>

            <ClientDetailModal
                data-component="mobile_notifications_filtered-clients_dialog_client-detail-modal"
                open={detailModalOpen}
                onClose={() => setDetailModalOpen(false)}
                client={selectedClient}
                onEdit={handleEdit}
                onDelete={handleDelete}
            />

            <ClientFormDialog
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                client={editingClient}
            />

            <ApprovalTwoButtonModal
                open={deleteTargetClientId !== null}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) setDeleteTargetClientId(null);
                }}
                data-component="mobile_notifications_filtered-clients_dialog_delete-approval"
                title="고객을 삭제하시겠습니까?"
                description="삭제한 고객 정보는 복구할 수 없습니다."
                approvalLabel="삭제"
                pendingLabel="삭제 중..."
                approvalVariant="destructive"
                isPending={deleteClient.isPending}
                onApprove={handleDeleteConfirm}
            />
        </>
    );
}
