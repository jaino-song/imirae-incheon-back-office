const MODEL_EXCLUDED_KEYS = new Set([
    "phone", "phonenumber", "mobile", "mobilephone", "cellphone", "telephone",
    "address", "email", "emailaddress", "accountnumber", "bankaccountnumber", "accnum",
    "bankaccount", "receiver", "recipient", "receiverphone", "recipientphone", "senderphone",
    "documentcontent", "documentbody", "documenttext", "filecontent", "filedata",
    "attachmentcontent", "rawcontent", "token", "tokens", "accesstoken", "refreshtoken",
    "idtoken", "authtoken", "auth", "authid", "authentication", "authorization", "authorizations",
    "cookie", "cookies", "apikey", "password", "passwd", "passphrase", "secret", "secrets", "signature",
    "signedurl", "signedurls", "presignedurl", "storageurl", "storageurls", "storagepath",
    "storagekey", "objectkey", "documenturl", "downloadurl", "steprecipientsms",
    "note", "notes", "customfield", "customfields",
]);

const MASKED_OPERATIONAL_KEYS = new Set([
    "accountlast4", "bankaccountlast4", "accountmasked", "maskedaccount",
    "phonelast4", "mobilelast4", "emailmasked",
]);

const CANONICAL_IDENTIFIER_KEYS = new Set([
    "id", "ids", "uuid", "uuids", "cuid", "cuids", "ulid", "ulids", "identifier", "identifiers",
    "cursor", "cursors", "nextcursor", "previouscursor", "prevcursor", "pagecursor",
    "version", "versions", "targetversion", "currentversion", "expectedversion", "schemaversion",
    "revision", "revisions", "targetrevision", "currentrevision", "expectedrevision", "proposalrevision",
    "actionid", "sessionid", "traceid", "branchid", "userid", "clientid", "documentid", "draftid",
    "callid", "entityid", "employeeid", "serviceid", "bankaccountid", "addressid", "hash", "hashes", "checksum", "checksums",
    ...MASKED_OPERATIONAL_KEYS,
]);

