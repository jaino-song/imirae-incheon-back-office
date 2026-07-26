"use client";

interface ToolIndicatorProps {
    toolName: string | null;
    isExecuting: boolean;
}

// Map tool names to friendly Korean labels
const TOOL_LABELS: Record<string, string> = {
    searchClients: "산모 검색 중",
    getClient: "산모 정보 조회 중",
    getClientsByFilter: "산모 필터 조회 중",
    createClient: "산모 등록 중",
    updateClient: "산모 정보 수정 중",
    deleteClient: "산모 삭제 중",
    terminateClientService: "서비스 종료 처리 중",
    requestEmployeeReplacement: "관리사 교체 요청 중",
    searchEmployees: "관리사 검색 중",
    getEmployee: "관리사 정보 조회 중",
    getAvailableEmployees: "가용 관리사 조회 중",
    getEmployeesByWorkArea: "지역별 관리사 조회 중",
    getEmployeesByGrade: "등급별 관리사 조회 중",
    createEmployee: "관리사 등록 중",
    updateEmployee: "관리사 정보 수정 중",
    deleteEmployee: "관리사 삭제 중",
    changeEmployeeAvailability: "관리사 상태 변경 중",
    listSchedules: "스케줄 조회 중",
    getSchedulesByEmployee: "관리사 스케줄 조회 중",
    listAvailableTemplates: "계약서 템플릿 조회 중",
    createAndSendContract: "계약서 발송 중",
    getContractStatus: "계약서 상태 확인 중",
    listAllContracts: "계약서 목록 조회 중",
    listVoucherPrices: "바우처 가격 조회 중",
    getVoucherPriceByType: "바우처 유형별 가격 조회 중",
    listBankAccounts: "계좌 정보 조회 중",
    getBankAccountByArea: "지역별 계좌 조회 중",
    getMessages: "메시지 조회 중",
    createMessage: "메시지 생성 중",
    updateMessage: "메시지 수정 중",
    deleteMessage: "메시지 삭제 중",
    getDashboardStats: "대시보드 통계 조회 중",
};

function getToolLabel(toolName: string | null): string {
    if (!toolName) return "처리 중";
    return TOOL_LABELS[toolName] || `${toolName} 실행 중`;
}

export function ToolIndicator({ toolName, isExecuting }: ToolIndicatorProps) {
    if (!isExecuting) return null;

    return (
        <div
            data-component="desktop_chat_page_tool-indicator"
            data-testid="tool-indicator"
            className="flex items-center gap-2 py-2 px-4 bg-muted/50 rounded mb-2"
        >
            {/* Animated dots */}
            <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                    <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
                        style={{
                            animationDelay: `${i * 200}ms`,
                            animationDuration: "1.4s",
                        }}
                    />
                ))}
            </div>
            <p className="text-sm text-muted-foreground">
                {getToolLabel(toolName)}...
            </p>
        </div>
    );
}
