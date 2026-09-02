import type { Page } from "@playwright/test";

import {
  getStatusCategory,
  isDeletedStatusCode,
  isProviderReviewWorkflowStep,
} from "../../src/lib/eformsign/status-codes";

export const DEFAULT_SERVICE_RECORD_TEMPLATE_IDS = [
  "service-record-template",
  "service-record-template-10",
  "service-record-template-15",
  "service-record-template-20",
] as const;
const DEFAULT_SERVICE_RECORD_TEMPLATE_ID = DEFAULT_SERVICE_RECORD_TEMPLATE_IDS[0];
const DEFAULT_FIRST_PAGE_LIMIT = 9;
const DEFAULT_SKIP = 0;
const SNAPSHOT_VERSION = "e2e-contracts-snapshot";

const LIST_ROUTE = /\/api\/eformsign\/documents(?:\?.*)?$/;
const STATUS_COUNTS_ROUTE = /\/api\/eformsign\/documents\/status-counts(?:\?.*)?$/;
const SERVICE_RECORD_TEMPLATE_ROUTE = /\/api\/eformsign-docs\/feedback-template-id(?:\?.*)?$/;
const CHOSUNG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;
type Chosung = (typeof CHOSUNG)[number];

const CUSTOMER_NAME_KEYS = [
  "이용자성명",
  "고객성명",
  "고객명",
  "산모성명",
  "산모명",
  "성명",
  "customername",
  "clientname",
  "username",
] as const;

type ContractStatusCategory = "drafting" | "in-progress" | "completed" | "expired" | "unknown";

interface ContractMockRecipient {
  recipient_type?: string | null;
  name?: string | null;
}

interface ContractMockStatus {
  status_type?: string | null;
  step_type?: string | null;
  step_name?: string | null;
  step_recipients?: ContractMockRecipient[];
  [key: string]: unknown;
}

export interface ContractMockDocument {
  id: string;
  document_number?: string;
  document_name?: string;
  template?: {
    id?: string;
    name?: string;
    [key: string]: unknown;
  };
  detail_template_info?: {
    id?: string;
    [key: string]: unknown;
  };
  template_id?: string;
  created_date?: number | string;
  current_status?: ContractMockStatus;
  [key: string]: unknown;
}

export interface ContractListRequest {
  limit: number;
  skip: number;
  statusCategory: string | null;
  search: string;
  /**
   * Server-resolved section filter. Since 8601e809b the app sends ONLY this and the
   * backend resolves the template whitelist itself, so templateId/templateMatch below
   * are absent on every request the contracts page makes. They stay parsed for direct
   * callers and for the pre-8601e809b shape.
   */
  section: string | null;
  templateId: string | null;
  templateMatch: "include" | "exclude";
  excludeDeleted: boolean;
  url: URL;
}

export interface RouteContractsApiOptions {
  getDocuments: () => readonly ContractMockDocument[];
  templateId?: string;
  templateIds?: readonly string[];
  omitTemplateIds?: boolean;
  serviceRecordTemplateStatus?: number;
  listStatus?: number;
  statusCountsStatus?: number;
  beforeListResponse?: (request: ContractListRequest) => Promise<void> | void;
  onListRequest?: (request: ContractListRequest) => Promise<void> | void;
  onStatusCountsRequest?: (request: ContractListRequest) => Promise<void> | void;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseListRequest(url: URL): ContractListRequest {
  const { searchParams } = url;
  return {
    limit: parsePositiveInteger(searchParams.get("limit"), DEFAULT_FIRST_PAGE_LIMIT),
    skip: parsePositiveInteger(searchParams.get("skip"), DEFAULT_SKIP),
    statusCategory: searchParams.get("statusCategory"),
    search: searchParams.get("search")?.trim() ?? "",
    section: searchParams.get("section"),
    templateId: searchParams.get("templateId"),
    templateMatch: searchParams.get("templateMatch") === "exclude" ? "exclude" : "include",
    excludeDeleted: searchParams.get("excludeDeleted") === "true",
    url,
  };
}

function getTemplateId(document: ContractMockDocument): string | null {
  return document.template?.id ?? document.detail_template_info?.id ?? document.template_id ?? null;
}

function getContractStatusCategory(document: ContractMockDocument): ContractStatusCategory {
  const baseCategory = getStatusCategory(document.current_status?.status_type);
  if (baseCategory !== "in-progress") {
    return baseCategory;
  }

  return isProviderReviewWorkflowStep(document.current_status) ? "in-progress" : "drafting";
}

function normalizeCustomerNameKey(value: string): string {
  return value.replace(/[\s_.-]/g, "").toLocaleLowerCase("ko-KR");
}

function isCustomerNameKey(value: string): boolean {
  const normalized = normalizeCustomerNameKey(value);
  return CUSTOMER_NAME_KEYS.some((key) => normalized === key || normalized.includes(key));
}

function collectCustomerNames(value: unknown, results: string[]): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCustomerNames(item, results);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const identifier = [
    record.id,
    record.field_id,
    record.fieldId,
    record.name,
    record.label,
    record.field_name,
    record.fieldName,
  ].find((candidate): candidate is string => typeof candidate === "string");
  if (identifier && isCustomerNameKey(identifier)) {
    const fieldValue = [
      record.value,
      record.field_value,
      record.fieldValue,
      record.input_value,
      record.inputValue,
      record.data,
      record.text,
    ].find((candidate): candidate is string | number =>
      typeof candidate === "string" || typeof candidate === "number",
    );
    if (fieldValue !== undefined) {
      results.push(String(fieldValue));
    }
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (
      isCustomerNameKey(key)
      && (typeof nestedValue === "string" || typeof nestedValue === "number")
    ) {
      results.push(String(nestedValue));
    }
    collectCustomerNames(nestedValue, results);
  }
}

