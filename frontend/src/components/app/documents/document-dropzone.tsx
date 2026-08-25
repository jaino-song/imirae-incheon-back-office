"use client";

import { useCallback, useState, useEffect } from "react";
import Image from "next/image";
import { useDocumentCategories } from "@/hooks/use-document-categories";
import { CloudUpload, FileText, X, ImageIcon, File, Loader2, Globe2 } from "lucide-react";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TitleSelectMolecule } from "@/components/ui/title-select-molecule";
import { TitleTextareaMolecule } from "@/components/ui/title-textarea-molecule";
import { TitleTextInputMolecule } from "@/components/ui/title-text-input-molecule";
import { TitleDescChildrenMolecule } from "@/components/app/ui/TitleDescChildrenMolecule";
import { FormSwitchRow } from "@/components/app/ui/form-section";
import {
  TemplateFieldGrid,
  TemplateFieldGridItem,
} from "@/components/app/messages/forms/form-components/TemplateFieldGrid";
import { cn } from "@/lib/utils";
import {
  DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES,
  documentUploadAcceptValue,
  formatFileSizeLimit,
  validateDocumentUploadCandidate,
  type DocumentVisibilityScope,
  type DocumentUploadCapabilities,
} from "@babyjamjam/shared/file-storage";

const HANGUL_DOCUMENT_EXTENSIONS = new Set(["hwp", "hwpx"]);
const MAX_DOCUMENT_TAGS = 50;
const MAX_DOCUMENT_TAG_LENGTH = 100;
const INLINE_PREVIEW_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);
const DOCUMENT_FIELD_LABEL_CLASS_NAME =
  "text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-v3-text-muted";
const DOCUMENT_VISIBILITY_ICON_CLASS_NAME = "h-3.5 w-3.5 shrink-0 text-v3-primary";
const DOCUMENT_VISIBILITY_TEXT_CLASS_NAME = "text-[0.75rem] font-semibold leading-5";
const DOCUMENT_UPLOAD_CARD_CLASS_NAME = "rounded-[20px] bg-v3-dim-white p-5";
const DOCUMENT_TEXTAREA_CLASS_NAME =
  "min-h-[calc(72px*var(--glint-ui-scale,1))] rounded-[16px] border-[1.5px] border-v3-border bg-white px-4 py-3 text-[0.85rem] text-v3-dark shadow-none transition-all focus-visible:border-v3-primary focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)]";
const FILE_FORMAT_LABEL_OVERRIDES: Record<string, string> = {
  jpeg: "JPG",
};

export interface DocumentDropzoneUploadState {
  hasSelectedFile: boolean;
  canSubmit: boolean;
}

interface DocumentDropzoneProps {
  /** Canonical caller-context component id. */
  "data-component"?: string;
  onUpload: (params: {
    file: File;
    name: string;
    description?: string;
    categoryId: string;
    tags: string[];
    visibilityScope: DocumentVisibilityScope;
  }) => Promise<void>;
  isLoading?: boolean;
  uploadProgress?: number;
  formId?: string;
  showInlineSubmitButton?: boolean;
  onUploadStateChange?: (state: DocumentDropzoneUploadState) => void;
  capabilities?: DocumentUploadCapabilities;
}

