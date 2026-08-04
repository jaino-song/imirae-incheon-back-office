import { createHash } from "node:crypto";

import type { ClientEntity } from "domain/entities/client.entity";

export function clientAgentTargetVersion(client: ClientEntity | null): string {
    if (!client) return "missing";
    const value = {
        id: client.id, name: client.name, address: client.address, phone: client.phone, type: client.type,
        duration: client.duration, fullPrice: client.fullPrice, grant: client.grant, actualPrice: client.actualPrice,
        startDate: client.startDate?.toISOString() ?? null, endDate: client.endDate?.toISOString() ?? null,
        dueDate: client.dueDate?.toISOString() ?? null, birthDate: client.birthDate?.toISOString() ?? null,
        careCenter: client.careCenter, voucherClient: client.voucherClient, birthday: client.birthday,
        serviceStatus: client.serviceStatus, breastPump: client.breastPump, areaId: client.areaId,
    };
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function clientAgentTargetSnapshot(client: ClientEntity) {
    return { id: client.id, name: client.name, serviceStatus: client.serviceStatus };
}
