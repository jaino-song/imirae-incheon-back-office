const MODEL_EXCLUDED_KEYS = new Set([
    "phone", "phonenumber", "mobile", "cellphone", "address", "email",
    "documentcontent", "token", "tokens", "accesstoken", "refreshtoken",
    "signedurl", "signedurls", "steprecipientsms", "accnum", "accountnumber",
    "note", "notes", "customfield", "customfields",
]);

const FREE_TEXT_REDACTIONS = [
    /(?:\+?82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?\d{4}/g,
    /\b[\w.+-]+@[\w.-]+\.\w+\b/g,
    /https?:\/\/\S+/gi,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    /\b[A-Za-z0-9_-]{24,}\b/g,
    /\b\d{6,}\b/g,
];

export function redactFreeText(text: string): string {
    return FREE_TEXT_REDACTIONS.reduce((value, pattern) => value.replace(pattern, "[redacted]"), text);
}

export function redactModelValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactModelValue);
    if (typeof value === "string") return redactFreeText(value);
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !MODEL_EXCLUDED_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")))
        .map(([key, nested]) => [key, redactModelValue(nested)]));
}
