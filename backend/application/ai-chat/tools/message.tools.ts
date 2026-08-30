import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const getMessagesSchema: FunctionDeclaration = {
    name: "getMessages",
    description: "Get all message templates from the notice board.",
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};

export const createMessageSchema: FunctionDeclaration = {
    name: "createMessage",
    description: "Create a new message template. Requires confirmation before execution.",
    parameters: {
        type: "object",
        properties: {
            title: {
                type: "string",
                description: "Message title",
            },
            text: {
                type: "string",
                description: "Message content/body",
            },
        },
        required: ["title", "text"],
    },
};

export const updateMessageSchema: FunctionDeclaration = {
    name: "updateMessage",
    description: "Update an existing message template. Requires confirmation before execution.",
    parameters: {
        type: "object",
        properties: {
            messageId: {
                type: "number",
                description: "The unique ID of the message to update",
            },
            title: {
                type: "string",
                description: "New message title",
            },
            text: {
                type: "string",
                description: "New message content/body",
            },
        },
        required: ["messageId", "title", "text"],
    },
};

export const deleteMessageSchema: FunctionDeclaration = {
    name: "deleteMessage",
    description: "Delete a message template. This action is irreversible. Requires confirmation before execution.",
    parameters: {
        type: "object",
        properties: {
            messageId: {
                type: "number",
                description: "The unique ID of the message to delete",
            },
        },
        required: ["messageId"],
    },
};

export const messageTools: FunctionDeclaration[] = [
    getMessagesSchema,
    createMessageSchema,
    updateMessageSchema,
    deleteMessageSchema,
];