function getChosung(character: string): string {
  const code = character.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return CHOSUNG[Math.floor((code - 0xac00) / 588)] ?? character;
  }
  return character;
}

function matchesKoreanSearch(value: string, search: string): boolean {
  const normalizedValue = value.normalize("NFC");
  const normalizedSearch = search.normalize("NFC");
  if (
    normalizedValue
      .toLocaleLowerCase("ko-KR")
      .includes(normalizedSearch.toLocaleLowerCase("ko-KR"))
  ) {
    return true;
  }
  const hasChosung = normalizedSearch
    .split("")
    .some((character) => CHOSUNG.includes(character as Chosung));
  if (!hasChosung) {
    return false;
  }

  return normalizedValue
    .split("")
    .map(getChosung)
    .join("")
    .replace(/\s/g, "")
    .startsWith(normalizedSearch);
}

function matchesSearch(document: ContractMockDocument, search: string): boolean {
  if (!search) {
    return true;
  }

  const customerNames: string[] = [];
  collectCustomerNames(document.fields, customerNames);
  collectCustomerNames(document.detail_template_info, customerNames);
  const stepRecipientNames =
    document.current_status?.step_recipients
      ?.map((recipient) => recipient.name)
      .filter((name): name is string => Boolean(name)) ?? [];
  const templateName = (document.template?.name ?? "").replace(/\s*계약서$/, "");
  const documentNumber = document.document_number ?? document.id.slice(0, 16);
  const values = [
    ...customerNames,
    ...stepRecipientNames,
    document.document_name ?? "",
    templateName,
    documentNumber,
  ];

  return values.some((value) => matchesKoreanSearch(value, search));
}

