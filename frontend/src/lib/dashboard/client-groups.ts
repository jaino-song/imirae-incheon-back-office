import type {
  ActionRequiredReason,
  ActionRequiredStatus,
} from "@/lib/client/action-required";
import type { Client, PendingScheduleChange } from "@/lib/client/types";

type DashboardAttentionClient = {
  actionRequired?: ActionRequiredStatus | null;
  pendingScheduleChange?: PendingScheduleChange | null;
};

const UNPRIORITIZED_ATTENTION_SORT_ORDER = Number.MAX_SAFE_INTEGER;

export interface DashboardAttentionItem<
  TClient extends DashboardAttentionClient = Client,
> {
  client: TClient;
  reason?: ActionRequiredReason;
  priority?: ActionRequiredStatus["priority"];
}

export function getDashboardAttentionItems<
  TClient extends DashboardAttentionClient,
>(clients: TClient[]): DashboardAttentionItem<TClient>[] {
  const items = clients.flatMap((client): DashboardAttentionItem<TClient>[] => {
    const actionRequired = client.actionRequired;
    if (actionRequired) {
      return [{
        client,
        reason: actionRequired.reason,
        priority: actionRequired.priority,
      }];
    }

    return client.pendingScheduleChange ? [{ client }] : [];
  });

  return items.sort((a, b) => (
    (a.priority ?? UNPRIORITIZED_ATTENTION_SORT_ORDER)
    - (b.priority ?? UNPRIORITIZED_ATTENTION_SORT_ORDER)
  ));
}
