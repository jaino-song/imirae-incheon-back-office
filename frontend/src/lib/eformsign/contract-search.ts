import { matchesSearchQuery } from "@/lib/search/korean-search";
import { resolveDocumentCustomerName } from "@/lib/eformsign/display-name";
import type { EformsignDocument } from "@/lib/eformsign/types";

export function matchesDocumentSearch(
  document: EformsignDocument,
  query: string,
  mappedCustomerName?: string | null,
): boolean {
  return matchesSearchQuery(query, [
    resolveDocumentCustomerName(document, mappedCustomerName),
    document.document_name,
  ]);
}
