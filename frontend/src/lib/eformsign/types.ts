import type { DocumentStatusLabel } from "@/lib/eformsign/status-codes";
import type {
  EformsignApiListResponse as SharedEformsignApiListResponse,
  EformsignDocument as SharedEformsignDocument,
  EformsignDocumentsResponse as SharedEformsignDocumentsResponse,
  EformsignTemplate as SharedEformsignTemplate,
} from "@babyjamjam/shared/types/eformsign";

export * from "@babyjamjam/shared/types/eformsign";

export interface EformsignDocument extends Omit<SharedEformsignDocument, "template"> {
  template?: Partial<SharedEformsignTemplate>;
}

export interface EformsignDocumentsResponse extends Omit<SharedEformsignDocumentsResponse, "documents"> {
  documents: EformsignDocument[];
}

export interface EformsignApiListResponse extends Omit<SharedEformsignApiListResponse, "documents"> {
  documents: EformsignDocument[];
}

// UI-only view model: derived from raw eformsign documents for list rendering.
export interface EformsignDocumentView {
  doc_id: string;
  customer_name: string;
  created_date: number;
  status: DocumentStatusLabel;
}

// Raw per-doc signals from `GET /api/documents/status-counts` (branch-scoped,
// HQ-aware). Folded into the StatsBar counters by `foldContractStats`. The
// fields come from each doc's live eformsign `current_status`.
export interface EformsignStatusCountsResponse {
  documents: Array<{
    status_type: string | null;
    step_type: string | null;
    step_name: string | null;
    step_recipient_types: Array<string | null>;
    /** YYYY-MM-DD when known; splits the 서명 완료/검토 필요 counters. */
    contract_end_date?: string | null;
    /** Authoritative display status stamped by the backend at serve time. */
    display_status?: string | null;
  }>;
}
