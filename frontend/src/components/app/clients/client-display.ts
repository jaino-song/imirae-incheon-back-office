const CLIENT_DISPLAY_LABELS: Record<string, string> = {
    "A통합-1형": "A통합1형",
    "조리원": "산후조리원",
    "조리원 이용": "산후조리원",
};

export function getClientDisplayLabel(value: string): string {
    return CLIENT_DISPLAY_LABELS[value] ?? value;
}
