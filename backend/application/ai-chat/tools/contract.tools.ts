import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const listAvailableTemplatesSchema: FunctionDeclaration = {
    name: "listAvailableTemplates",
    description: "List all available contract templates by area. Returns template IDs and names for each area.",
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};

export const createAndSendContractSchema: FunctionDeclaration = {
    name: "createAndSendContract",
    description: "Create and send a contract to a client via SMS. The contract will be sent to the client's phone number. Requires confirmation before execution.",
    parameters: {
        type: "object",
        properties: {
            clientId: {
                type: "number",
                description: "The unique ID of the client to send the contract to",
            },
            areaId: {
                type: "string",
                description: "The area ID for template selection (e.g., 'incheon', 'seoul'). Use listAvailableTemplates to see available areas.",
            },
        },
        required: ["clientId", "areaId"],
    },
};

export const getContractStatusSchema: FunctionDeclaration = {
    name: "getContractStatus",
    description: "Get the status of a contract document by its ID or by client ID.",
    parameters: {
        type: "object",
        properties: {
            documentId: {
                type: "string",
                description: "The eFormSign document ID",
            },
            clientId: {
                type: "number",
                description: "The client ID to find associated contracts",
            },
        },
        required: [],
    },
};

export const listAllContractsSchema: FunctionDeclaration = {
    name: "listAllContracts",
    description: `List all eformsign contract documents.

USE THIS TOOL when user asks:
- "모든 계약서", "계약서 목록", "전체 계약 현황", "계약서 리스트"

Returns: List of all contracts with status, client info, dates`,
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};

export const contractTools: FunctionDeclaration[] = [
    listAvailableTemplatesSchema,
    createAndSendContractSchema,
    getContractStatusSchema,
    listAllContractsSchema,
];
