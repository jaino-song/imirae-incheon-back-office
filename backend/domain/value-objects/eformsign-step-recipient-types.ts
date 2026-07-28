const EFORMSIGN_STEP_RECIPIENT_TYPE_DELIMITER = ",";

type RecipientTypeValue = string | null | undefined;

export function encodeEformsignStepRecipientTypes(
    values: readonly RecipientTypeValue[] | null | undefined,
): string | null {
    if (!values) return null;

    const normalized = values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value));

    // The delimiter is only safe because eformsign recipient types are short codes. If one
    // ever contains it, decoding would silently split it into two values.
    const unsafe = normalized.find(
        (value) => value.includes(EFORMSIGN_STEP_RECIPIENT_TYPE_DELIMITER),
    );
    if (unsafe !== undefined) {
        throw new Error(
            `eformsign recipient type "${unsafe}" contains the "${EFORMSIGN_STEP_RECIPIENT_TYPE_DELIMITER}" delimiter and cannot be encoded.`,
        );
    }

    return normalized.length > 0
        ? normalized.join(EFORMSIGN_STEP_RECIPIENT_TYPE_DELIMITER)
        : null;
}

export function decodeEformsignStepRecipientTypes(
    value: string | null | undefined,
): string[] | null {
    const normalized = value
        ?.split(EFORMSIGN_STEP_RECIPIENT_TYPE_DELIMITER)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    return normalized && normalized.length > 0 ? normalized : null;
}
