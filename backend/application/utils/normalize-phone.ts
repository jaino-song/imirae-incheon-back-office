// Keep the application import path stable while making the canonical identity
// rule available to domain entities and infrastructure mappers without a
// domain -> application dependency.
export {
    assertRequiredPhone,
    assertValidPhone,
    extractPhoneCandidates,
    INVALID_PHONE_MESSAGE,
    invalidPhoneFieldMessage,
    InvalidPhoneError,
    normalizePhone,
} from "domain/utils/normalize-phone";
