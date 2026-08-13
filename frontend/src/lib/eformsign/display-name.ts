import type { EformsignDocument } from "@/lib/eformsign/types";
import {
  UNKNOWN_CUSTOMER_NAME as UNKNOWN_NAME,
  customerName as getDocumentCustomerName,
} from "@babyjamjam/shared/eformsign/display-name";

export function resolveDocumentCustomerName(
  document: EformsignDocument,
  mappedCustomerName?: string | null,
): string | null {
  const documentCustomerName = getDocumentCustomerName(document);
  if (documentCustomerName !== UNKNOWN_NAME) {
    return documentCustomerName;
  }

  return mappedCustomerName?.trim() || null;
}

export {
  UNKNOWN_CUSTOMER_NAME,
  contractDisplayName,
  customerName,
  mergeDocumentForDisplayData,
  type EformsignDisplayNameSource,
} from "@babyjamjam/shared/eformsign/display-name";
