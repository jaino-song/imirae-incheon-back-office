import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const searchClientsSchema: FunctionDeclaration = {
    name: "searchClients",
    description: `Search for clients (산모/이용자) by name, phone, or address.

USE THIS TOOL when user asks to:
- Find a specific client: "김철수 산모 찾아줘", "홍길동 이용자 검색", "박영희 엄마 정보"
- Search clients by phone: "010-1234-5678 산모 누구야"
- List clients matching criteria: "강남구 산모 목록"

SYNONYMS: 산모 = 이용자 = 고객 = 엄마 = client = customer

NOTE: For total count/statistics, use getDashboardStats instead.

Returns: List of matching clients with id, name, phone, address, serviceStatus, primaryEmployee (담당 관리사)`,
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "Search query - name (이름), phone (전화번호), or address (주소)",
            },
            page: {
                type: "number",
                description: "Page number for pagination (default: 1)",
            },
            limit: {
                type: "number",
                description: "Number of results per page (default: 10, max: 50)",
            },
        },
        required: ["query"],
    },
};

export const getClientSchema: FunctionDeclaration = {
    name: "getClient",
    description: `Get detailed information about a specific client (산모/이용자) by ID.

USE THIS TOOL when user asks:
- "산모 ID 5번 정보 알려줘"
- "이용자 3번 상세 정보"
- "그 엄마 정보 더 자세히"
- Details about a specific client after search

SYNONYMS: 산모 = 이용자 = 고객 = 엄마 = client

Returns: Full client details including contacts, service dates, assigned 관리사/이모님, status`,
    parameters: {
        type: "object",
        properties: {
            clientId: {
                type: "number",
                description: "The unique ID of the client (산모/이용자 ID)",
            },
        },
        required: ["clientId"],
    },
};

export const createClientSchema: FunctionDeclaration = {
    name: "createClient",
    description: "Create a new client record. Requires confirmation before execution.",
    parameters: {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Client's full name",
            },
            phone: {
                type: "string",
                description: "Client's phone number",
            },
            address: {
                type: "string",
                description: "Client's address",
            },
            primaryEmployeeId: {
                type: "number",
                description: "ID of the primary caretaker employee",
            },
            secondaryEmployeeId: {
                type: "number",
                description: "ID of the secondary caretaker employee (optional)",
            },
            type: {
                type: "string",
                description: "Voucher type (e.g., 'A통합1형', 'B통합2형')",
            },
            duration: {
                type: "number",
                description: "Service duration in days",
            },
            startDate: {
                type: "string",
                description: "Service start date (YYYY-MM-DD format)",
            },
            endDate: {
                type: "string",
                description: "Service end date (YYYY-MM-DD format)",
            },
            careCenter: {
                type: "boolean",
                description: "Whether client uses care center",
            },
            voucherClient: {
                type: "boolean",
                description: "Whether client is a voucher client",
            },
            birthday: {
                type: "string",
                description: "Client's birthday (YYMMDD format)",
            },
        },
        required: ["name", "primaryEmployeeId", "careCenter", "voucherClient"],
    },
};

export const updateClientSchema: FunctionDeclaration = {
    name: "updateClient",
    description: `Update an existing client's information. Requires confirmation before execution.

USE THIS TOOL when user asks:
- "산모 정보 수정", "전화번호 변경", "연락처 바꿔줘", "주소 수정"

ACTION-FIRST RULE:
- Even when some update value is missing, call updateClient first with the available identifier (clientId or clientName).
- Then ask the missing detail if needed.

Examples:
- "이수진 산모 전화번호 변경해줘" -> updateClient(clientName: "이수진")
- "김민지 산모 연락처 010-1234-5678로 바꿔줘" -> updateClient(clientName: "김민지", phone: "010-1234-5678")`,
    parameters: {
        type: "object",
        properties: {
            clientId: {
                type: "number",
                description: "The unique ID of the client to update",
            },
            clientName: {
                type: "string",
                description: "Client name when ID is unknown (e.g., '이수진')",
            },
            name: {
                type: "string",
                description: "Client's full name",
            },
            phone: {
                type: "string",
                description: "Client's phone number",
            },
            address: {
                type: "string",
                description: "Client's address",
            },
            primaryEmployeeId: {
                type: "number",
                description: "ID of the primary caretaker employee",
            },
            secondaryEmployeeId: {
                type: "number",
                description: "ID of the secondary caretaker employee",
            },
            type: {
                type: "string",
                description: "Voucher type",
            },
            duration: {
                type: "number",
                description: "Service duration in days",
            },
            startDate: {
                type: "string",
                description: "Service start date (YYYY-MM-DD format)",
            },
            endDate: {
                type: "string",
                description: "Service end date (YYYY-MM-DD format)",
            },
            serviceStatus: {
                type: "string",
                enum: ["pre_booking", "waiting", "replacement_requested", "active", "completed", "terminated"],
                description: "Client service status: pre_booking, waiting, replacement_requested, active, completed, or terminated",
            },
        },
        required: [],
    },
};

