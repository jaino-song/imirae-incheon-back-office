import type { QueryClient } from "@tanstack/react-query";

import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useClientWizardStore } from "@/stores/client-wizard-store";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import { useEmployeeWizardStore } from "@/stores/employee-wizard-store";
import { useFormStore } from "@/stores/form-store";
import { useTemplateStore } from "@/stores/template-store";
import { safeStorageRemoveItem } from "@/lib/safe-storage";

export interface ResetAuthorityStateOptions {
  waitForCancellation?: boolean;
}

/**
 * Clears browser state that is owned by the current authenticated identity.
 *
 * The browser QueryClient is intentionally shared by the app shell, so logout,
 * account replacement, and branch changes must clear it before the next
 * authority can render. Store resets are kept in one explicit registry so a
 * newly added PII-bearing draft cannot silently survive an authority change.
 */
export async function resetAuthorityState(
  client?: QueryClient,
  options: ResetAuthorityStateOptions = {},
): Promise<void> {
  // Keep the query-client module lazy. Its legacy singleton export is eager,
  // and loading it while an unrelated test has a partial react-query mock
  // would construct a client before the caller can provide its own instance.
  const activeClient = client ?? (await import("@/lib/queryClient")).getQueryClient();

  // Start cancellation before clearing. clear() is synchronous below, which
  // guarantees no old cache is observable while a caller awaits cancellation.
  const cancellation = activeClient.cancelQueries().catch(() => undefined);
  activeClient.clear();

  useFormStore.getState().resetAll();
  useClientWizardStore.getState().reset();
  useEmployeeWizardStore.getState().reset();
  useClientDialogStore.getState().reset();
  useEmployeeDialogStore.getState().reset();
  useTemplateStore.getState().reset();

  if (typeof window !== "undefined") {
    // Storage may be unavailable in strict-privacy contexts; it must not block
    // the cookie and session cleanup that follows this reset.
    // The chat-session id is an identity-owned handle to persisted business
    // conversation state; retaining it could make the next account request it.
    safeStorageRemoveItem("local", "ai_chat_session_id");
    // The agent session id is an identity-owned handle to persisted business
    // conversation state; retaining it could make the next account request it.
    safeStorageRemoveItem("session", "agent_session_id");
  }

  // An auth interceptor may be awaiting a query whose cancellation promise
  // includes the same 401 request. Redirect paths still clear all identity
  // state synchronously, but can continue without waiting for that request.
  if (options.waitForCancellation !== false) {
    await cancellation;
  }
}
