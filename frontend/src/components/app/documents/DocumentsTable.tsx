"use client";

import { useMemo, useState, useEffect } from "react";
import { Plus, Upload, CloudUpload, FileText, Image as ImageIcon, File, Loader2 } from "lucide-react";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { ContentPaper } from "../root/content-paper";
import { DocumentDropzone } from "./document-dropzone";
import { formatDate } from "./document-list";
import DocumentPreviewModal from "./document-preview-modal";
import { DocumentEditModal } from "./document-edit-modal";
import { AddCategoryModal } from "./add-category-modal";
import {
    useDocuments,
    useUploadDocument,
    useUpdateDocument,
    useDeleteDocument,
    Document,
} from "@/hooks/use-documents";
import { useDocumentCategories, useCreateDocumentCategory, DocumentCategory } from "@/hooks/use-document-categories";
import { DataTable, type DataTableColumn } from "@/components/app/ui/datatable";
import type { DocumentVisibilityScope } from "@babyjamjam/shared/file-storage";

const DOCUMENTS_TABLE_UPLOAD_FORM_ID = "documents-table-upload-form";
const EMPTY_UPLOAD_STATE = {
    hasSelectedFile: false,
    canSubmit: false,
};

// Custom hook to detect mobile breakpoint (replaces MUI's useMediaQuery)
function useIsMobile() {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    return isMobile;
}

// Helper to determine if a color is a valid Badge variant name
// These match both Badge component variants and FilterOption color types
const badgeVariants = ["default", "secondary", "destructive", "success", "warning", "info"] as const;
type BadgeVariant = typeof badgeVariants[number];
const isBadgeVariant = (value: string): value is BadgeVariant =>
    (badgeVariants as readonly string[]).includes(value);

// Helper to get contrasting text color for custom hex colors
function getContrastColor(hexColor: string): string {
    const hex = hexColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#000000" : "#ffffff";
}

