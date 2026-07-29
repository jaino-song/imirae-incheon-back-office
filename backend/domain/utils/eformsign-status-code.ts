const STATUS_NAME_TO_CODE: Readonly<Record<string, string>> = {
    doc_tempsave: "001",
    doc_create: "002",
    doc_complete: "003",
    doc_request_approval: "010",
    doc_reject_approval: "011",
    doc_accept_approval: "012",
    doc_request_reception: "020",
    doc_reject_reception: "021",
    doc_accept_reception: "022",
    doc_request_outsider: "030",
    doc_reject_outsider: "031",
    doc_accept_outsider: "032",
    doc_request_revoke: "040",
    doc_revoke: "042",
    doc_update: "043",
    doc_request_reject: "045",
    doc_request_delete: "047",
    doc_delete: "049",
    doc_request_participant: "060",
    doc_reject_participant: "061",
    doc_accept_participant: "062",
    doc_rerequest_participant: "063",
    doc_open_participant: "064",
    doc_request_reviewer: "070",
    doc_reject_reviewer: "071",
    doc_accept_reviewer: "072",
    doc_expired: "080",
    face_signature_complete: "092",
};

function normalizeEformsignCode(
    code: string | number | null | undefined,
    width: number,
): string {
    const normalized = String(code ?? "").trim().toLowerCase();
    return normalized ? normalized.padStart(width, "0") : "";
}

export function normalizeEformsignStatusCode(
    statusType: string | number | null | undefined,
): string {
    const normalized = normalizeEformsignCode(statusType, 3);
    if (!normalized) {
        return "000";
    }

    return STATUS_NAME_TO_CODE[normalized] ?? normalized;
}

export function normalizeEformsignStepType(
    stepType: string | number | null | undefined,
): string {
    return normalizeEformsignCode(stepType, 2);
}
