// Shared eformsign contracts used by both frontend and mobile.
//
// The source of truth for these shapes is the backend contract surface:
// - backend/domain/repositories/eformsign.client.interface.ts
// - backend/domain/repositories/eformsign-doc.repository.interface.ts
// - backend/interface/dto/eformsign-doc.dto.ts
// - backend/interface/dto/eformsign.dto.ts
// - backend/application/services/eformsign.service.ts
// - backend/application/services/eformsign-headless-progress.service.ts
//
// Keep raw eformsign document payloads snake_case. Local dashboard routes
// under /eformsign-docs stay camelCase.

export interface EformsignCompanyOption {
  id: string;
  country_code?: string;
  user_key?: string;
}

export interface EformsignUserOption {
  type: "01" | "02";
  id?: string;
  access_token?: string;
  refresh_token?: string;
  external_token?: string;
  external_user_info?: {
    name?: string;
  };
}

export interface EformsignModeOption {
  type: "01" | "02" | "03";
  template_id?: string;
  template_version?: string;
  document_id?: string;
}

export type EformsignViewerToolbarOption = boolean | Record<string, string>;

export interface EformsignLayoutOption {
  lang_code?: "ko" | "en" | "ja";
  zoom?: string;
  viewer_toolbar?: EformsignViewerToolbarOption;
}

export interface EformsignPrefillField {
  id: string;
  value: string;
  enabled?: boolean;
  required?: boolean;
}

export interface EformsignRecipient {
  step_idx: string;
  step_type: "05" | "06";
  name: string;
  id?: string;
  sms?: string;
  use_mail?: boolean;
  use_sms?: boolean;
  auth?: {
    password?: string;
    password_hint?: string;
    valid?: {
      day?: number;
      hour?: number;
    };
  };
}

export interface EformsignPrefillOption {
  document_name?: string;
  fields?: EformsignPrefillField[];
  recipients?: EformsignRecipient[];
  comment?: string;
}

export interface EformsignDocumentOption {
  company: EformsignCompanyOption;
  user?: EformsignUserOption;
  mode: EformsignModeOption;
  layout?: EformsignLayoutOption;
  prefill?: EformsignPrefillOption;
  return_fields?: string[];
}

export interface EformsignSuccessResponse {
  code: string;
  document_id?: string;
  field_values?: Record<string, string>;
}

export interface EformsignErrorResponse {
  code: string;
  message: string;
}

export interface EformsignActionResponse {
  type: string;
  data: unknown;
}

export type EformsignSuccessCallback = (response: EformsignSuccessResponse) => void;
export type EformsignErrorCallback = (response: EformsignErrorResponse) => void;
export type EformsignActionCallback = (response: EformsignActionResponse) => void;

export interface EformSignDocument {
  document(
    documentOption: EformsignDocumentOption,
    iframeId: string,
    successCallback?: EformsignSuccessCallback,
    errorCallback?: EformsignErrorCallback,
    actionCallback?: EformsignActionCallback,
  ): void;
  open(): void;
}

declare global {
  interface Window {
    EformSignDocument: new () => EformSignDocument;
  }
}

export interface EformsignStepRecipient {
  recipient_type: string;
  name: string;
  sms?: string;
  id?: string;
}

export interface EformsignCurrentStatus {
  status_type: string;
  status_doc_type: string;
  status_doc_detail: string;
  step_type: string;
  step_index: string;
  step_name: string;
  step_recipients: EformsignStepRecipient[];
  step_group: number;
  expired_date: number;
  _expired: boolean;
}

export interface EformsignTemplate {
  id: string;
  name: string;
}

export interface EformsignCreator {
  recipient_type: string;
  id?: string;
  name: string;
  sms?: string;
}

export interface EformsignDocument {
  id: string;
  document_number: string;
  template: EformsignTemplate;
  document_name: string;
  creator: EformsignCreator;
  created_date: number;
  last_editor: EformsignCreator;
  updated_date: number;
  current_status: EformsignCurrentStatus;
  /**
   * YYYY-MM-DD, attached by the backend mirror list to in-progress documents in
   * the provider-review step; the UIs split 서명 완료 vs 검토 필요 on it.
   */
  contract_end_date?: string | null;
  /**
   * Authoritative display status stamped by the backend at serve time
   * (ContractDocDisplayStatus). Clients map it to a label/variant; the shared
   * resolver is only the fallback for payloads that predate the field.
   */
  display_status?: string | null;
  fields: unknown[];
  next_status: unknown[];
  previous_status: unknown[];
  histories: unknown[];
  recipients: unknown[];
  detail_template_info: unknown[];
}