export function DocumentsTable() {
    const locale = useLocale();
    const isMobile = useIsMobile();

    const [filterCategory, setFilterCategory] = useState<string | null>(null);
    const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
    const [editDoc, setEditDoc] = useState<Document | null>(null);
    const [deleteDoc, setDeleteDoc] = useState<Document | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadDropzoneState, setUploadDropzoneState] = useState(EMPTY_UPLOAD_STATE);

    const { data: documents = [], isLoading, error } = useDocuments(
        filterCategory ?? undefined
    );

    const uploadMutation = useUploadDocument();
    const updateMutation = useUpdateDocument();
    const deleteMutation = useDeleteDocument();

    const { data: categories = [] } = useDocumentCategories();
    const createCategoryMutation = useCreateDocumentCategory();

    const showToast = (message: string, variant: "default" | "destructive") => {
        toast({
            title: variant === "destructive" ? "오류" : "성공",
            description: message,
            variant,
        });
    };

    const handleUpload = async (params: {
        file: File;
        name: string;
        description?: string;
        categoryId: string;
        tags: string[];
        visibilityScope: DocumentVisibilityScope;
    }) => {
        try {
            setUploadProgress(0);
            await uploadMutation.mutateAsync({
                ...params,
                onProgress: (progress) => setUploadProgress(progress),
            });
            setIsUploadOpen(false);
            setUploadDropzoneState(EMPTY_UPLOAD_STATE);
            showToast(t(locale, "documents.upload-success"), "default");
        } catch (err) {
            console.error(err);
            showToast("문서 업로드에 실패했습니다.", "destructive");
        }
    };

    const handleUploadOpenChange = (open: boolean) => {
        if (uploadMutation.isPending) return;

        setIsUploadOpen(open);
        if (!open) {
            setUploadDropzoneState(EMPTY_UPLOAD_STATE);
        }
    };

    const handleUpdate = async (
        id: string,
        params: {
            name?: string;
            description?: string;
            categoryId?: string;
            tags?: string[];
        }
    ) => {
        try {
            await updateMutation.mutateAsync({ id, ...params });
            setEditDoc(null);
            showToast(t(locale, "documents.update-success"), "default");
        } catch (err) {
            console.error(err);
            showToast("문서 수정에 실패했습니다.", "destructive");
        }
    };

    const handleDelete = async () => {
        if (!deleteDoc) return;
        try {
            await deleteMutation.mutateAsync(deleteDoc.id);
            setDeleteDoc(null);
            showToast(t(locale, "documents.delete-success"), "default");
        } catch (err) {
            console.error(err);
            showToast("문서 삭제에 실패했습니다.", "destructive");
        }
    };

    const handleAddCategory = async (category: { value: string; label: string; color: string }) => {
        try {
            await createCategoryMutation.mutateAsync(category);
            setIsAddCategoryOpen(false);
            showToast("태그가 추가되었습니다.", "default");
        } catch (err) {
            console.error(err);
            showToast("태그 추가에 실패했습니다.", "destructive");
        }
    };

    const existingColors = categories.filter((c) => c.isCustom).map((c) => c.color);

    const tableData = useMemo(() => {
        return [...documents]
            .map((doc) => ({
                ...doc,
                tags: doc.tags?.join(" ") ?? "",
                raw: doc,
            }))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [documents]);

    const filterOptions = useMemo(() => {
        return [
            { label: "전체", value: null },
            ...categories.map((category) => ({
                label: category.label,
                value: category.id,
                color: isBadgeVariant(category.color) ? category.color : "default",
            })),
        ];
    }, [categories]);

    const getCategoryLabel = (categoryId: string, items: DocumentCategory[]): string => {
        const category = items.find((c) => c.id === categoryId);
        return category?.label || categoryId;
    };

    const getFileIcon = (mimeType: string) => {
        if (mimeType.includes("pdf")) {
            return <FileText className="h-5 w-5 text-destructive" />;
        }
        if (mimeType.includes("image")) {
            return <ImageIcon className="h-5 w-5 text-info" />;
        }
        return <File className="h-5 w-5 text-muted-foreground" />;
    };

    type DocumentRow = Omit<Document, "tags"> & { tags: string; raw: Document };

    const columns = useMemo<DataTableColumn<DocumentRow>[]>(() => {
        const baseColumns: DataTableColumn<DocumentRow>[] = [
            {
                key: "name",
                header: "문서명",
                align: "center",
                render: (row: DocumentRow) => (
                    <div className="flex items-center gap-2 justify-start pl-4">
                        {getFileIcon(row.raw.mimeType)}
                        <span className="font-medium text-sm">{row.raw.name}</span>
                    </div>
                ),
            },
            {
                key: "createdAt",
                header: "등록일",
                align: "center",
                width: "110px",
                render: (row: DocumentRow) => (
                    <span className="text-sm text-muted-foreground">
                        {formatDate(row.raw.createdAt)}
                    </span>
                ),
            },
        ];

        if (!isMobile) {
            baseColumns.push({
                key: "categoryId",
                header: "카테고리",
                align: "center",
                width: "120px",
                render: (row: DocumentRow) => {
                    const category = categories.find((c) => c.id === row.raw.categoryId);
                    const label = getCategoryLabel(row.raw.categoryId, categories);

                    if (!category) {
                        return (
                            <Badge variant="secondary">{label}</Badge>
                        );
                    }

                    // Use semantic variant if available, otherwise custom style
                    if (isBadgeVariant(category.color)) {
                        return <Badge variant={category.color}>{label}</Badge>;
                    }

                    // Custom hex color
                    return (
                        <Badge
                            className="border-transparent"
                            style={{
                                backgroundColor: category.color,
                                color: getContrastColor(category.color),
                            }}
                        >
                            {label}
                        </Badge>
                    );
                },
            });
        }

        return baseColumns;
    }, [categories, isMobile]);

    if (isLoading) {
        return (
            <ContentPaper
                title={t(locale, "documents.title")}
                subtitle="문서 및 파일을 관리합니다"
                sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
            >
                <div className="flex justify-center items-center min-h-[400px]">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            </ContentPaper>
        );
    }

    if (error) {
        return (
            <ContentPaper
                title={t(locale, "documents.title")}
                subtitle="문서 및 파일을 관리합니다"
                sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
            >
                <Alert variant="destructive">{t(locale, "common.error")}</Alert>
            </ContentPaper>
        );
    }

    return (
        <ContentPaper
            title={t(locale, "documents.title")}
            subtitle="문서 및 파일을 관리합니다"
            sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
        >
            <div data-component="desktop_contracts_documents-table">
                <DataTable
                    data={tableData}
                    columns={columns}
                    isLoading={false}
                    getRowKey={(row: DocumentRow) => row.id}
                    onRowClick={(row: DocumentRow) => setPreviewDoc(row.raw)}
                    searchEnabled
                    searchFields={["name", "description", "tags"]}
                    searchPlaceholder="문서 검색"
                    filterOptions={filterOptions}
                    filterValue={filterCategory}
                    onFilterChange={(value: string | null) => setFilterCategory(value)}
                    filterAddAction={{
                        label: "카테고리 추가",
                        onClick: () => setIsAddCategoryOpen(true),
                    }}
                    pagination="none"
                    emptyMessage="등록된 문서가 없습니다"
                    toolbarActions={(
                        <Button
                            className="gap-2 w-[100px]"
                            onClick={() => setIsUploadOpen(true)}
                        >
                            <Plus className="h-4 w-4" />
                            업로드
                        </Button>
                    )}
                />
            </div>

            {/* Upload Dialog */}
            <Dialog
                open={isUploadOpen}
                onOpenChange={handleUploadOpenChange}
            >
                <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Upload className="h-5 w-5 text-primary" />
                            {t(locale, "documents.upload-title")}
                        </DialogTitle>
                        <DialogDescription className="sr-only">
                            {t(locale, "documents.upload-description")}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-2">
                        <DocumentDropzone
                            formId={DOCUMENTS_TABLE_UPLOAD_FORM_ID}
                            showInlineSubmitButton={false}
                            onUploadStateChange={setUploadDropzoneState}
                            onUpload={handleUpload}
                            isLoading={uploadMutation.isPending}
                            uploadProgress={uploadProgress}
                        />
                    </div>
                    <DialogFooter className="sm:justify-between">
                        <Button
                            variant="outline"
                            onClick={() => handleUploadOpenChange(false)}
                            disabled={uploadMutation.isPending}
                        >
                            {t(locale, "common.cancel")}
                        </Button>
                        {uploadDropzoneState.hasSelectedFile && (
                            <Button
                                type="submit"
                                form={DOCUMENTS_TABLE_UPLOAD_FORM_ID}
                                variant="positive"
                                disabled={!uploadDropzoneState.canSubmit}
                            >
                                {uploadMutation.isPending ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        업로드 중...
                                    </>
                                ) : (
                                    <>
                                        <CloudUpload className="h-4 w-4" />
                                        문서 업로드
                                    </>
                                )}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Preview Modal */}
            <DocumentPreviewModal
                data-component="desktop_contracts_documents-table_preview-dialog"
                open={!!previewDoc}
                onClose={() => setPreviewDoc(null)}
                doc={previewDoc}
                categories={categories}
                onEdit={(doc) => {
                    setEditDoc(doc);
                }}
                onDelete={(doc) => {
                    setPreviewDoc(null);
                    setDeleteDoc(doc);
                }}
            />

            {/* Edit Modal */}
            <DocumentEditModal
                open={!!editDoc}
                onClose={() => setEditDoc(null)}
                doc={editDoc}
                onSave={handleUpdate}
                isLoading={updateMutation.isPending}
            />

            {/* Add Category Modal */}
            <AddCategoryModal
                open={isAddCategoryOpen}
                onClose={() => setIsAddCategoryOpen(false)}
                onAdd={handleAddCategory}
                existingColors={existingColors}
                isLoading={createCategoryMutation.isPending}
            />

            <TwoButtonModal
                open={deleteDoc !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteDoc(null);
                }}
                dataComponent="desktop_contracts_documents-table_delete-approval"
                title={t(locale, "documents.delete-confirm-title")}
                description={t(locale, "documents.delete-confirm-message")}
                isDescriptionVisuallyHidden={false}
                cancelLabel={t(locale, "common.cancel")}
                approvalLabel={t(locale, "common.delete")}
                pendingLabel={t(locale, "common.deleting")}
                approvalVariant="destructive"
                isPending={deleteMutation.isPending}
                onApprove={() => void handleDelete()}
            />
        </ContentPaper>
    );
}
