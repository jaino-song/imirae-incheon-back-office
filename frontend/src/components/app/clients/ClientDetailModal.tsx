"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { formatBirthdayYYMMDD } from "@babyjamjam/shared/utils/birthday";
import { Client, SERVICE_STATUS_OPTIONS, DocumentStatus, type ServiceStatus } from "@/lib/client/types";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import type { Locale } from "@/app/actions/locale";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { formatKoreanPhoneNumber } from "@/lib/phone";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { InfoRow } from "@/components/app/ui/info-row";
import { Badge } from "@/components/ui/badge";
import { APP_DIALOG_FLUSH_CONTENT_CLASS_NAME } from "@/components/ui/app-surface";

interface ClientDetailModalProps {
    open: boolean;
    onClose: () => void;
    client: Client | null;
    onEdit: (client: Client) => void;
    onDelete: (id: number) => void;
}

const getStatusBadge = (status: ServiceStatus | null) => {
    const option = SERVICE_STATUS_OPTIONS.find(o => o.value === status);
    if (!option) return <Badge variant="outline" className="bg-muted text-muted-foreground border-muted">-</Badge>;

    const variantMap: Record<ServiceStatus, "v3-active" | "v3-pending" | "v3-expired" | "outline"> = {
        pre_booking: "outline",
        waiting: "v3-pending",
        replacement_requested: "v3-expired",
        active: "v3-active",
        completed: "outline",
        terminated: "v3-expired",
    };
    
    const variant = status ? variantMap[status] : "outline";
    
    return (
        <Badge variant={variant}>
            {option.label}
        </Badge>
    );
};

const formatDate = (dateStr: string | null): string => {
    return formatDateForDisplay(dateStr);
};

const formatPrice = (price: string | null): string => {
    if (!price) return "-";
    const cleaned = price.replace(/,/g, "");
    const num = parseInt(cleaned, 10);
    if (isNaN(num)) return "-";
    return `${num.toLocaleString("ko-KR")}원`;
};

type NonNullDocumentStatus = Exclude<DocumentStatus, null>;

const getDocStatusBadge = (status: DocumentStatus, locale: Locale) => {
    if (status === null) {
        return <Badge variant="outline" className="text-muted-foreground">{t(locale, "clients.form.doc-not-sent")}</Badge>;
    }

    const labelMap: Record<NonNullDocumentStatus, string> = {
        completed: t(locale, "clients.form.doc-completed"),
        opened: t(locale, "clients.form.doc-opened"),
        created: t(locale, "clients.form.doc-created"),
        requested: t(locale, "clients.form.doc-requested"),
        rejected: t(locale, "clients.form.doc-rejected"),
        revoked: t(locale, "clients.form.doc-revoked"),
        deleted: t(locale, "clients.form.doc-deleted"),
    };

    const label = labelMap[status] || t(locale, "clients.form.doc-not-sent");
    
    const isCompleted = status === "completed";
    const isPending = status === "requested" || status === "opened";
    const isRejected = status === "rejected" || status === "revoked";

    if (isCompleted) return <Badge variant="v3-active">{label}</Badge>;
    if (isPending) return <Badge variant="v3-pending">{label}</Badge>;
    if (isRejected) return <Badge variant="v3-expired">{label}</Badge>;

    return <Badge variant="outline">{label}</Badge>;
};

