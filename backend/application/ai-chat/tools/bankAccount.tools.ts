import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const listBankAccountsSchema: FunctionDeclaration = {
    name: "listBankAccounts",
    description: `List branch bank account references by area (owner/admin only).

USE THIS TOOL when user asks:
- "계좌 정보", "입금 계좌", "은행 계좌 목록", "계좌번호"

Returns: List of branch-scoped accounts with area, bank name, and masked last four digits only. Full account numbers are never available to the assistant.`,
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};

export const getBankAccountByAreaSchema: FunctionDeclaration = {
    name: "getBankAccountByArea",
    description: `Get the masked bank account reference for a specific area (owner/admin only).

USE THIS TOOL when user asks:
- "인천 계좌", "강남구 입금 계좌", "지역별 계좌", "인천 계좌번호"`,
    parameters: {
        type: "object",
        properties: {
            area: {
                type: "string",
                description: "Area name (지역명, e.g., '인천', '강남구')",
            },
        },
        required: ["area"],
    },
};

export const bankAccountTools: FunctionDeclaration[] = [
    listBankAccountsSchema,
    getBankAccountByAreaSchema,
];
