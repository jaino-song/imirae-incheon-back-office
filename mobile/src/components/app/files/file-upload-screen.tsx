"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Globe2,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  UploadCloud,
  X,
} from "lucide-react";

import { useDocumentCategories } from "@/hooks/use-document-categories";
import { useDocumentUploadCapabilities, useUploadDocument } from "@/hooks/use-documents";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES,
  documentUploadAcceptValue,
  formatFileSizeLimit,
  validateDocumentUploadCandidate,
} from "@babyjamjam/shared/file-storage";

import styles from "./file-upload-screen.module.css";

const MAX_DOCUMENT_TAGS = 50;
const MAX_DOCUMENT_TAG_LENGTH = 100;
type UploadCategoryKind = "image" | "sheet" | "pdf" | "file";

interface UploadCategory {
  id: string;
  label: string;
  kind: UploadCategoryKind;
}

function extensionLabel(fileName: string, mimeType: string): string {
  const ext = fileName.split(".").pop();
  if (ext) return ext.toUpperCase();
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return mimeType.replace("image/", "").toUpperCase();
  return "FILE";
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileSizeCompactLabel(bytes: number): string {
  return fileSizeLabel(bytes).replace(" ", "");
}

function filenameWithoutExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function parseCustomerName(fileName: string): string {
  const baseName = filenameWithoutExtension(fileName);
  const [firstSegment] = baseName.split("_");
  return firstSegment?.trim() ?? "";
}

function inferTags(fileName: string, categoryLabel: string): string[] {
  const baseName = filenameWithoutExtension(fileName);
  const segments = baseName.split("_").map((segment) => segment.trim()).filter(Boolean);
  const nonCategorySegments = segments.filter((segment) => segment !== categoryLabel);
  const [customerSegment, ...detailSegments] = nonCategorySegments;
  const tags = [categoryLabel, ...detailSegments, customerSegment].filter((tag): tag is string => Boolean(tag));
  return Array.from(new Set(tags)).slice(0, 3);
}

function categoryKind(label: string): UploadCategoryKind {
  if (label.includes("사진") || label.includes("이미지")) return "image";
  if (label.includes("견적") || label.includes("정산")) return "sheet";
  if (label.includes("계약") || label.includes("문서")) return "pdf";
  return "file";
}

function CategoryIcon({ kind }: { kind: UploadCategory["kind"] }) {
  const Icon =
    kind === "image" ? ImageIcon :
    kind === "sheet" ? FileSpreadsheet :
    kind === "pdf" ? FileText :
    FileIcon;

  return <Icon size={14} strokeWidth={2.5} />;
}

export function FileUploadScreen() {
  const router = useRouter();
  const { isNavigationPending, startNavigation } = useNavigationPending();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadDocument();
  const { data: capabilities = DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES } = useDocumentUploadCapabilities();
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [relatedCustomer, setRelatedCustomer] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [publishToAllBranches, setPublishToAllBranches] = useState(
    capabilities.uploadVisibilityScope === "all_branches",
  );

  const { data: fetchedCategories = [] } = useDocumentCategories();

  const categories = useMemo<UploadCategory[]>(() => {
    return fetchedCategories.map((category) => ({
      id: category.id,
      label: category.label,
      kind: categoryKind(category.label),
    }));
  }, [fetchedCategories]);

  const selectedCategory = useMemo(
    () =>
      categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null,
    [categories, selectedCategoryId]
  );
  const isUploading = uploadMutation.isPending || isNavigationPending;
  const progress = isUploading ? Math.round(uploadProgress) : 0;
  const uploadedBytes = selectedFile ? Math.round((selectedFile.size * progress) / 100) : 0;
  const handleExit = () => {
    if (isUploading) return;
    router.push("/files");
  };

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

      const nextName = filenameWithoutExtension(file.name);
      const nextCustomer = parseCustomerName(file.name);
      const nextCategory = selectedCategory ?? categories[0];

      setSelectedFile(file);
      setValidationError(null);
      setUploadProgress(0);
      setName(nextName);
      setRelatedCustomer(nextCustomer);
      setDescription("");
      setTags(nextCategory ? inferTags(file.name, nextCategory.label) : []);
      setPublishToAllBranches(capabilities.uploadVisibilityScope === "all_branches");
    },
    [capabilities.uploadVisibilityScope, categories, selectedCategory, validateFile]
  );

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setValidationError(null);
    setName("");
    setRelatedCustomer("");
    setDescription("");
    setTags([]);
    setTagInput("");
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "Enter" || event.key === ",") && tagInput.trim()) {
      event.preventDefault();
      const nextTag = tagInput.trim().slice(0, MAX_DOCUMENT_TAG_LENGTH);
      setTags((currentTags) => Array.from(new Set([...currentTags, nextTag])).slice(0, MAX_DOCUMENT_TAGS));
      setTagInput("");
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile || !name.trim() || !selectedCategory) return;

    try {
      setUploadProgress(0);
      await uploadMutation.mutateAsync({
        file: selectedFile,
        name: name.trim(),
        description: description.trim() || undefined,
        categoryId: selectedCategory.id,
        tags: Array.from(new Set([...tags, relatedCustomer.trim()].filter(Boolean))).slice(0, MAX_DOCUMENT_TAGS),
        visibilityScope: publishToAllBranches && capabilities.uploadVisibilityScope === "all_branches"
          ? "all_branches"
          : "branch",
        onProgress: setUploadProgress,
      });
      toast({ description: "문서를 업로드했어요", variant: "success" });
      startNavigation();
      router.push("/files");
    } catch {
      toast({ description: "문서를 업로드하지 못했어요", variant: "destructive" });
    }
  };

  return (
    <section
      data-component="mobile_files-upload_screen_root"
      data-source-component="FileUploadScreen"
      data-slot="files-upload-page-shell"
      className={styles.page}
    >
      <header data-component="mobile_files-upload_screen_root_header" className={styles.detailHeader}>
        <button
          type="button"
          className={styles.detailBack}
          onClick={handleExit}
          disabled={isUploading}
        >
          <ChevronLeft size={22} strokeWidth={2.5} />
          <span>파일</span>
        </button>
        <div data-component="mobile_files-upload_screen_root_header_title" className={styles.detailTitle}>파일 업로드</div>
      </header>

      <main data-component="mobile_files-upload_screen_root_scroll" className={styles.uploadScroll}>
        {validationError && (
          <div data-component="mobile_files-upload_screen_root_scroll_validation-error" className={styles.validationError} role="alert">
            {validationError}
          </div>
        )}

        <div
          data-component="mobile_files-upload_screen_root_scroll_visibility-hint"
          className={styles.visibilityNotice}
        >
          <Globe2 size={14} strokeWidth={2.5} />
          공개 범위를 업로드 전에 선택할 수 있습니다
        </div>

        <div
          data-component="mobile_files-upload_screen_root_scroll_dropzone"
          role="button"
          tabIndex={0}
          className={`${styles.dropzone} ${selectedFile ? styles.hasFile : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={documentUploadAcceptValue(capabilities)}
            className={styles.fileInput}
            onChange={handleFileInputChange}
            disabled={isUploading}
          />

          {selectedFile ? (
            <>
              <div data-component="mobile_files-upload_screen_root_scroll_dropzone_file-preview" className={styles.filePreview}>
                <div
                  data-component="mobile_files-upload_screen_root_scroll_dropzone_file-preview_icon"
                  className={`${styles.filePreviewIcon} ${selectedFile.type.startsWith("image/") ? styles.imageFile : styles.pdfFile}`}
                >
                  {selectedFile.type.startsWith("image/") ? (
                    <ImageIcon size={24} strokeWidth={2.5} />
                  ) : (
                    <FileText size={24} strokeWidth={2.5} />
                  )}
                </div>
                <div data-component="mobile_files-upload_screen_root_scroll_dropzone_file-preview_info" className={styles.filePreviewInfo}>
                  <div data-component="mobile_files-upload_screen_root_scroll_dropzone_file-preview_info_name" className={styles.filePreviewName}>{selectedFile.name}</div>
                  <div data-component="mobile_files-upload_screen_root_scroll_dropzone_file-preview_info_meta" className={styles.filePreviewMeta}>
                    {fileSizeLabel(selectedFile.size)} · {extensionLabel(selectedFile.name, selectedFile.type)}
                  </div>
                </div>
                <span
                  className={styles.filePreviewRemove}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemoveFile();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      handleRemoveFile();
                    }
                  }}
                  aria-label="선택한 파일 삭제"
                >
                  <X size={14} strokeWidth={2.5} />
                </span>
              </div>
              <div data-component="mobile_files-upload_screen_root_scroll_dropzone_progress" className={styles.uploadProgress} aria-hidden="true">
                <div data-component="mobile_files-upload_screen_root_scroll_dropzone_progress_bar" className={styles.uploadProgressBar} style={{ width: `${progress}%` }} />
              </div>
              <div data-component="mobile_files-upload_screen_root_scroll_dropzone_progress-meta" className={styles.uploadProgressMeta}>
                <span>{uploadMutation.isPending ? "업로드 중..." : "업로드 준비됨"}</span>
                <span>
                  {fileSizeCompactLabel(uploadedBytes)} / {fileSizeCompactLabel(selectedFile.size)} · {progress}%
                </span>
              </div>
            </>
          ) : (
            <>
              <div data-component="mobile_files-upload_screen_root_scroll_dropzone_empty-icon" className={styles.dropzoneIcon}>
                <UploadCloud size={22} strokeWidth={2.5} />
              </div>
              <div data-component="mobile_files-upload_screen_root_scroll_dropzone_empty-title" className={styles.dropzoneTitle}>파일을 선택하거나 끌어다 놓으세요</div>
              <div data-component="mobile_files-upload_screen_root_scroll_dropzone_empty-subtitle" className={styles.dropzoneSub}>
                <b>탭하여 파일 선택</b> · 최대 {formatFileSizeLimit(capabilities.maxFileSizeBytes)} · 파일 1개
                <br />
                {capabilities.formatGroups.map((group) => `${group.label}: ${group.formats.join("·")}`).join(" / ")}
              </div>
            </>
          )}
        </div>

        <section data-component="mobile_files-upload_screen_root_scroll_category-card" className={styles.formCard}>
          <div data-component="mobile_files-upload_screen_root_scroll_category-card_row" className={styles.formRow}>
            <label className={styles.formLabel}>
              카테고리 <span className={styles.required}>*</span>
            </label>
            <div data-component="mobile_files-upload_screen_root_scroll_category-card_row_grid" className={styles.categoryGrid}>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`${styles.categoryChip} ${selectedCategory?.id === category.id ? styles.selected : ""}`}
                  onClick={() => {
                    setSelectedCategoryId(category.id);
                    if (selectedFile) {
                      setTags(inferTags(selectedFile.name, category.label));
                    }
                  }}
                >
                  <span className={`${styles.categoryChipIcon} ${styles[category.kind]}`}>
                    <CategoryIcon kind={category.kind} />
                  </span>
                  {category.label}
                </button>
              ))}
              {categories.length === 0 && (
                <div
                  data-component="mobile_files-upload_screen_root_scroll_category-card_row_grid_empty"
                  className={styles.formHelper}
                >
                  업로드하려면 먼저 파일 카테고리를 등록해 주세요.
                </div>
              )}
            </div>
          </div>
        </section>

        <section data-component="mobile_files-upload_screen_root_scroll_metadata-card" className={styles.formCard}>
          <div
            data-component="mobile_files-upload_screen_root_scroll_metadata-card_visibility-row"
            className={styles.switchRow}
          >
            <div data-component="mobile_files-upload_screen_root_scroll_metadata-card_visibility-row_copy">
              <strong data-component="mobile_files-upload_screen_root_scroll_metadata-card_visibility-row_title" className={styles.switchTitle}>
                모든 지점에 공개
              </strong>
              <span data-component="mobile_files-upload_screen_root_scroll_metadata-card_visibility-row_description" className={styles.switchDescription}>
                {publishToAllBranches ? "모든 지점에서 이 파일을 볼 수 있어요" : "현재 지점에서만 이 파일을 볼 수 있어요"}
              </span>
            </div>
            <Switch
              data-component="mobile_files-upload_screen_root_scroll_metadata-card_visibility-row_switch"
              thumbDataComponent="mobile_files-upload_screen_root_scroll_metadata-card_visibility-row_switch-thumb"
              checked={publishToAllBranches}
              onCheckedChange={setPublishToAllBranches}
              aria-label="모든 지점에 공개"
              disabled={isUploading || capabilities.uploadVisibilityScope !== "all_branches"}
            />
          </div>
          <div data-component="mobile_files-upload_screen_root_scroll_metadata-card_customer-row" className={styles.formRow}>
            <label htmlFor="related-customer" className={styles.formLabel}>
              관련 고객
            </label>
            <input
              id="related-customer"
              className={`${styles.formInput} ${relatedCustomer ? styles.filled : ""}`}
              value={relatedCustomer}
              maxLength={MAX_DOCUMENT_TAG_LENGTH}
              onChange={(event) => setRelatedCustomer(event.target.value)}
              placeholder="고객 이름 검색 (선택)"
            />
            <div data-component="mobile_files-upload_screen_root_scroll_metadata-card_customer-row_helper" className={styles.formHelper}>고객 이름을 태그로 저장해 파일 검색에 활용합니다.</div>
          </div>
          <div data-component="mobile_files-upload_screen_root_scroll_metadata-card_name-row" className={styles.formRow}>
            <label htmlFor="file-name" className={styles.formLabel}>
              파일명
            </label>
            <input
              id="file-name"
              className={`${styles.formInput} ${name ? styles.filled : ""}`}
              value={name}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
              placeholder="파일명을 입력하세요"
            />
            <div data-component="mobile_files-upload_screen_root_scroll_metadata-card_name-row_helper" className={styles.formHelper}>확장자는 자동으로 추가됩니다.</div>
          </div>
        </section>

        <section data-component="mobile_files-upload_screen_root_scroll_description-card" className={styles.formCard}>
          <div data-component="mobile_files-upload_screen_root_scroll_description-card_row" className={styles.formRow}>
            <label htmlFor="file-description" className={styles.formLabel}>
              설명
            </label>
            <textarea
              id="file-description"
              className={styles.formTextarea}
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="파일에 대한 간단한 설명 (선택)"
            />
          </div>
        </section>

        <section data-component="mobile_files-upload_screen_root_scroll_tags-card" className={styles.formCard}>
          <div data-component="mobile_files-upload_screen_root_scroll_tags-card_row" className={styles.formRow}>
            <label htmlFor="file-tags" className={styles.formLabel}>
              태그
            </label>
            <div data-component="mobile_files-upload_screen_root_scroll_tags-card_row_input-wrap" className={styles.tagInputWrap}>
              {tags.map((tag) => (
                <span key={tag} className={styles.tagChip}>
                  {tag}
                  <button
                    type="button"
                    className={styles.tagChipX}
                    onClick={() => setTags((currentTags) => currentTags.filter((currentTag) => currentTag !== tag))}
                    aria-label={`${tag} 태그 삭제`}
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
              <input
                id="file-tags"
                className={styles.tagInput}
                value={tagInput}
                maxLength={MAX_DOCUMENT_TAG_LENGTH}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="태그 추가..."
              />
            </div>
            <div data-component="mobile_files-upload_screen_root_scroll_tags-card_row_helper" className={styles.formHelper}>엔터 또는 쉼표로 태그를 추가하세요.</div>
          </div>
        </section>
      </main>

      <footer data-component="mobile_files-upload_screen_root_actions" className={styles.uploadActions}>
        <button
          type="button"
          className={`${styles.uploadBtn} ${styles.secondary}`}
          onClick={handleExit}
          disabled={isUploading}
        >
          취소
        </button>
        <button
          type="button"
          className={`${styles.uploadBtn} ${styles.primary}`}
          disabled={!selectedFile || !name.trim() || !selectedCategory || isUploading}
          onClick={handleSubmit}
        >
          {isUploading ? "업로드 중..." : "업로드 완료"}
        </button>
      </footer>
    </section>
  );
}