const FREE_TEXT_REDACTIONS = [
    // Credential-shaped text must be removed before the generic URL matcher.
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    /\b(?:authorization|set[_ -]?cookie|cookie|token|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|auth|api[_ -]?key|client[_ -]?secret|secret|password|passwd|passphrase|signature|signed[_ -]?url|storage[_ -]?url)\s*[:=]\s*(?:"[^"]*"|'[^']*'|Bearer\s+\S+|[^\s,;}]+)/gi,
    /(?:\+?82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?\d{4}/g,
    /(?<![A-Za-z0-9_.])(?:\+82[-\s]?(?:2|[3-6][0-9]|[7-8][0-9]|50[0-9])|(?:02|0[3-6][0-9]|07[0-9]|08[0-9]|050[0-9]))[-\s]?\d{3,4}[-\s]?\d{4}(?![A-Za-z0-9_.])/g,
    /(?<![A-Za-z0-9_-])\d{6}-\d{7}(?![A-Za-z0-9_-])/g,
    /(?<![A-Za-z0-9_-])\d{3}-\d{2}-\d{5}(?![A-Za-z0-9_-])/g,
    /\b[\w.+-]+@[\w.-]+\.\w+\b/g,
    /https?:\/\/\S+/gi,
    /(?<![A-Za-z0-9_-])\d{6,}(?![A-Za-z0-9_-])/g,
];

const OPERATIONAL_IDENTIFIER_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HEX_HASH_SHAPE = /^[A-F0-9]{32,128}$/i;
const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const COMPACT_DATE_SHAPE = /^(?:19|20)\d{6}$/;

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Credential fields win over identifier-looking names (for example accessTokenId). */
function isCredentialKey(normalized: string): boolean {
    return normalized.includes("token")
        || normalized.includes("authorization")
        || normalized.includes("cookie")
        || normalized.includes("apikey")
        || normalized.includes("password")
        || normalized.includes("passwd")
        || normalized.includes("passphrase")
        || normalized.includes("secret")
        || normalized.includes("signature")
        || normalized.includes("signedurl")
        || normalized.includes("storageurl")
        || normalized.includes("documentcontent")
        || normalized.includes("filecontent")
        || normalized.includes("attachmentcontent")
        || normalized.includes("documenturl")
        || normalized.includes("downloadurl")
        || normalized.includes("storagepath")
        || normalized.includes("storagekey")
        || normalized === "auth"
        || normalized === "authid"
        || normalized === "authentication";
}

function isCanonicalIdentifierKey(key: string): boolean {
    const normalized = normalizeKey(key);
    if (CANONICAL_IDENTIFIER_KEYS.has(normalized)) return true;

    // Require a real naming boundary for generic camel/snake/kebab identifiers.
    // This deliberately does not classify ordinary words such as paid, valid, grid, or solid.
    return /^[a-z][A-Za-z0-9]*(?:Id|ID|Ids|IDS)$/.test(key)
        || /(?:^|[_-])id(?:s)?$/i.test(key)
        || /(?:Cursor|Cursors|Version|Versions|Revision|Revisions)$/.test(key)
        || /(?:^|[_-])(?:cursor|cursors|version|versions|revision|revisions)$/i.test(key);
}

function isSensitivePiiKey(key: string): boolean {
    const normalized = normalizeKey(key);
    if (MODEL_EXCLUDED_KEYS.has(normalized)) return true;
    if (normalized === "content" || normalized === "body" || normalized === "text") return false;
    if (/(?:document|file|attachment|storage)(?:content|body|text|url)$/.test(normalized)) return true;
    if (normalized === "url" && /(?:document|file|attachment|storage|signed|download)/.test(normalized)) return true;

    // Keep canonical IDs such as addressId, bankAccountId, and emailId intact.
    if (isCanonicalIdentifierKey(key)) return false;
    return normalized.includes("phone")
        || normalized.includes("mobile")
        || normalized.includes("email")
        || normalized.includes("address")
        || normalized.endsWith("accountnumber")
        || normalized.endsWith("accountno")
        || normalized === "bankaccount";
}

function isExcludedKey(key: string, parentKey = ""): boolean {
    const normalized = normalizeKey(key);
    if (isCredentialKey(normalized)) return true;
    if (MASKED_OPERATIONAL_KEYS.has(normalized) || isCanonicalIdentifierKey(key)) return false;

    const normalizedParent = normalizeKey(parentKey);
    if ((normalized === "content" || normalized === "body" || normalized === "text")
        && /(?:document|file|attachment|storage)/.test(normalizedParent)) return true;
    if (normalized === "url" && /(?:document|file|attachment|storage|signed|download)/.test(normalizedParent)) return true;
    return isSensitivePiiKey(key);
}

export function redactFreeText(text: string): string {
    return FREE_TEXT_REDACTIONS.reduce((value, pattern) => value.replace(pattern, "[redacted]"), text);
}

function isAllowedOperationalIdentifier(value: string): boolean {
    if (!OPERATIONAL_IDENTIFIER_SHAPE.test(value)) return false;
    if (HEX_HASH_SHAPE.test(value) || ULID_SHAPE.test(value) || COMPACT_DATE_SHAPE.test(value)) return true;
    return redactFreeText(value) === value;
}

function redactModelValueAtKey(value: unknown, key: string): unknown {
    if (Array.isArray(value)) return value.map((item) => redactModelValueAtKey(item, key));
    if (typeof value === "string") {
        return isCanonicalIdentifierKey(key) && isAllowedOperationalIdentifier(value)
            ? value
            : redactFreeText(value);
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([nestedKey]) => !isExcludedKey(nestedKey, key))
        .map(([nestedKey, nestedValue]) => [nestedKey, redactModelValueAtKey(nestedValue, nestedKey)]));
}

export function redactModelValue(value: unknown): unknown {
    return redactModelValueAtKey(value, "");
}
