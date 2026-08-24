export interface SmsClientVariableSource {
    name: string;
    phone: string | null;
    type: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    area?: { bankAccountInfo: { bankName: string | null; accNum: string | null } | null } | null;
}

export interface SmsClientVariables {
    name: string;
    clientName: string;
    phone: string;
    weeks: string;
    duration: string;
    type: string;
    fullPrice: string;
    grant: string;
    actualPrice: string;
    bankName: string;
    accNum: string;
    [key: string]: string;
}

/**
 * Builds the full SMS template variable bag from a client (+ its area's bank account).
 * Every value is coerced to a string with a "" fallback so the renderer never leaks a
 * literal {{placeholder}}. The SMS delivery guard separately blocks sending when any
 * required template value is blank.
 */
export function buildSmsClientVariables(client: SmsClientVariableSource): SmsClientVariables {
    const duration = client.duration ?? null;
    const weeks = duration != null ? Math.floor(duration / 5) : 0;
    return {
        name: client.name,
        clientName: client.name,
        phone: client.phone ?? "",
        weeks: String(weeks),
        duration: duration != null ? String(duration) : "",
        type: client.type ?? "",
        fullPrice: client.fullPrice ?? "",
        grant: client.grant ?? "",
        actualPrice: client.actualPrice ?? "",
        bankName: client.area?.bankAccountInfo?.bankName ?? "",
        accNum: client.area?.bankAccountInfo?.accNum ?? "",
    };
}
