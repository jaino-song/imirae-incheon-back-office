"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { FileImage, FileSpreadsheet, FileText, Image as ImageIcon } from "lucide-react";

import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import {
  useDocuments,
  getDownloadUrl,
  type Document,
} from "@/hooks/use-documents";
import { useDocumentCategories } from "@/hooks/use-document-categories";
import { ListCard, ListItemRow, ListLoadMoreButton, ListLoadMoreSentinel } from "@/components/app/mobile-redesign/primitives";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import {
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailActions,
  MobileDetailHeader,
  MobileDetailPage,
  MobileDetailSheet,
  MobileSearchBar,
  MobileDetailTabPanel,
  type BadgeTone,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

type FileKind = "pdf" | "img" | "doc" | "xls" | "misc";
type DetailTabId = "preview" | "info" | "description" | "tags";

const ALL_FILTER = "전체";

function fileKindFromMime(mime: string): FileKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "img";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.endsWith("csv")) return "xls";
  if (mime.includes("word") || mime.includes("document") || mime.endsWith("text/plain")) return "doc";
  return "misc";
}

function fileExtensionLabel(name: string, mime: string): string {
  const dot = name.lastIndexOf(".");
  if (dot !== -1 && dot < name.length - 1) return name.slice(dot + 1).toUpperCase();
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return mime.replace("image/", "").toUpperCase();
  return mime.split("/").pop()?.toUpperCase() ?? "FILE";
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relativeUploadLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  const isSameYear = d.getFullYear() === new Date().getFullYear();
  if (isSameYear) return `${d.getMonth() + 1}/${d.getDate()}`;
  return formatDateForDisplay(d);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function FileKindIcon({ kind }: { kind: FileKind }) {
  const Icon =
    kind === "img" ? ImageIcon
    : kind === "xls" ? FileSpreadsheet
    : kind === "doc" ? FileText
    : kind === "pdf" ? FileText
    : FileImage;
  return (
    <div className={`file-icon ${kind}`}>
      <Icon size={18} strokeWidth={2.5} />
    </div>
  );
}

function PdfPreviewPage({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="pdf-page">
      <div className={`pdf-page-head ${compact ? "compact" : ""}`}>{children}</div>
    </div>
  );
}

function PdfContractPreview({
  doc,
  categoryLabel,
  sizeLabel,
}: {
  doc: Document;
  categoryLabel: string;
  sizeLabel: string;
}) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [activePage, setActivePage] = useState(0);
  const issuedDate = formatDateForDisplay(doc.createdAt, "2025.05.11");
  const documentCode = `D-${doc.id.slice(0, 8).toUpperCase()}`;
  const baseName = doc.name.replace(/\.[^.]+$/, "");

  const handleScroll = () => {
    const slider = sliderRef.current;
    if (!slider) return;
    setActivePage(Math.round(slider.scrollLeft / slider.clientWidth));
  };

  const scrollToPage = (index: number) => {
    const slider = sliderRef.current;
    if (!slider) return;
    slider.scrollTo({ left: index * slider.clientWidth, behavior: "smooth" });
    setActivePage(index);
  };

  return (
    <div className="info-card pdf-preview-card pop-up" data-component="mobile-files-preview-pdf">
      <span className="zoom-hint">두 손가락으로 확대 · 두 번 탭</span>
      <div className="pdf-slider" ref={sliderRef} onScroll={handleScroll}>
        <PdfPreviewPage>
          <div className="pdf-brand">아가잼잼 인천 아이미래로</div>
          <div className="pdf-title">{categoryLabel} 문서</div>
          <div className="pdf-code">{documentCode}</div>
          <div className="pdf-page-body">
            <div className="pdf-section-title">제1조 (문서 개요)</div>
            <div className="pdf-section-body">
              파일명: {baseName}
              <br />
              분류: {categoryLabel}
              <br />
              등록일: {issuedDate}
            </div>

            <div className="pdf-section-title">제2조 (서비스 내용)</div>
            <div className="pdf-section-body">
              아가잼잼 지점 운영 문서로 보관됩니다.
              <br />
              현장 확인, 계약 관리, 정산 업무에 활용됩니다.
              <br />
              파일 크기: {sizeLabel}
            </div>

            <div className="pdf-section-title">제3조 (관리 정보)</div>
            <div className="pdf-section-body">
              업로더: {doc.uploadedBy || "송진호"}
              <br />
              태그: {doc.tags.length > 0 ? doc.tags.slice(0, 3).join(", ") : "미등록"}
            </div>

            <div className="pdf-sign-row">
              <div>
                <div className="pdf-sign-label">지점</div>
                <div className="pdf-sign-value green">확인 완료</div>
              </div>
              <div>
                <div className="pdf-sign-label">담당자</div>
                <div className="pdf-sign-value green">검토 완료</div>
              </div>
              <div>
                <div className="pdf-sign-label">문서 상태</div>
                <div className="pdf-sign-value orange">보관 중</div>
              </div>
            </div>
          </div>
        </PdfPreviewPage>

        <PdfPreviewPage compact>
          <div className="pdf-code">{documentCode} · 2 / 3</div>
          <div className="pdf-page-body">
            <div className="pdf-section-title">제4조 (보관 및 열람)</div>
            <div className="pdf-section-body">
              ① 본 문서는 권한이 있는 지점 운영자가 열람할 수 있습니다.
              <br />
              ② 공유 링크는 업무 목적에 한해 사용합니다.
              <br />
              ③ 다운로드 기록은 감사 목적으로 관리됩니다.
            </div>

            <div className="pdf-section-title">제5조 (개인정보 보호)</div>
            <div className="pdf-section-body">
              ① 문서 내 개인정보는 서비스 제공 및 운영 목적으로만 처리합니다.
              <br />
              ② 보관 기간 종료 후 내부 정책에 따라 파기합니다.
              <br />
              ③ 열람, 정정, 삭제 요청은 지점 관리자에게 접수합니다.
            </div>

            <div className="pdf-section-title">제6조 (업무 메모)</div>
            <div className="pdf-section-body">
              {doc.description?.trim() || "별도 설명이 등록되지 않았습니다."}
            </div>
          </div>
        </PdfPreviewPage>

        <PdfPreviewPage compact>
          <div className="pdf-code">{documentCode} · 3 / 3 · 부속</div>
          <div className="pdf-page-body">
            <div className="pdf-section-title">[부속] 문서 이력</div>
            <div className="pdf-table">
              <div className="pdf-table-row pdf-table-head">
                <span>항목</span>
                <span>상태</span>
                <span>날짜</span>
              </div>
              <div className="pdf-table-row">
                <span>등록</span>
                <span>완료</span>
                <span>{issuedDate}</span>
              </div>
              <div className="pdf-table-row">
                <span>분류</span>
                <span>{categoryLabel}</span>
                <span>{issuedDate}</span>
              </div>
              <div className="pdf-table-row">
                <span>보관</span>
                <span>진행 중</span>
                <span>현재</span>
              </div>
            </div>

            <div className="pdf-section-title">[안내] 파일 정보</div>
            <div className="pdf-section-body">
              파일 ID: {doc.id}
              <br />
              MIME: {doc.mimeType}
              <br />
              크기: {sizeLabel}
            </div>

            <div className="pdf-final-note">
              본 미리보기는 모바일 확인용 요약 화면입니다.
              <br />
              원본 문서는 다운로드로 확인할 수 있습니다.
            </div>
          </div>
        </PdfPreviewPage>
      </div>
      <div className="pdf-dots" aria-label="PDF 페이지">
        {[0, 1, 2].map((pageIndex) => (
          <button
            key={pageIndex}
            type="button"
            className={`pdf-dot ${activePage === pageIndex ? "active" : ""}`}
            aria-label={`${pageIndex + 1}페이지`}
            aria-pressed={activePage === pageIndex}
            onClick={() => scrollToPage(pageIndex)}
          />
        ))}
      </div>
    </div>
  );
}

