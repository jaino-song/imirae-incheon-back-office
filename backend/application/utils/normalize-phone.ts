// Keep the application import path stable while making the canonical identity
// rule available to domain entities and infrastructure mappers without a
// domain -> application dependency.
export { extractPhoneCandidates, normalizePhone } from "domain/utils/normalize-phone";