export function ClientDetailModal({
    open,
    onClose,
    client,
    onEdit,
    onDelete
}: ClientDetailModalProps) {
    const locale = useLocale();

    if (!client) return null;

    const handleEdit = () => {
        onEdit(client);
        onClose();
    };

    const handleDelete = () => {
        onDelete(client.id);
        onClose();
    };

    return (
        <Dialog data-component="desktop_clients-detail_modal" open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className={`max-w-lg bg-white ${APP_DIALOG_FLUSH_CONTENT_CLASS_NAME}`}>
                <DialogHeader data-component="desktop_clients-detail_modal_header" className="p-6 text-center border-b border-border bg-gradient-to-br from-[hsl(214,80%,98%)] to-white relative">
                    <div className="mx-auto w-20 h-20 rounded-[24px] flex items-center justify-center text-2xl font-bold text-white mb-4 shadow-[0_12px_32px_hsla(214,100%,34%,0.3)] bg-gradient-to-br from-[hsl(214,100%,34%)] to-[hsl(214,100%,28%)]">
                        {client.name.charAt(0)}
                    </div>
                    <DialogTitle className="text-xl font-bold text-[hsl(214,40%,18%)] mb-1">
                        {client.name}
                    </DialogTitle>
                    <div className="text-xs text-muted-foreground font-medium mb-4">
                        {client.type || "일반"} · {client.duration}일
                    </div>
                    <div className="flex justify-center">
                         {getStatusBadge(client.serviceStatus)}
                    </div>
                    
                    <DialogDescription className="sr-only">
                        {t(locale, "clients.detail.description")}
                    </DialogDescription>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-4 top-4 h-8 w-8 rounded-full hover:bg-black/5"
                        onClick={onClose}
                    >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Close</span>
                    </Button>
                </DialogHeader>

                <div className="flex gap-2 justify-center p-4 border-b border-border bg-white">
                     <Button variant="ghost" className="flex-1 flex-col h-auto py-3 gap-1 hover:bg-[hsl(214,80%,95%)] hover:text-[hsl(214,100%,34%)] rounded-[14px]">
                        <span className="text-lg">📞</span>
                        <span className="text-[10px] font-semibold">전화</span>
                     </Button>
                     <Button variant="ghost" className="flex-1 flex-col h-auto py-3 gap-1 hover:bg-[hsl(214,80%,95%)] hover:text-[hsl(214,100%,34%)] rounded-[14px]">
                        <span className="text-lg">💬</span>
                        <span className="text-[10px] font-semibold">메시지</span>
                     </Button>
                     <Button variant="ghost" className="flex-1 flex-col h-auto py-3 gap-1 hover:bg-[hsl(214,80%,95%)] hover:text-[hsl(214,100%,34%)] rounded-[14px]">
                        <span className="text-lg">📝</span>
                        <span className="text-[10px] font-semibold">계약</span>
                     </Button>
                </div>

                <div data-component="desktop_clients-detail_modal_content" className="p-6 space-y-6 max-h-[400px] overflow-y-auto">
                    <div>
                        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
                            {t(locale, "clients.form.section-basic")}
                        </h4>
                        <div className="space-y-3">
                            <InfoRow label={t(locale, "clients.form.name")} value={client.name} />
                            <InfoRow label={t(locale, "clients.form.birthday")} value={formatBirthdayYYMMDD(client.birthday ?? "") || "-"} />
                            <InfoRow label={t(locale, "clients.form.due-date")} value={formatDate(client.dueDate)} />
                            <InfoRow label={t(locale, "clients.form.phone")} value={client.phone} />
                            <InfoRow label={t(locale, "clients.form.address")} value={client.address} />
                        </div>
                    </div>

                    <Separator />

                    <div>
                        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
                            {t(locale, "clients.form.section-employee")}
                        </h4>
                        <div className="space-y-3">
                            <InfoRow label={t(locale, "clients.form.primary-employee")} value={client.primaryEmployee?.name ?? "-"} />
                            <InfoRow
                                label={t(locale, "clients.form.primary-employee-phone")}
                                value={client.primaryEmployee?.phone
                                    ? formatKoreanPhoneNumber(client.primaryEmployee.phone)
                                    : "-"}
                            />
                            <InfoRow label={t(locale, "clients.form.secondary-employee")} value={client.secondaryEmployee?.name ?? "-"} />
                            <InfoRow
                                label={t(locale, "clients.form.secondary-employee-phone")}
                                value={client.secondaryEmployee?.phone
                                    ? formatKoreanPhoneNumber(client.secondaryEmployee.phone)
                                    : "-"}
                            />
                        </div>
                    </div>

                    <Separator />

                    <div>
                        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
                            {t(locale, "clients.form.section-service")}
                        </h4>
                         <div className="space-y-3">
                            <InfoRow label={t(locale, "clients.form.voucher-type")} value={client.type} />
                            <InfoRow
                                label={t(locale, "clients.form.duration")}
                                value={client.duration ? `${client.duration}일` : "-"}
                            />
                        </div>
                    </div>

                    <Separator />

                    <div>
                        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
                            {t(locale, "clients.form.section-pricing")}
                        </h4>
                        <div className="space-y-3">
                            <InfoRow label={t(locale, "clients.form.full-price")} value={formatPrice(client.fullPrice)} />
                            <InfoRow label={t(locale, "clients.form.grant")} value={formatPrice(client.grant)} />
                            <InfoRow label={t(locale, "clients.form.actual-price")} value={formatPrice(client.actualPrice)} />
                        </div>
                    </div>

                    <Separator />

                    <div>
                        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
                            {t(locale, "clients.form.section-flags")}
                        </h4>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {client.voucherClient && (
                                <Badge variant="outline">
                                    {t(locale, "clients.form.voucher-client")}
                                </Badge>
                            )}
                            {client.careCenter && (
                                <Badge variant="outline">
                                    {t(locale, "clients.form.care-center")}
                                </Badge>
                            )}
                            {client.breastPump && (
                                <Badge variant="outline">
                                    {t(locale, "clients.form.breast-pump")}
                                </Badge>
                            )}
                            {!client.voucherClient && !client.careCenter && !client.breastPump && (
                                <span className="text-sm text-muted-foreground">-</span>
                            )}
                        </div>
                    </div>

                    <Separator />

                    <div>
                        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
                            {t(locale, "clients.form.section-document")}
                        </h4>
                        <div className="flex items-center justify-between py-2">
                             <span className="text-sm text-muted-foreground">{t(locale, "clients.form.document-status")}</span>
                             {getDocStatusBadge(client.documentStatus, locale)}
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-4 border-t border-border bg-[hsl(214,20%,97%)]">
                    <Button
                        variant="destructive"
                        onClick={handleDelete}
                        className="gap-2 rounded-full"
                    >
                        <Trash2 className="h-4 w-4" />
                        {t(locale, "common.delete")}
                    </Button>
                    <Button
                        onClick={handleEdit}
                        className="gap-2 rounded-full bg-[hsl(214,100%,34%)] hover:bg-[hsl(214,100%,28%)]"
                    >
                        <Pencil className="h-4 w-4" />
                        {t(locale, "common.edit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