function FilePreview({
  doc,
  categoryLabel,
  sizeLabel,
}: {
  doc: Document;
  categoryLabel: string;
  sizeLabel: string;
}) {
  const kind = fileKindFromMime(doc.mimeType);
  const url = getDownloadUrl(doc.id);

  if (kind === "pdf") {
    return <PdfContractPreview doc={doc} categoryLabel={categoryLabel} sizeLabel={sizeLabel} />;
  }
  if (kind === "img") {
    return (
      <div className="info-card pdf-preview-card pop-up" data-component="mobile-files-preview-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={doc.name}
          style={{
            width: "100%",
            borderRadius: 8,
            background: "white",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            display: "block",
          }}
        />
      </div>
    );
  }
  return (
    <InfoCard data-component="mobile_files_detail-panel_info-card" title="미리보기" padded>
      <p
        style={{
          fontSize: "0.82rem",
          color: "hsl(var(--v3-text-muted))",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        이 파일 형식은 브라우저에서 직접 미리볼 수 없습니다.
        <br />
        다운로드 후 확인해주세요.
      </p>
    </InfoCard>
  );
}

function FileDetailContent({
  doc,
  categoryLabel,
  uploaderLabel,
  activeTab,
  onTabChange,
}: {
  doc: Document;
  categoryLabel: string;
  uploaderLabel: string;
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
}) {
  const [actionStatus, setActionStatus] = useState("");
  const kind = fileKindFromMime(doc.mimeType);
  const extLabel = fileExtensionLabel(doc.name, doc.mimeType);
  const sizeLabel = fileSizeLabel(doc.fileSize);

  const badgeToneByKind: Record<FileKind, BadgeTone> = {
    pdf: "burgundy",
    img: "green",
    doc: "primary",
    xls: "green",
    misc: "muted",
  };

  const handleDownload = () => {
    window.open(getDownloadUrl(doc.id, true), "_blank");
    setActionStatus(`${doc.name} 다운로드를 시작했습니다.`);
  };
  const handleShare = async () => {
    const url = `${window.location.origin}${getDownloadUrl(doc.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setActionStatus("공유 링크를 복사했습니다.");
    } catch {
      setActionStatus("공유 링크 복사에 실패했습니다.");
    }
  };

  return (
    <MobileDetailPage data-component="mobile_files_detail-sheet_stack_detail-page" name="files">
      <MobileDetailHeader data-component="mobile_files_detail-sheet_stack_detail-page_header"
        name="files"
        avatar={<FileKindIconLarge kind={kind} />}
        avatarClassName="file-detail-avatar"
        title={doc.name}
        titleStyle={{ fontSize: "0.95rem" }}
        badges={[
          { label: extLabel, tone: badgeToneByKind[kind] },
          { label: categoryLabel, tone: "muted" },
          { label: sizeLabel, tone: "muted" },
        ]}
      />

      <MobileDetailActions data-component="mobile_files_detail-sheet_stack_detail-page_actions"
        name="files"
        actions={[
          {
            label: "공유",
            variant: "secondary",
            onClick: handleShare,
            dataComponent: "mobile-files-share",
          },
          {
            label: "다운로드",
            variant: "primary",
            onClick: handleDownload,
            dataComponent: "mobile-files-download",
          },
        ]}
      />
      {actionStatus && (
        <div className="action-feedback" role="status">
          {actionStatus}
        </div>
      )}

      <DetailTabPills
        tabs={[
          { id: "preview", label: "미리보기" },
          { id: "info", label: "파일 정보" },
          { id: "description", label: "설명" },
          { id: "tags", label: "태그" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <MobileDetailTabPanel data-component="mobile_files_detail-sheet_stack_detail-page_tab-panel" name="files" tabId="preview" activeTab={activeTab}>
        <FilePreview doc={doc} categoryLabel={categoryLabel} sizeLabel={sizeLabel} />
      </MobileDetailTabPanel>

      <MobileDetailTabPanel data-component="mobile_files_detail-sheet_stack_detail-page_tab-panel-2" name="files" tabId="info" activeTab={activeTab}>
        <InfoCard data-component="mobile_files_detail-panel_info-card-2" title="파일 정보">
          <InfoRow label="파일명" value={<span style={{ fontSize: "0.72rem" }}>{doc.name}</span>} />
          <InfoRow label="형식" value={doc.mimeType} />
          <InfoRow label="카테고리" value={categoryLabel} />
          <InfoRow label="크기" value={sizeLabel} />
        </InfoCard>
        <InfoCard data-component="mobile_files_detail-panel_info-card-3" title="관련 정보" delay={60}>
          <InfoRow label="업로더" value={uploaderLabel} />
        </InfoCard>
        <InfoCard data-component="mobile_files_detail-panel_info-card-4" title="날짜" delay={120}>
          <InfoRow label="등록일" value={formatDateTime(doc.createdAt)} />
          <InfoRow label="수정일" value={formatDateTime(doc.updatedAt)} />
        </InfoCard>
      </MobileDetailTabPanel>

      <MobileDetailTabPanel data-component="mobile_files_detail-sheet_stack_detail-page_tab-panel-3" name="files" tabId="description" activeTab={activeTab}>
        <InfoCard data-component="mobile_files_detail-panel_info-card-5" title="설명" padded>
          {doc.description?.trim() ? (
            <div
              style={{
                fontSize: "0.84rem",
                lineHeight: 1.55,
                color: "hsl(var(--v3-dark))",
                whiteSpace: "pre-wrap",
              }}
            >
              {doc.description}
            </div>
          ) : (
            <div
              style={{
                fontSize: "0.82rem",
                color: "hsl(var(--v3-text-muted))",
                lineHeight: 1.55,
              }}
            >
              설명이 없습니다.
            </div>
          )}
        </InfoCard>
      </MobileDetailTabPanel>

      <MobileDetailTabPanel data-component="mobile_files_detail-sheet_stack_detail-page_tab-panel-4" name="files" tabId="tags" activeTab={activeTab}>
        <InfoCard data-component="mobile_files_detail-panel_info-card-6" title="태그">
          {doc.tags.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0" }}>
              {doc.tags.map((tag) => (
                <span key={tag} className="badge-mini muted">
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <div
              style={{
                fontSize: "0.82rem",
                color: "hsl(var(--v3-text-muted))",
                lineHeight: 1.55,
              }}
            >
              태그가 없습니다.
            </div>
          )}
        </InfoCard>
      </MobileDetailTabPanel>
    </MobileDetailPage>
  );
}

function FileKindIconLarge({ kind }: { kind: FileKind }) {
  const Icon =
    kind === "img" ? ImageIcon
    : kind === "xls" ? FileSpreadsheet
    : kind === "doc" ? FileText
    : kind === "pdf" ? FileText
    : FileImage;
  return <Icon size={24} strokeWidth={2.5} />;
}

export default function FilesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabId>("preview");

  const { data: documents = [] } = useDocuments();
  const { data: categories = [] } = useDocumentCategories();

  const categoryLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.label);
    return map;
  }, [categories]);

  const searchFilteredDocs = useMemo<Document[]>(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.trim();
    return documents.filter(
      (d) =>
        matchesKoreanSearch(d.name, q) ||
        (d.description && matchesKoreanSearch(d.description, q)) ||
        d.tags?.some((t) => matchesKoreanSearch(t, q)),
    );
  }, [documents, searchQuery]);

  const groupedAll = useMemo(() => {
    const map = new Map<string, Document[]>();
    for (const doc of searchFilteredDocs) {
      const key = doc.categoryId || "uncategorized";
      const bucket = map.get(key) ?? [];
      bucket.push(doc);
      map.set(key, bucket);
    }
    return map;
  }, [searchFilteredDocs]);

  const filterItems = useMemo(() => {
    const items: Array<{ label: string; count: string }> = [
      { label: ALL_FILTER, count: String(searchFilteredDocs.length) },
    ];
    for (const [categoryId, docs] of groupedAll.entries()) {
      const label = categoryLookup.get(categoryId) ?? "기타";
      items.push({ label, count: String(docs.length) });
    }
    return items;
  }, [groupedAll, searchFilteredDocs.length, categoryLookup]);

  const sectionsFull = useMemo(() => {
    const sections: Array<{ title: string; categoryId: string; fullDocs: Document[]; fullCount: number }> = [];
    for (const [categoryId, docs] of groupedAll.entries()) {
      const label = categoryLookup.get(categoryId) ?? "기타";
      if (activeFilter !== ALL_FILTER && label !== activeFilter) continue;
      const sorted = [...docs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      sections.push({
        title: `${label} · ${docs.length}건`,
        categoryId,
        fullDocs: sorted,
        fullCount: sorted.length,
      });
    }
    sections.sort((a, b) => a.title.localeCompare(b.title));
    return sections;
  }, [groupedAll, categoryLookup, activeFilter]);

  const maxFullCount = useMemo(
    () => sectionsFull.reduce((m, s) => Math.max(m, s.fullCount), 0),
    [sectionsFull],
  );

  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: `${activeFilter}::${searchQuery}`,
      totalItems: maxFullCount,
    });

  const visibleSections = useMemo(
    () =>
      sectionsFull
        .map((s) => ({ ...s, docs: s.fullDocs.slice(0, visibleCount) }))
        .filter((s) => s.docs.length > 0),
    [sectionsFull, visibleCount],
  );

  const selectedCategoryLabel = selectedDoc
    ? categoryLookup.get(selectedDoc.categoryId) ?? "기타"
    : "";

  return (
    <MobileDetailSheet data-component="mobile_files_detail-sheet"
      name="files"
      isOpen={Boolean(selectedDoc)}
      onClose={() => setSelectedDoc(null)}
      list={
        <div className="shell-content" data-component="mobile-files-content">
          <ListCard
            title="파일"
            count={`${documents.length}개`}
            actionLabel="업로드"
            actionHref="/files/upload"
            filters={filterItems}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            scrollRef={scrollContainerRef}
            loadMore={
              isInitialLoad && hasMore ? (
                <ListLoadMoreButton
                  onLoadMore={loadMore}
                  dataComponentPrefix="mobile-files"
                />
              ) : null
            }
            beforeFilters={
              <MobileSearchBar
                placeholder="파일명, 고객명 검색"
                label="files"
                value={searchQuery}
                onChange={setSearchQuery}
              />
            }
          >
            {visibleSections.length === 0 ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "hsl(var(--v3-text-muted))",
                }}
                data-component="mobile-files-empty"
              >
                {searchQuery.trim() || activeFilter !== ALL_FILTER
                  ? "검색 결과가 없습니다."
                  : "등록된 파일이 없습니다."}
              </div>
            ) : (
              <>
              {visibleSections.map((section) => (
                <div className="section-block" key={section.categoryId}>
                  <div className="section-header">{section.title}</div>
                  {section.docs.map((doc, idx) => {
                    const kind = fileKindFromMime(doc.mimeType);
                    const extLabel = fileExtensionLabel(doc.name, doc.mimeType);
                    return (
                      <ListItemRow
                        key={doc.id}
                        dataComponent="mobile-files-row"
                        style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
                        left={<FileKindIcon kind={kind} />}
                        name={doc.name}
                        metaClassName="file-meta"
                        meta={
                          <>
                            {fileSizeLabel(doc.fileSize)}
                            <span className="sep">·</span>
                            {extLabel}
                          </>
                        }
                        right={<span className="dday-sub">{relativeUploadLabel(doc.createdAt)}</span>}
                        onClick={() => {
                          setSelectedDoc(doc);
                          setActiveTab("preview");
                        }}
                      />
                    );
                  })}
                </div>
              ))}
              {!isInitialLoad && hasMore && (
                <ListLoadMoreSentinel
                  sentinelRef={sentinelRef}
                  dataComponentPrefix="mobile-files"
                />
              )}
              </>
            )}
          </ListCard>
        </div>
      }
      detail={
        selectedDoc ? (
          <FileDetailContent
            doc={selectedDoc}
            categoryLabel={selectedCategoryLabel}
            uploaderLabel={selectedDoc.uploadedBy || "-"}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        ) : (
          <div className="detail-body" />
        )
      }
    />
  );
}
