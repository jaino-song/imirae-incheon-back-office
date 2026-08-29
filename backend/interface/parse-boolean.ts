import { BadRequestException } from "@nestjs/common";

export function parseBooleanQuery(
    value: string | undefined,
    name: string,
    defaultValue: boolean,
): boolean {
    if (value === undefined || value === "") {
        return defaultValue;
    }
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }

    throw new BadRequestException(`${name} must be true or false`);
}
