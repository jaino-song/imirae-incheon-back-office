"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useEformsignDocumentsByType } from "@/hooks/useEformsignDocuments";
import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { EformsignDocument, EformsignDocumentView } from "@/lib/eformsign/types";
import {
  DocumentFilterType,
  mapDocStatusLabel,
  getStatusColor,
} from "@/lib/eformsign/status-codes";
import { UNKNOWN_CUSTOMER_NAME, customerName as getEformsignCustomerName } from "@/lib/eformsign/display-name";
import { ContentPaper } from "../root/content-paper";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import Link from "next/link";
import { DataTable, type DataTableColumn, type FilterOption } from "@/components/app/ui/datatable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

type DocumentRow = EformsignDocumentView & Record<string, unknown>;

const STATUS_OPTIONS: FilterOption[] = [
  { label: "전체", value: null, color: getStatusColor("전체") },
  { label: "대기", value: "in-progress", color: getStatusColor("대기") },
  { label: "완료", value: "completed", color: getStatusColor("완료") },
  { label: "기간 만료", value: "expired", color: getStatusColor("기간 만료") },
];

// Customer names to filter out (internal/test accounts)
const EXCLUDED_CUSTOMER_NAMES = ["송진호", "인천 아이미래로"];

// Transform API document to view model
const transformDocument = (doc: EformsignDocument): EformsignDocumentView | null => {
  const customerName = getEformsignCustomerName(doc);

  // Skip documents without a customer name
  if (customerName === UNKNOWN_CUSTOMER_NAME) {
    return null;
  }

  // Skip internal/test accounts
  if (EXCLUDED_CUSTOMER_NAMES.includes(customerName)) {
    return null;
  }

  return {
    doc_id: doc.id,
    customer_name: customerName,
    created_date: doc.created_date,
    status: mapDocStatusLabel(doc.current_status, doc.contract_end_date),
  };
};

// Date formatting helper
const formatDate = (timestamp: number): string => {
  return formatDateForDisplay(timestamp);
};

const EFORMSIGN_LIST_BASE = "mobile_contracts_eformsign-list";

export function DocumentsList() {
  const locale = useLocale();
  const [selectedFilter, setSelectedFilter] = useState<DocumentFilterType>(null);

  // Local document reads only require the app session.
  const { isAuthenticated, isLoading: isLoadingAuth, error: authError } = useEformsignAuth({
    requireAccessToken: false,
  });

  // Documents hook
  const { data, isLoading, error } = useEformsignDocumentsByType(
    isAuthenticated,
    selectedFilter
  );

  const isInitialLoading = isLoadingAuth || isLoading;

  const handleFilterSelect = (filterType: DocumentFilterType) => {
    setSelectedFilter(filterType);
  };

  // All hooks must be called before any conditional returns (React Rules of Hooks)
  const columns = useMemo<DataTableColumn<DocumentRow>[]>(
    () => [
      {
        key: "customer_name",
        header: t(locale, "documents-list.document-title"),
        align: "center",
        width: "35%",
        render: (doc) => doc.customer_name,
      },
      {
        key: "created_date",
        header: t(locale, "documents-list.created-date"),
        align: "center",
        width: "40%",
        render: (doc) => formatDate(doc.created_date),
      },
      {
        key: "status",
        header: t(locale, "documents-list.status"),
        align: "center",
        width: "25%",
        render: (doc) => (
          <Badge variant={getStatusColor(doc.status)} className="min-w-[50px] justify-center">
            {doc.status}
          </Badge>
        ),
      },
    ],
    [locale]
  );

  const documents = useMemo<DocumentRow[]>(() => {
    return (data?.documents || [])
      .map(transformDocument)
      .filter((doc): doc is EformsignDocumentView => doc !== null)
      .map((doc) => doc as DocumentRow);
  }, [data?.documents]);

  // Error state - now after all hooks are called
  if (authError || error) {
    const errorMessage = authError?.message || (error instanceof Error ? error.message : "Unknown error");
    return (
      <div className="p-3">
        <Alert variant="destructive">
          <AlertDescription>
            {authError
              ? "인증에 실패했습니다. 페이지를 새로고침 해주세요."
              : `문서를 불러오는데 실패했습니다: ${errorMessage}`}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <ContentPaper
      title={t(locale, "documents-list.title")}
      subtitle={t(locale, "documents-list.subtitle")}
      className="min-h-[70vh] flex-grow w-full"
    >
      <div data-component={EFORMSIGN_LIST_BASE}>
        <DataTable
          data-component={`${EFORMSIGN_LIST_BASE}_data-table`}
          data={documents}
          columns={columns}
          isLoading={isInitialLoading}
          getRowKey={(doc) => doc.doc_id}
          searchEnabled
          searchFields={["customer_name"]}
          searchPlaceholder="이름 검색"
          filterOptions={STATUS_OPTIONS}
          filterValue={selectedFilter}
          onFilterChange={(value) => handleFilterSelect(value as DocumentFilterType)}
          pagination="client"
          pageSize={5}
          emptyMessage="문서가 없습니다"
          toolbarActions={
            <Button
              className="gap-2 w-[100px]"
              asChild
            >
              <Link href="/contracts/new">
                <Plus className="h-4 w-4" />
                추가
              </Link>
            </Button>
          }
        />
      </div>
    </ContentPaper>
  );
}
