import { Transform } from "class-transformer";
import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
} from "class-validator";
import { normalizePhone } from "domain/utils/normalize-phone";

/** Convert an explicitly blank nullable client phone into the documented clear. */
export function trimNullablePhone({ value }: { value: unknown }): unknown {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
}

/**
 * Validate that a present phone maps to a canonical identity key. Null and
 * undefined are deliberately accepted for nullable client clear/omission
 * semantics; callers that require a phone should combine this with
 * `@IsNotEmpty`/`@IsString`.
 */
export function IsCanonicalPhone(validationOptions?: ValidationOptions): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        registerDecorator({
            name: "isCanonicalPhone",
            target: target.constructor,
            propertyName: propertyKey.toString(),
            options: validationOptions,
            validator: {
                validate(value: unknown): boolean {
                    if (value === null || value === undefined) return true;
                    return typeof value === "string"
                        && value.trim().length > 0
                        && normalizePhone(value) !== null;
                },
                defaultMessage(args: ValidationArguments): string {
                    return `${String(args.property)} must be a valid Korean phone number`;
                },
            },
        });
    };
}

/** Reusable class-transformer decorator for nullable client phone fields. */
export const TrimNullablePhone = Transform(trimNullablePhone);