export const deleteClientSchema: FunctionDeclaration = {
    name: "deleteClient",
    description: "Delete a client record. This action is irreversible. Requires confirmation before execution.",
    parameters: {
        type: "object",
        properties: {
            clientId: {
                type: "number",
                description: "The unique ID of the client to delete",
            },
            clientName: {
                type: "string",
                description: "Client name when ID is unknown (e.g., '최민지')",
            },
        },
        required: [],
    },
};

export const getClientsByFilterSchema: FunctionDeclaration = {
    name: "getClientsByFilter",
    description: `Get clients by predefined filter categories.

USE THIS TOOL when user asks about:
- 계약서 미발송 산모: "계약서 안 보낸 산모", "계약서 미발송", "eformsign 안 보낸 사람"
- 곧 시작하는 산모: "곧 시작하는 산모", "시작 예정", "입소 예정"
- 곧 종료되는 산모: "곧 종료되는 산모", "종료 예정", "퇴소 예정"
 - 계약 미완료 산모: "계약 미완료", "서명 안 한 산모", "계약서 미서명"
  - 계약서 발송 후 대기: "계약서 발송 후 대기", "발송 후 대기", "서명 대기"

SYNONYMS: 산모 = 이용자 = 고객 = 엄마 = client

Returns: List of clients matching the filter with their details`,
    parameters: {
        type: "object",
        properties: {
            filter: {
                type: "string",
                enum: ["no-contract", "starting-soon", "ending-soon", "incomplete-contracts"],
                description: `Filter type:
- no-contract: 계약서 미발송 산모 (contract not sent)
- starting-soon: 곧 시작하는 산모 (starting within 7 days)
- ending-soon: 곧 종료되는 산모 (ending within 7 days)
- incomplete-contracts: 계약 미완료 산모 (contract sent but not signed)`,
            },
        },
        required: ["filter"],
    },
};

export const terminateClientServiceSchema: FunctionDeclaration = {
    name: "terminateClientService",
    description: `Terminate a client's service. Requires confirmation.

USE THIS TOOL when user asks:
- "산모 서비스 종료해줘", "이용자 퇴소 처리", "서비스 중단"

SYNONYMS: 산모 = 이용자 = 고객 = 엄마 = client`,
    parameters: {
        type: "object",
        properties: {
            clientId: {
                type: "number",
                description: "The unique ID of the client (산모/이용자 ID)",
            },
            clientName: {
                type: "string",
                description: "Client name when ID is unknown (e.g., '정하은')",
            },
            reason: {
                type: "string",
                description: "Reason for termination (종료 사유)",
            },
        },
        required: [],
    },
};

export const requestEmployeeReplacementSchema: FunctionDeclaration = {
    name: "requestEmployeeReplacement",
    description: `Request employee replacement for a client. Requires confirmation.

USE THIS TOOL when user asks:
- "관리사 교체해줘", "이모님 바꿔줘", "제공인력 교체 요청"

SYNONYMS: 
- 산모 = 이용자 = 고객 = 엄마 = client
- 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            clientId: {
                type: "number",
                description: "The unique ID of the client (산모/이용자 ID)",
            },
            clientName: {
                type: "string",
                description: "Client name when ID is unknown (e.g., '김서연')",
            },
            newPrimaryEmployeeId: {
                type: "number",
                description: "ID of the new primary employee (새 담당 관리사 ID)",
            },
            newPrimaryEmployeeName: {
                type: "string",
                description: "New primary employee name when ID is unknown",
            },
            newSecondaryEmployeeId: {
                type: "number",
                description: "ID of the new secondary employee (새 보조 관리사 ID, optional)",
            },
        },
        required: [],
    },
};

export const clientTools: FunctionDeclaration[] = [
    searchClientsSchema,
    getClientSchema,
    createClientSchema,
    updateClientSchema,
    deleteClientSchema,
    getClientsByFilterSchema,
    terminateClientServiceSchema,
    requestEmployeeReplacementSchema,
];