function createdDateValue(document: ContractMockDocument): number {
  if (typeof document.created_date === "number") {
    return document.created_date;
  }
  if (typeof document.created_date === "string") {
    const parsed = Date.parse(document.created_date);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Resolves the template filter the way the backend does, because in these tests this
 * mock IS the backend: `section` wins over any client-supplied templateId, and the
 * tier ids are server configuration rather than something the request carries.
 *
 * `maternity` excludes the tier set rather than including an area_template whitelist.
 * That is EformsignTemplateScopeService's documented degrade branch, taken when the
 * branch has no registered contract templates — which is the state a mock without an
 * area registry is in, and the one the fixtures here are written against.
 */
function resolveTemplateFilter(
  request: ContractListRequest,
  serviceRecordTemplateIds: readonly string[],
): { ids: Set<string>; match: "include" | "exclude" } {
  if (request.section === "maternity") {
    return { ids: new Set(serviceRecordTemplateIds), match: "exclude" };
  }
  if (request.section === "service-records") {
    return { ids: new Set(serviceRecordTemplateIds), match: "include" };
  }
  return {
    ids: new Set(
      request.templateId
        ?.split(",")
        .map((id) => id.trim())
        .filter(Boolean) ?? [],
    ),
    match: request.templateMatch,
  };
}

export function filterContractDocuments(
  documents: readonly ContractMockDocument[],
  searchParams: URLSearchParams,
  serviceRecordTemplateIds: readonly string[] = DEFAULT_SERVICE_RECORD_TEMPLATE_IDS,
): ContractMockDocument[] {
  const request = parseListRequest(new URL(`http://contracts.test/?${searchParams.toString()}`));
  const { ids: templateIds, match: templateMatch } = resolveTemplateFilter(
    request,
    serviceRecordTemplateIds,
  );

  return documents
    .filter((document) => {
      if (templateIds.size === 0) {
        return true;
      }
      const matchesTemplate = templateIds.has(getTemplateId(document) ?? "");
      return templateMatch === "include" ? matchesTemplate : !matchesTemplate;
    })
    .filter(
      (document) =>
        !request.excludeDeleted || !isDeletedStatusCode(document.current_status?.status_type),
    )
    .filter((document) => {
      if (!request.statusCategory) {
        return true;
      }
      if (isDeletedStatusCode(document.current_status?.status_type)) {
        return false;
      }
      return getContractStatusCategory(document) === request.statusCategory;
    })
    .filter((document) => matchesSearch(document, request.search))
    .sort(
      (left, right) =>
        createdDateValue(right) - createdDateValue(left)
        || left.id.localeCompare(right.id),
    );
}

function toStatusSignal(document: ContractMockDocument) {
  const status = document.current_status;
  return {
    status_type: status?.status_type ?? null,
    step_type: status?.step_type ?? null,
    step_name: status?.step_name ?? null,
    step_recipient_types: status?.step_recipients?.map(
      (recipient) => recipient.recipient_type ?? null,
    ) ?? [],
  };
}

export async function routeContractsApi(
  page: Page,
  {
    getDocuments,
    templateId = DEFAULT_SERVICE_RECORD_TEMPLATE_ID,
    // 앱은 templateIds를 우선하므로 templateId만 오버라이드한 스펙에서
    // 기본 4개 목록이 남아 오버라이드가 무시되는 일이 없도록 파생시킨다.
    templateIds = templateId === DEFAULT_SERVICE_RECORD_TEMPLATE_ID
      ? DEFAULT_SERVICE_RECORD_TEMPLATE_IDS
      : [templateId],
    omitTemplateIds = false,
    serviceRecordTemplateStatus = 200,
    listStatus = 200,
    statusCountsStatus = 200,
    beforeListResponse,
    onListRequest,
    onStatusCountsRequest,
  }: RouteContractsApiOptions,
): Promise<void> {
  // The tier list is backend configuration, not part of the feedback-template-id
  // response — `omitTemplateIds` only hides it from the CLIENT. A single-tier
  // installation is one where the server itself knows one id, so that is what the
  // section filter above resolves against.
  const configuredServiceRecordTemplateIds = omitTemplateIds ? [templateId] : templateIds;

  await page.route(SERVICE_RECORD_TEMPLATE_ROUTE, async (route) => {
    await route.fulfill({
      status: serviceRecordTemplateStatus,
      contentType: "application/json",
      body: JSON.stringify(
        serviceRecordTemplateStatus === 200
          ? {
              templateId,
              ...(!omitTemplateIds && { templateIds }),
            }
          : { error: "service-record template unavailable" },
      ),
    });
  });

  await page.route(STATUS_COUNTS_ROUTE, async (route) => {
    const url = new URL(route.request().url());
    await onStatusCountsRequest?.(parseListRequest(url));
    const documents = filterContractDocuments(
      getDocuments(),
      url.searchParams,
      configuredServiceRecordTemplateIds,
    );
    await route.fulfill({
      status: statusCountsStatus,
      contentType: "application/json",
      body: JSON.stringify(
        statusCountsStatus === 200
          ? { documents: documents.map(toStatusSignal) }
          : { error: "status counts unavailable" },
      ),
    });
  });

  await page.route(LIST_ROUTE, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    const url = new URL(route.request().url());
    const request = parseListRequest(url);
    await onListRequest?.(request);
    await beforeListResponse?.(request);

    const filteredDocuments = filterContractDocuments(
      getDocuments(),
      url.searchParams,
      configuredServiceRecordTemplateIds,
    );
    const documents = filteredDocuments.slice(request.skip, request.skip + request.limit);
    await route.fulfill({
      status: listStatus,
      contentType: "application/json",
      body: JSON.stringify(
        listStatus === 200
          ? {
              documents,
              total_rows: filteredDocuments.length,
              limit: request.limit,
              skip: request.skip,
              has_more: request.skip + request.limit < filteredDocuments.length,
              snapshot_version: SNAPSHOT_VERSION,
            }
          : { error: "documents unavailable" },
      ),
    });
  });
}