export function DocumentDropzone({
  "data-component": dataComponent = "desktop_contracts_document-dropzone",
  onUpload,
  isLoading = false,
  uploadProgress = 0,
  formId,
  showInlineSubmitButton = true,
  onUploadStateChange,
  capabilities = DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES,
}: DocumentDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [publishToAllBranches, setPublishToAllBranches] = useState(
    capabilities.uploadVisibilityScope === "all_branches",
  );

  const locale = useLocale();
  const { data: categories = [] } = useDocumentCategories();

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const validateFile = useCallback((file: File): string | null => {
    return validateDocumentUploadCandidate(file, capabilities);
  }, [capabilities]);

  const handleFile = useCallback(
    (file: File) => {
      const error = validateFile(file);
      if (error) {
        setValidationError(error);
        return;
      }

      setValidationError(null);
      setSelectedFile(file);
      setPublishToAllBranches(capabilities.uploadVisibilityScope === "all_branches");

      const fileNameWithoutExt =
        file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
      setName(fileNameWithoutExt);

      if (INLINE_PREVIEW_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      } else {
        setPreviewUrl(null);
      }
    },
    [capabilities.uploadVisibilityScope, validateFile]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isLoading) {
        setIsDragOver(true);
      }
    },
    [isLoading]
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (isLoading) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile, isLoading]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
    setValidationError(null);
    setName("");
    setDescription("");
    setCategory("");
    setTags([]);
    setTagInput("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      const nextTag = tagInput.trim().slice(0, MAX_DOCUMENT_TAG_LENGTH);
      if (!tags.includes(nextTag) && tags.length < MAX_DOCUMENT_TAGS) {
        setTags([...tags, nextTag]);
      }
      setTagInput("");
    }
  };

  const handleDeleteTag = (tagToDelete: string) => {
    setTags(tags.filter((tag) => tag !== tagToDelete));
  };

  const hasSelectedFile = selectedFile !== null;
  const canSubmit = Boolean(selectedFile && name && category && !isLoading);

  useEffect(() => {
    onUploadStateChange?.({
      hasSelectedFile,
      canSubmit,
    });
  }, [canSubmit, hasSelectedFile, onUploadStateChange]);

  const handleSubmit = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!selectedFile || !name || !category || isLoading) return;

    await onUpload({
      file: selectedFile,
      name,
      description: description || undefined,
      categoryId: category,
      tags,
      visibilityScope:
        publishToAllBranches && capabilities.uploadVisibilityScope === "all_branches"
          ? "all_branches"
          : "branch",
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const isSelectedHangulFile = () => {
    const extension = selectedFile?.name.split(".").pop()?.toLowerCase();
    return extension ? HANGUL_DOCUMENT_EXTENSIONS.has(extension) : false;
  };

  const getSelectedFileFormatLabel = () => {
    if (!selectedFile) return "FILE";

    const extensionStart = selectedFile.name.lastIndexOf(".");
    if (extensionStart >= 0 && extensionStart < selectedFile.name.length - 1) {
      const extension = selectedFile.name.slice(extensionStart + 1).toLowerCase();
      return FILE_FORMAT_LABEL_OVERRIDES[extension] ?? extension.toUpperCase();
    }

    const mimeSubtype = selectedFile.type.split("/").at(1);
    if (mimeSubtype) {
      return FILE_FORMAT_LABEL_OVERRIDES[mimeSubtype] ?? mimeSubtype.toUpperCase();
    }

    return "FILE";
  };

  const getSelectedFileTone = () => {
    if (isSelectedHangulFile()) {
      return {
        icon: "bg-v3-primary-light text-v3-primary",
        badge: "border-v3-primary/20 bg-v3-primary-light text-v3-primary",
      };
    }

    if (selectedFile?.type === "application/pdf") {
      return {
        icon: "bg-v3-burgundy-light text-v3-burgundy",
        badge: "border-v3-burgundy/20 bg-v3-burgundy-light text-v3-burgundy",
      };
    }

    if (selectedFile?.type.startsWith("image/")) {
      return {
        icon: "bg-v3-primary-light text-v3-primary",
        badge: "border-v3-primary/20 bg-v3-primary-light text-v3-primary",
      };
    }

    return {
      icon: "bg-v3-dim-white text-v3-text-muted",
      badge: "border-v3-border bg-v3-dim-white text-v3-text-muted",
    };
  };

  const getFileIcon = () => {
    if (isSelectedHangulFile()) {
      return <FileText className="h-10 w-10" />;
    }

    if (selectedFile?.type === "application/pdf") {
      return <FileText className="h-10 w-10" />;
    }
    if (selectedFile?.type.startsWith("image/")) {
      return <ImageIcon className="h-10 w-10" />;
    }
    return <File className="h-10 w-10" />;
  };

  const selectedFileTone = getSelectedFileTone();

  return (
    <div
      data-component={dataComponent}
      data-source-component="DocumentDropzone"
      className="w-full space-y-5"
    >
      {validationError && (
        <Alert
          variant="destructive"
          className="rounded-[18px] border-none bg-v3-burgundy-light px-4 py-3 text-v3-burgundy [&>svg]:text-v3-burgundy"
        >
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      )}

      {!selectedFile ? (
        <label
          data-component={`${dataComponent}_empty`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-4 overflow-hidden rounded-[24px] border-[1.5px] border-dashed px-6 py-8 text-center transition-all duration-200",
            isDragOver
              ? "border-v3-primary bg-white shadow-[0_16px_40px_hsla(214,50%,20%,0.08)]"
              : "border-v3-border bg-white",
            isLoading ? "cursor-wait opacity-70" : "cursor-pointer",
            !isLoading &&
              "hover:border-v3-primary/50 hover:bg-white"
          )}
        >
          <input
            type="file"
            accept={documentUploadAcceptValue(capabilities)}
            onChange={handleFileInputChange}
            disabled={isLoading}
            className="sr-only"
          />

          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-v3-primary shadow-[0_12px_30px_hsla(214,50%,20%,0.10)]">
            <CloudUpload className="h-8 w-8 text-white" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-[1rem] font-bold tracking-[-0.02em] text-v3-dark">
              파일을 끌어다 놓거나 클릭해 선택하세요
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {capabilities.formatGroups.map((group) => (
                <Badge
                  key={group.label}
                  variant="outline"
                  className="border-v3-primary/20 bg-v3-primary-light px-3 py-1 text-[0.68rem] font-semibold text-v3-primary"
                >
                  {group.label} · {group.formats.join(" · ")}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge
              variant="outline"
              className="border-v3-border bg-white/90 px-3 py-1 text-[0.68rem] font-semibold text-v3-text-muted"
            >
              최대 {formatFileSizeLimit(capabilities.maxFileSizeBytes)} · 한 번에 파일 1개
            </Badge>
          </div>
          <p className="max-w-xl text-[0.74rem] leading-5 text-v3-text-muted">
            PDF·이미지·한글은 화면에서 확인할 수 있고, 오피스·압축 파일은 안전하게 내려받아 확인합니다.
          </p>
          <div className="flex items-center gap-2">
            <Globe2 className={DOCUMENT_VISIBILITY_ICON_CLASS_NAME} />
            <span className={`${DOCUMENT_VISIBILITY_TEXT_CLASS_NAME} text-v3-primary`}>
              공개 범위를 업로드 전에 선택할 수 있습니다
            </span>
          </div>
        </label>
      ) : (
        <div className="space-y-5">
          <section className={DOCUMENT_UPLOAD_CARD_CLASS_NAME}>
            <div className="flex items-start gap-4">
              {previewUrl ? (
                <Image
                  src={previewUrl}
                  alt={selectedFile.name}
                  width={88}
                  height={88}
                  unoptimized
                  className="h-[88px] w-[88px] rounded-[18px] border border-v3-border object-cover shadow-sm"
                />
              ) : (
                <div
                  className={cn(
                    "flex h-[88px] w-[88px] items-center justify-center rounded-[18px] border border-v3-border/70",
                    selectedFileTone.icon
                  )}
                >
                  {getFileIcon()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "px-3 py-1 text-[0.68rem] font-semibold",
                      selectedFileTone.badge
                    )}
                  >
                    {getSelectedFileFormatLabel()}
                  </Badge>
                  <span className="text-[0.72rem] font-medium text-v3-text-muted">
                    {formatFileSize(selectedFile.size)}
                  </span>
                </div>
                <p className="mt-3 truncate text-[1rem] font-semibold text-v3-dark">
                  {selectedFile.name}
                </p>
                <p className="mt-1 text-[0.8rem] leading-6 text-v3-text-muted">
                  업로드 전에 문서명, 카테고리, 태그를 정리하면 이후 검색과 관리가 쉬워집니다.
                </p>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={handleRemoveFile}
                disabled={isLoading}
                className="h-10 w-10 shrink-0 rounded-full border-0 bg-transparent p-0 text-v3-text-muted shadow-none hover:bg-transparent hover:text-v3-dark"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </section>

          <form
            id={formId}
            className="contents"
            data-component={`${dataComponent}_upload-form`}
            onSubmit={handleSubmit}
          >
            <TitleDescChildrenMolecule
              title={t(locale, "documents.upload-details-title")}
              description="문서 제목, 카테고리, 태그, 설명을 입력해 업로드 기준 정보를 함께 저장합니다."
              className={DOCUMENT_UPLOAD_CARD_CLASS_NAME}
              bodyClassName="space-y-5"
              data-component={`${dataComponent}_upload-form_details`}
            >
              <TemplateFieldGrid
                dataComponent={`${dataComponent}_upload-form_details_grid`}
                layout="stack"
              >
                <TemplateFieldGridItem dataComponent={`${dataComponent}_upload-form_details_name-field`}>
                  <TitleTextInputMolecule
                    id="doc-name"
                    label="문서 제목"
                    value={name}
                    maxLength={255}
                    onValueChange={setName}
                    disabled={isLoading}
                    required
                    labelClassName={DOCUMENT_FIELD_LABEL_CLASS_NAME}
                    dataComponent={`${dataComponent}_upload-form_details_name-molecule`}
                    inputDataComponent={`${dataComponent}_upload-form_details_name-input`}
                  />
                </TemplateFieldGridItem>

                <TemplateFieldGridItem dataComponent={`${dataComponent}_upload-form_details_category-field`}>
                  <TitleSelectMolecule
                    id="doc-category"
                    label="카테고리"
                    value={category}
                    onValueChange={setCategory}
                    placeholder="카테고리 선택"
                    options={categories.map((option) => ({
                      value: option.id,
                      label: option.label,
                    }))}
                    disabled={isLoading}
                    required
                    labelClassName={DOCUMENT_FIELD_LABEL_CLASS_NAME}
                    dataComponent={`${dataComponent}_upload-form_details_category-molecule`}
                    triggerDataComponent={`${dataComponent}_upload-form_details_category-trigger`}
                    contentDataComponent={`${dataComponent}_upload-form_details_category-options`}
                    optionDataComponent={`${dataComponent}_upload-form_details_category-option`}
                  />
                </TemplateFieldGridItem>

                <TemplateFieldGridItem
                  className="sm:col-span-2"
                  dataComponent={`${dataComponent}_upload-form_details_tags-field`}
                >
                  <TitleTextInputMolecule
                    id="doc-tags"
                    label="태그"
                    value={tagInput}
                    maxLength={MAX_DOCUMENT_TAG_LENGTH}
                    onValueChange={setTagInput}
                    onKeyDown={handleAddTag}
                    placeholder="태그를 입력하고 Enter를 눌러 추가"
                    disabled={isLoading}
                    helperText="검색에 자주 쓰는 키워드를 등록해 두면 문서를 더 빨리 찾을 수 있습니다."
                    helperTextClassName="text-[0.75rem] leading-5 text-v3-text-muted"
                    labelClassName={DOCUMENT_FIELD_LABEL_CLASS_NAME}
                    dataComponent={`${dataComponent}_upload-form_details_tags-molecule`}
                    inputDataComponent={`${dataComponent}_upload-form_details_tags-input`}
                  />
                  {tags.length > 0 && (
                    <div
                      className="flex flex-wrap gap-2"
                      data-component={`${dataComponent}_upload-form_details_tags-list`}
                    >
                      {tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => !isLoading && handleDeleteTag(tag)}
                          data-component={`${dataComponent}_upload-form_details_tags-list_remove`}
                          className="inline-flex items-center gap-1 rounded-full border border-v3-primary/20 bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary transition-colors hover:border-v3-primary/40 hover:bg-v3-primary-light/80"
                        >
                          #{tag}
                          <X className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  )}
                </TemplateFieldGridItem>

                <TemplateFieldGridItem
                  className="sm:col-span-2"
                  dataComponent={`${dataComponent}_upload-form_details_visibility-field`}
                >
                  <FormSwitchRow
                    data-component={`${dataComponent}_upload-form_details_visibility`}
                    copyDataComponent={`${dataComponent}_upload-form_details_visibility-copy`}
                    titleDataComponent={`${dataComponent}_upload-form_details_visibility-title`}
                    descriptionDataComponent={`${dataComponent}_upload-form_details_visibility-description`}
                    buttonDataComponent={`${dataComponent}_upload-form_details_visibility-switch`}
                    thumbDataComponent={`${dataComponent}_upload-form_details_visibility-thumb`}
                    title="모든 지점에 공개"
                    description={
                      publishToAllBranches
                        ? "모든 지점에서 이 파일을 볼 수 있어요"
                        : "현재 지점에서만 이 파일을 볼 수 있어요"
                    }
                    checked={publishToAllBranches}
                    onToggle={() => setPublishToAllBranches((value) => !value)}
                    disabled={isLoading || capabilities.uploadVisibilityScope !== "all_branches"}
                    buttonAriaLabel="모든 지점에 공개"
                  />
                </TemplateFieldGridItem>

                <TemplateFieldGridItem
                  className="sm:col-span-2"
                  dataComponent={`${dataComponent}_upload-form_details_description-field`}
                >
                  <TitleTextareaMolecule
                    id="doc-description"
                  label="설명"
                    value={description}
                    maxLength={2000}
                  onValueChange={setDescription}
                    rows={2}
                  disabled={isLoading}
                    labelClassName={DOCUMENT_FIELD_LABEL_CLASS_NAME}
                    textareaClassName={DOCUMENT_TEXTAREA_CLASS_NAME}
                    dataComponent={`${dataComponent}_upload-form_details_description-molecule`}
                    textareaDataComponent={`${dataComponent}_upload-form_details_description-textarea`}
                  />
                </TemplateFieldGridItem>
              </TemplateFieldGrid>

              {isLoading && (
                <div className="rounded-[18px] bg-v3-dim-white px-4 py-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[0.8rem] font-semibold text-v3-dark">
                      업로드 중...
                    </span>
                    <span className="text-[0.78rem] font-semibold text-v3-primary">
                      {Math.round(uploadProgress)}%
                    </span>
                  </div>
                  <Progress
                    value={uploadProgress}
                    className="h-2.5 bg-v3-primary-light/70"
                  />
                </div>
              )}

              {showInlineSubmitButton && (
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  variant="positive"
                  size="lg"
                  className="w-full"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      업로드 중...
                    </>
                  ) : (
                    <>
                      <CloudUpload className="mr-2 h-5 w-5" />
                      문서 업로드
                    </>
                  )}
                </Button>
              )}
            </TitleDescChildrenMolecule>
          </form>
        </div>
      )}
    </div>
  );
}