export interface EformsignDocumentsResponse {
  documents: EformsignDocument[];
  total_rows: number;
  limit: number;
  skip: number;
  has_more?: boolean;
  snapshot_version?: string;
}

export interface EformsignApiListResponse {
  documents: EformsignDocument[];
  total_count?: number;
  total_rows?: number;
}

export interface EformsignDeleteFailure {
  document_id: string;
  code: string;
  message: string;
}

export interface EformsignDeleteDocumentsResponse {
  code: string | number;
  message: string;
  status: string | number;
  result: {
    success_result: string[];
    fail_result: EformsignDeleteFailure[];
  };
}

export interface EformsignAuthStatusResponse {
  hasAppAuthToken: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
}

export interface EformsignDocClientSummary {
  documentId: string;
  clientId: number | null;
  clientName: string;
  clientPhone: string | null;
  providerName: string | null;
}

/**
 * 계약서 detail payload에서 추출한 고객 등록 후보.
 * extracted=true여도 고객 수신자로 검증된 번호와 저장 customerPhone이 모두 없으면
 * phone은 null이며, 나머지 상세 필드는 그대로 프리필한다.
 * extracted=false 폴백은 이름을 채우지 않는다 (문서 컬럼 이름은 관리사/직원명일 수
 * 있어 신뢰 불가); phone만 폴백된다.
 * 날짜는 모두 YYYY-MM-DD, phone은 대시 포함 표기(예: 010-1234-5678).
 */
export interface EformsignContractClientCandidateResponse {
  documentId: string;
  extracted: boolean;
  name: string | null;
  phone: string | null;
  address: string | null;
  birthday: string | null;
  dueDate: string | null;
  startDate: string | null;
  endDate: string | null;
  primaryEmployeeId: number | null;
  secondaryEmployeeId: number | null;
  type: string | null;
  duration: number | null;
  fullPrice: string | null;
  grant: string | null;
  actualPrice: string | null;
  careCenter: boolean | null;
  voucherClient: boolean;
  breastPump: boolean;
}

export type EformsignDocumentKind = "contract" | "service_record_snapshot";

export interface CreateEformsignDocRecordRequest {
  documentId: string;
  clientId: number;
  statusType: string;
  statusDetail: string;
  stepType: string;
  stepIndex: string;
  stepName: string;
  stepRecipientType: string;
  stepRecipientName: string;
  stepRecipientSms: string;
  expiredDate: string;
  linkToClient?: boolean;
  documentKind?: EformsignDocumentKind | null;
  employeeScheduleId?: number | null;
  templateId?: string | null;
}

export interface EformsignRecipientPhone {
  countryCode: string;
  phoneNumber: string;
}

export interface EformsignReRequestDocumentRequest {
  stepType: string;
  stepSeq: string;
  comment?: string;
  recipientPhone?: EformsignRecipientPhone;
}

export type HeadlessProgressStepKey = "client-started" | "info-inserted" | "creating" | "sent";

export interface HeadlessProgressState {
  step: HeadlessProgressStepKey | null;
  completed: boolean;
  failed: boolean;
}

export interface HeadlessProgressEvent {
  progressId: string;
  step: HeadlessProgressStepKey | "failed";
  at: number;
  reason?: string;
  failedStep?: HeadlessProgressStepKey;
}

export interface HeadlessProgressStep {
  key: HeadlessProgressStepKey;
  label: string;
  errorLabel: string;
}

export interface HeadlessDispatchResponse {
  ok: boolean;
  documentId?: string;
  durationMs: number;
  reason?: string;
  failedStep?: HeadlessProgressStepKey;
  fallbackHint?: "iframe";
}

export type HeadlessFinalizeResponse = {
  ok: true;
  completed: boolean;
  durationMs: number;
} | {
  ok: false;
  durationMs: number;
  reason?: string;
  /**
   * "iframe" means the step is genuinely unfinished and reopening the editor is
   * the recovery. "manual_check" means the vendor could not be asked, so the
   * document must be verified in eformsign before anyone acts on it.
   */
  fallbackHint?: "iframe" | "manual_check";
};

export type FinalizeHeadlessResponse = HeadlessFinalizeResponse;

/**
 * A provider-review-stage (070) contract as served by
 * GET /eformsign-docs/review-needed-contracts for the dashboard card, carrying
 * the nightly auto-finalize bookkeeping (attempts of 3, last error/attempt).
 */
export interface ReviewNeededContract {
  documentId: string;
  customerName: string | null;
  contractEndDate: string | null;
  autoFinalizeAttempts: number;
  autoFinalizeLastError: string | null;
  autoFinalizeLastAttemptAt: string | null;
}
