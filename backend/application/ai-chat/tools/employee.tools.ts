import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const searchEmployeesSchema: FunctionDeclaration = {
    name: "searchEmployees",
    description: `Search for employees (제공인력/관리사/이모님) by name or phone.

USE THIS TOOL when user asks to:
- Find employees: "김영희 관리사 찾아줘", "이모님 검색", "제공인력 목록"
- Search by phone: "010-1234-5678 이모님 누구야"
- Find available staff: "배정 가능한 관리사", "일할 수 있는 이모님"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee = caregiver = staff

Returns: List of employees with id, name, phone, grade, openToNextWork (배정 가능 여부)`,
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "Search query - name (이름) or phone (전화번호)",
            },
            openToNextWork: {
                type: "boolean",
                description: "Filter by availability (배정 가능 여부) - true for available only",
            },
        },
        required: ["query"],
    },
};

export const getEmployeeSchema: FunctionDeclaration = {
    name: "getEmployee",
    description: `Get detailed information about a specific employee (관리사/이모님) by ID.

USE THIS TOOL when user asks:
- "관리사 ID 5번 정보"
- "이모님 3번 상세 정보"
- "그 제공인력 정보 더 자세히"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee

Returns: Full employee details including contact, grade, work areas, availability`,
    parameters: {
        type: "object",
        properties: {
            employeeId: {
                type: "number",
                description: "The unique ID of the employee (관리사/이모님 ID)",
            },
        },
        required: ["employeeId"],
    },
};

export const createEmployeeSchema: FunctionDeclaration = {
    name: "createEmployee",
    description: `Create a new employee (관리사/이모님) record. Requires confirmation.

USE THIS TOOL when user asks:
- "새 관리사 등록해줘", "이모님 추가해줘", "제공인력 등록"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Employee's full name (이름)",
            },
            phone: {
                type: "string",
                description: "Employee's phone number (전화번호)",
            },
            grade: {
                type: "string",
                description: "Employee's grade/level (등급)",
            },
            workArea: {
                type: "string",
                description: "Comma-separated list of work areas (근무 가능 지역)",
            },
            openToNextWork: {
                type: "boolean",
                description: "Whether available for new assignments (배정 가능 여부)",
            },
            companyRegisteredDate: {
                type: "string",
                description: "Date joined company (입사일, YYYY-MM-DD format)",
            },
        },
        required: ["name", "phone", "grade"],
    },
};

export const updateEmployeeSchema: FunctionDeclaration = {
    name: "updateEmployee",
    description: `Update an existing employee (관리사/이모님) information. Requires confirmation.

USE THIS TOOL when user asks:
- "관리사 정보 수정해줘", "이모님 전화번호 변경", "제공인력 등급 바꿔줘"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            employeeId: {
                type: "number",
                description: "The unique ID of the employee (관리사/이모님 ID)",
            },
            name: {
                type: "string",
                description: "Employee's full name (이름)",
            },
            phone: {
                type: "string",
                description: "Employee's phone number (전화번호)",
            },
            grade: {
                type: "string",
                description: "Employee's grade/level (등급)",
            },
            workArea: {
                type: "string",
                description: "Comma-separated list of work areas (근무 가능 지역)",
            },
            openToNextWork: {
                type: "boolean",
                description: "Whether available for new assignments (배정 가능 여부)",
            },
        },
        required: ["employeeId"],
    },
};

export const deleteEmployeeSchema: FunctionDeclaration = {
    name: "deleteEmployee",
    description: `Delete an employee (관리사/이모님) record. IRREVERSIBLE. Requires confirmation.

USE THIS TOOL when user asks:
- "관리사 삭제해줘", "이모님 정보 지워줘", "제공인력 삭제"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            employeeId: {
                type: "number",
                description: "The unique ID of the employee (관리사/이모님 ID)",
            },
        },
        required: ["employeeId"],
    },
};

export const getAvailableEmployeesSchema: FunctionDeclaration = {
    name: "getAvailableEmployees",
    description: `Get all employees available for new assignments.

USE THIS TOOL when user asks:
- "배정 가능한 관리사", "일할 수 있는 이모님", "가용 인력", "빈 관리사"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee

Returns: List of employees with openToNextWork=true`,
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};

export const getEmployeesByWorkAreaSchema: FunctionDeclaration = {
    name: "getEmployeesByWorkArea",
    description: `Get employees who work in a specific area.

USE THIS TOOL when user asks:
- "강남구 관리사", "인천 이모님", "서울 제공인력"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            workArea: {
                type: "string",
                description: "Work area to filter by (근무 지역, e.g., '강남구', '인천')",
            },
        },
        required: ["workArea"],
    },
};

export const getEmployeesByGradeSchema: FunctionDeclaration = {
    name: "getEmployeesByGrade",
    description: `Get employees by grade level.

USE THIS TOOL when user asks:
- "프리미엄 관리사", "베스트 이모님", "스탠다드 관리사", "등급별 관리사"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            grade: {
                type: "string",
                description: "Grade level to filter by (등급, e.g., '프리미엄', '베스트', '스탠다드')",
            },
        },
        required: ["grade"],
    },
};

export const changeEmployeeAvailabilitySchema: FunctionDeclaration = {
    name: "changeEmployeeAvailability",
    description: `Change an employee's availability status. Requires confirmation.

USE THIS TOOL when user asks:
- "관리사 배정 가능으로 변경", "이모님 휴무 처리", "제공인력 상태 변경"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            employeeId: {
                type: "number",
                description: "The unique ID of the employee (관리사/이모님 ID)",
            },
            available: {
                type: "boolean",
                description: "true = 배정 가능, false = 배정 불가",
            },
        },
        required: ["employeeId", "available"],
    },
};

export const employeeTools: FunctionDeclaration[] = [
    searchEmployeesSchema,
    getEmployeeSchema,
    createEmployeeSchema,
    updateEmployeeSchema,
    deleteEmployeeSchema,
    getAvailableEmployeesSchema,
    getEmployeesByWorkAreaSchema,
    getEmployeesByGradeSchema,
    changeEmployeeAvailabilitySchema,
];
