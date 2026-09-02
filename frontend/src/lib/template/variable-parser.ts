import type { MessageTemplateVariable } from "@babyjamjam/shared/types/message";

export const extractVariables = (content: string): string[] => {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = Array.from(content.matchAll(regex));
    return [...new Set(matches.map(m => m[1]?.trim() ?? "").filter(Boolean))];
};

export const renderTemplate = (
    content: string,
    values: Record<string, string>,
    variables?: MessageTemplateVariable[]
): string => {
    let rendered = content;
    const keys = Object.keys(values);

    for (const key of keys) {
        const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
        const value = values[key];

        if (typeof value !== "string" || value.trim().length === 0) {
            rendered = rendered.replace(regex, `{{${key}}}`);
            continue;
        }

        rendered = rendered.replace(regex, value);
    }

    if (variables && variables.length > 0) {
        const remainingKeys = extractVariables(rendered);

        for (const key of remainingKeys) {
            const fallback = variables.find(v => v.key === key)?.fallback;

            if (typeof fallback === "string" && fallback.trim().length > 0) {
                const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
                rendered = rendered.replace(regex, fallback);
            }
        }
    }

    return rendered;
};

export const getUnresolvedKeys = (
    content: string,
    values: Record<string, string>,
    variables?: MessageTemplateVariable[]
): string[] => {
    return extractVariables(renderTemplate(content, values, variables));
};
