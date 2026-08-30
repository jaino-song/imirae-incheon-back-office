import { AsyncLocalStorage } from "node:async_hooks";
import { AdminAuditActor } from "./admin-audit-event.service";

const storage = new AsyncLocalStorage<AdminAuditActor>();

export function currentAdminAuditActor(): AdminAuditActor | undefined {
    return storage.getStore();
}

export function runWithAdminAuditActor<T>(actor: AdminAuditActor, callback: () => T): T {
    return storage.run(actor, callback);
}
