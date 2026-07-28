"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { APP_DIALOG_FLUSH_CONTENT_CLASS_NAME } from "@/components/ui/app-surface";
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
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { ClientDetailModal } from "../clients/ClientDetailModal";
import { ClientFormDialog } from "../clients/ClientFormDialog";

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

    const handleDeleteRequest = (id: number) => {
        setDeleteTargetClientId(id);
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetClientId === null) return;

        try {
            await deleteClient.mutateAsync(deleteTargetClientId);
            setDetailModalOpen(false);
            setDeleteTargetClientId(null);
            if (isIndividualClient) {
                onClose();
            }
        } catch (err) {
            console.error("Failed to delete client:", err);
        }
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingClient(null);
    };

    return (
        <>
            <Dialog open={open} onOpenChange={(open: boolean) => !open && onClose()}>
                <DialogContent
                    data-component="desktop_admin_filtered-clients-dialog"
                    className={`max-w-lg max-h-[80vh] ${APP_DIALOG_FLUSH_CONTENT_CLASS_NAME}`}
                >
                    <DialogHeader data-component="desktop_admin_filtered-clients-dialog_header" className="px-4 py-3 flex flex-row items-center justify-between border-b">
                        <DialogTitle className="font-semibold">{title}</DialogTitle>
                        <DialogDescription className="sr-only">
                            {title}에 해당하는 클라이언트 목록
                        </DialogDescription>
                        <Button aria-label="Close" variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                            <X className="h-5 w-5" />
                        </Button>
                    </DialogHeader>

                    <div data-component="desktop_admin_filtered-clients-dialog_body" className="overflow-y-auto max-h-[calc(80vh-4rem)]">
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
                open={detailModalOpen}
                onClose={() => setDetailModalOpen(false)}
                client={selectedClient}
                onEdit={handleEdit}
                onDelete={handleDeleteRequest}
            />

            <ClientFormDialog
                data-component="desktop_admin_filtered-clients-dialog_client-form-dialog"
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                client={editingClient}
            />

            <TwoButtonModal
                open={deleteTargetClientId !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTargetClientId(null);
                }}
                dataComponent="desktop_admin_filtered-clients-dialog_delete-approval"
                title="고객을 삭제하시겠습니까?"
                description="삭제한 고객 정보는 복구할 수 없습니다."
                approvalLabel="삭제"
                pendingLabel="삭제 중..."
                approvalVariant="destructive"
                isPending={deleteClient.isPending}
                onApprove={() => void handleDeleteConfirm()}
            />
        </>
    );
}
