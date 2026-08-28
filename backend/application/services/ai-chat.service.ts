import { Injectable, Inject, Logger } from "@nestjs/common";
import { ChatMessage, GeminiStreamChunk, FunctionDeclaration, FunctionCall } from "infrastructure/api/gemini-chat.gateway";
import { ToolExecutorService, LegacyChatToolContext, ToolExecutionResult } from "application/ai-chat/tool-executor.service";
import { CHAT_SESSION_REPOSITORY, IChatSessionRepository } from "domain/repositories/chat-session.repository.interface";
import { ChatSessionEntity, ChatMessage as SessionMessage } from "domain/entities/chat-session.entity";
import { allTools } from "application/ai-chat/tools";
import { GEMINI_GATEWAY } from "module/ai-chat.tokens";
import {
    LegacyChatConfirmationService,
    LegacyChatConfirmationToken,
    redactSensitiveLegacyChatContent,
} from "application/ai-chat/legacy-chat-confirmation.service";

/**
 * Interface for Gemini gateway implementations.
 * Both GeminiChatGateway and VercelGeminiGateway implement this interface.
 */
export interface IGeminiGateway {
    chat(
        messages: ChatMessage[],
        tools?: FunctionDeclaration[],
    ): Promise<{ text?: string; functionCall?: FunctionCall }>;

    chatStream(
        messages: ChatMessage[],
        tools?: FunctionDeclaration[],
        callerSignal?: AbortSignal,
    ): AsyncGenerator<GeminiStreamChunk>;

    sendFunctionResult(
        messages: ChatMessage[],
        functionName: string,
        result: unknown,
        tools?: FunctionDeclaration[],
    ): Promise<{ text?: string; functionCall?: FunctionCall }>;
}

const SYSTEM_PROMPT = `
<role>
you are gemini, a friendly and helpful ai assistant for imirae incheon (인천 아이미래) back office.
you help staff manage postpartum care services - clients (산모), caregivers (관리사), contracts, schedules, and more.
respond in the same language as the user (korean or english).
</role>

<personality>
- friendly, warm, and professional - like a helpful coworker
- proactive: suggest related actions when appropriate
- concise but complete - don't over-explain
- when greeting, be warm: "안녕하세요! 무엇을 도와드릴까요?" or "hi! how can i help you today?"
- use occasional emojis for warmth (sparingly): ✅, 📋, 👋
</personality>

<capabilities>
i can help you with:

**산모 (client) management:**
- search and view client information
- register new clients, update details, or remove records
- check clients with ending services, pending contracts, or starting soon
- terminate services or request caregiver replacement

**관리사 (caregiver) management:**
- search caregivers by name, area, or grade
- find available caregivers for assignment
- register, update, or manage caregiver status
- view caregiver schedules

**contracts & documents:**
- send contracts via eformsign
- check contract status and list all contracts
- view available contract templates

**information & stats:**
- dashboard statistics (총 현황)
- voucher pricing (바우처 가격표)
- masked bank account references by the current branch (owner/admin only)
- schedule overview

**messages:**
- view, create, update, or delete system messages
</capabilities>

<terminology>
treat these as synonyms:

**IMPORTANT - distinguish these two groups carefully:**
**산모 (Client) - 서비스를 받는 이용자:**
- 산모 = 이용자 = 고객 = 엄마 = client = 서비스 받는 사람
- 임산부 = 임신 중인 사람 = 신부
- 바우처 이용고객 = 일반 고객 = 자부담 고객

**제공인력 (Employee) - 서비스를 제공하는 관리사:**
- 제공인력 = 관리사 = 이모님 = 이모 = 직원 = employee = caregiver = staff
- 돌보미 = 근무자 = worker
- 시어머니 = 친정 엄마 (colloquial terms for caregivers)
- 산모신생아건강관리도우미 (official term)

**"제공인력" means EMPLOYEES/CAREGIVERS, NOT clients!**
- when user asks about "제공인력", use employee-related tools (searchEmployees, getDashboardStats for employee count, etc.)
- when user asks about "산모" or "고객", use client-related tools

other synonyms:
- 계약 = 계약서 = contract
- 서비스 계약서 = 산후도우미 계약서 = 서비스 이용 계약서
- 바우처 = voucher = 이용권 = 서비스 유형
- 등급 = grade (프리미엄, 베스트, 스탠다드)
- 지역 = 구역 = 인천 = area
</terminology>

<guidelines>
1. **language**: match the user's language (korean ↔ english)
   - if user mixes korean and english, prefer Korean for response

2. **ACTION FIRST - ALWAYS use tools, never just ask questions**:
   - when you can help, CALL THE TOOL IMMEDIATELY
   - DO NOT ask clarifying questions if you can infer intent
   - if missing info, call tool with what you have and let the user refine
   - for update/delete/terminate/replacement requests, call the target action tool first with available identifiers (e.g., clientName); the server returns a confirmation intent for the user to approve
   - for operational requests (counts/search/create/update/delete/contracts), the first response MUST include at least one tool call before any conversational text

3. **intent-first mappings** (use these tools for these expressions):

   **Dashboard/Stats:**
   - "몇 명?" / "총 현황" / "사람 몇이야?" / "통계" → getDashboardStats
   - "오늘 어때?" / "지금 상황" / "현황" → getDashboardStats
   - "stats" / "overview" / "summary" / "how many" → getDashboardStats
   - "현재 등록된 제공인력은 몇명이야?" / "직원 수 알려줘" → getDashboardStats

   **Available Employees:**
   - "쉬는 사람?" / "빈 관리사?" / "빈 이모님" / "가용 인력" → getAvailableEmployees
   - "누가 쉬어?" / "배정 가능한 사람" / "배정 가능 인력" → getAvailableEmployees
   - "근무 가능 직원" / "available staff" / "free caregiver" → getAvailableEmployees

   **Work Area:**
   - "인천 쪽 이모님" / "서울 쪽 관리사" / "지역별 관리사" → getEmployeesByWorkArea
   - "어디서 일해?" / "근무 지역" → getEmployeesByWorkArea

   **Client Filters:**
   - "이번 주 끝나는 산모" / "종료 예정" → getClientsByFilter(filter: "ending-soon")
   - "곧 시작하는" / "시작 예정" → getClientsByFilter(filter: "starting-soon")
   - "계약서 미발송" / "미발송" / "계약서 안 보낸" → getClientsByFilter(filter: "no-contract")
   - "발송 후 대기" / "서명 대기" / "미완료" / "계약서 보냈는데 아직" → getClientsByFilter(filter: "incomplete-contracts")

   **Contracts:**
   - "서비스 계약서 보내줘" / "산후도우미 계약서 보내줘" → createAndSendContract
   - "계약서 상태" / "서명 됐어?" / "contract status" → getContractStatus
   - "계약서 양식" / "템플릿" → listAvailableTemplates
   - ⚠️ "계약서" alone → ask which type (service contract vs employment contract)

   **Replacement:**
   - "바꿔줘" / "교체" / "이모님 변경" → requestEmployeeReplacement
   - "다른 이모님으로" / "새 관리사" / "replace" → requestEmployeeReplacement

   **Search:**
   - "산모 찾아줘" / "find client" / "search client" → searchClients
   - "관리사 검색" / "find caregiver" / "search employee" → searchEmployees

   **Other:**
   - "돈 어디로?" / "계좌" / "입금" → listBankAccounts
   - "얼마야?" / "가격" / "비용" → listVoucherPrices
   - "일정" / "스케줄" / "배정 현황" / "근무 일정" → listSchedules
   - "프리미엄" / "베스트" / "스탠다드" / "등급별" → getEmployeesByGrade
   - "전화번호 변경" / "번호 수정" / "연락처 바꿔줘" → updateClient (use clientName when ID is unknown)

4. **confirmation for changes**: for create, update, delete operations:
   - first call to show what will happen; wait for the server-issued confirmation intent
   - the user must invoke the explicit confirmation action ("네", "확인", "yes" alone is not authority)
   - then use the explicit confirmation action returned by the server

5. **formatting**: use markdown tables for lists and data
   | 이름 | 연락처 | 상태 |
   |------|--------|------|

6. **counts**: for "몇 명?", "몇 개?", "총 몇?" → use getDashboardStats

7. **be helpful, not restrictive**: 
   - if you can help with something, do it
   - if you genuinely can't help, suggest what you can do instead
</guidelines>

<tool_selection_rules>
**CRITICAL: When to use each tool category**

**Counting/Stats (always use getDashboardStats for counts):**
- "산모 몇 명?" → getDashboardStats (NOT searchClients)
- "관리사 총 몇 분?" → getDashboardStats
- "현황" / "통계" → getDashboardStats

**Client CRUD:**
- "새 산모 등록" / "산모 추가" → createClient
- "산모 정보 수정" → updateClient
- "산모 전화번호 변경" / "연락처 수정" → updateClient(clientName=..., phone=...)
- "산모 삭제" → deleteClient

**Employee by Grade:**
- "프리미엄 관리사" / "베스트 관리사" / "스탠다드 관리사" / "등급별" → getEmployeesByGrade

**Employee by Area:**
- "인천 관리사" / "연수구" / "지역별" → getEmployeesByWorkArea

**Available Employees:**
- "쉬는" / "빈" / "가용" / "available" → getAvailableEmployees

**Schedules:**
- "일정" / "스케줄" / "배정" / "근무" → listSchedules

**Bank Accounts (owner/admin only; masked last four digits):**
- "계좌" / "돈" / "입금" / "송금" → listBankAccounts or getBankAccountByArea

**Message Templates:**
- "메시지 조회" / "템플릿 보기" → getMessages
- "새 메시지" / "메시지 만들어" → createMessage
- "메시지 수정" → updateMessage
- "메시지 삭제" → deleteMessage

**Contracts:**
- "계약서 양식" / "템플릿 목록" → listAvailableTemplates
- "계약서 발송" → createAndSendContract
- "계약서 상태" → getContractStatus
</tool_selection_rules>

<multi_step_workflows>
**CRITICAL: Multi-step operations that require sequential tool calls**

**Contract Sending (계약서 발송):**
When user says "박지영 산모에게 계약서 발송해줘" or similar:
1. FIRST call searchClients(query="박지영") to find the client and get their clientId
2. From the search result, extract the client's area for areaId
3. THEN call createAndSendContract(clientId=X, areaId="incheon") and present the server-issued confirmation intent
4. Wait for the user to invoke the explicit confirmation action

Example flow:
User: "박지영 산모에게 계약서 보내줘"
Step 1: [call searchClients(query="박지영")]
Step 2: Found clientId=5, area=인천
Step 3: [call createAndSendContract(clientId=5, areaId="incheon")]
Step 4: "박지영 산모(ID: 5)에게 계약서를 발송할까요?"
User: "네"
Step 5: [invoke the explicit confirmation action with the returned intent and nonce]

**Contract Status Check (계약서 상태 확인):**
When user asks "이수진 산모 계약서 상태 확인":
1. FIRST call searchClients(query="이수진") to find clientId
2. THEN call getContractStatus(clientId=X)

**Employee Replacement (관리사 교체):**
When user asks "김서연 산모 관리사 교체해줘":
1. Prefer direct action call first: requestEmployeeReplacement(clientName="김서연")
2. If user specifically asks for replacement candidates, call getAvailableEmployees and then retry with selected 관리사

**Client Updates/Deletes:**
When user says "이수진 산모 삭제해줘":
1. Prefer direct action call: deleteClient(clientName="이수진")
2. If the tool reports ambiguous results, ask user to choose by ID and retry

**Employee Updates/Deletes:**
When user says "김영자 이모님 삭제해줘":
1. FIRST call searchEmployees(query="김영자") to find employeeId
2. THEN call deleteEmployee(employeeId=X)

**Message Updates/Deletes:**
When user says "입소 안내 메시지 삭제해줘":
1. FIRST call getMessages() to list all messages
2. Find the matching message by name
3. THEN call deleteMessage(messageId=X)

**REMEMBER: Prefer the target action tool. If ID is unknown, pass name fields (clientName/newPrimaryEmployeeName) or run a lookup only when needed.**
</multi_step_workflows>

<examples>
**example 1: greeting**
user: "안녕"
assistant: "안녕하세요! 👋 무엇을 도와드릴까요? 산모/관리사 조회, 계약서 발송, 현황 확인 등 다양한 업무를 도와드릴 수 있어요."

**example 2: finding available caregivers**
user: "쉬는 관리사 있어?"
[call getAvailableEmployees]
assistant: "현재 배정 가능한 관리사 목록이에요:
| 이름 | 등급 | 지역 | 연락처 |
|------|------|------|--------|
| 김영희 | a | 연수구 | 010-1234-5678 |
..."

**example 3: bank account query (indirect)**
user: "돈 어디로?"
[call listBankAccounts]
assistant: "입금 계좌 정보에요:
| 지역 | 은행 | 계좌번호(끝 4자리) |
|------|------|----------|
..."

**example 4: counting (use getDashboardStats)**
user: "사람 몇이야?"
[call getDashboardStats]
assistant: "현재 현황이에요:
- 산모: XX명
- 관리사: XX명
..."

**example 5: grade-based query**
user: "프리미엄 분들 알려줘"
[call getEmployeesByGrade with grade="프리미엄"]
assistant: "프리미엄 관리사 목록이에요:
| 이름 | 지역 | 연락처 |
..."

**example 6: schedule query**
user: "배정 현황"
[call listSchedules]
assistant: "현재 배정 현황이에요:
..."

**example 7: out-of-scope request**
user: "오늘 날씨 어때?"
assistant: "날씨 정보는 제가 확인하기 어려워요. 😅 대신 산모/관리사 관리, 계약서 발송, 현황 조회 등을 도와드릴 수 있어요! 혹시 다른 업무 관련해서 도움이 필요하신가요?"
</examples>

<available_tools>
**산모**: searchClients, getClient, getClientsByFilter, createClient, updateClient, deleteClient, terminateClientService, requestEmployeeReplacement
**관리사**: searchEmployees, getEmployee, getAvailableEmployees, getEmployeesByWorkArea, getEmployeesByGrade, createEmployee, updateEmployee, deleteEmployee, changeEmployeeAvailability
**스케줄**: listSchedules, getSchedulesByEmployee
**계약서**: listAvailableTemplates, createAndSendContract, getContractStatus, listAllContracts
**바우처/가격**: listVoucherPrices, getVoucherPriceByType
**계좌**: listBankAccounts, getBankAccountByArea
**메시지**: getMessages, createMessage, updateMessage, deleteMessage
**통계**: getDashboardStats
</available_tools>`;

const MAX_TOOL_CALLS_PER_TURN = 5;
const MAX_CONTEXT_MESSAGES = 24;
const STREAM_REDACTION_HOLDBACK = 192;

/**
 * Gemini may split a sensitive account number across arbitrary text chunks.
 * Keep a bounded suffix until the next chunk (or stream completion) so the
 * redactor always sees the complete account-labelled value before yielding it.
 */
class LegacyChatStreamRedactor {
    private rawContent = "";
    private emittedLength = 0;

    append(content: string): string {
        this.rawContent += content;
        return this.emit(false);
    }

    flush(): string {
        return this.emit(true);
    }

    private emit(force: boolean): string {
        const safeContent = redactSensitiveLegacyChatContent(this.rawContent);
        const targetLength = force
            ? safeContent.length
            : Math.max(0, safeContent.length - STREAM_REDACTION_HOLDBACK);

        if (targetLength <= this.emittedLength) {
            return "";
        }

        const delta = safeContent.slice(this.emittedLength, targetLength);
        this.emittedLength = targetLength;
        return delta;
    }
}

type DashboardStatsData = {
    totalClients: number;
    totalEmployees: number;
    startingSoonCount: number;
    endingSoonCount: number;
    incompleteContractsCount: number;
    noContractCount: number;
};

export interface ChatStreamEvent {
    type: 'chunk' | 'tool_call' | 'confirmation' | 'done' | 'error';
    content?: string;
    toolName?: string;
    toolStatus?: string;
    confirmationMessage?: string;
    confirmationIntentId?: string;
    confirmationNonce?: string;
    confirmationExpiresAt?: string;
    sessionId?: string;
    error?: string;
}

@Injectable()
export class AIChatService {
    private readonly logger = new Logger(AIChatService.name);

    constructor(
        @Inject(GEMINI_GATEWAY)
        private readonly geminiGateway: IGeminiGateway,
        private readonly toolExecutor: ToolExecutorService,
        @Inject(CHAT_SESSION_REPOSITORY)
        private readonly sessionRepository: IChatSessionRepository,
        private readonly confirmationService?: LegacyChatConfirmationService,
    ) { }

    async *chatStream(
        sessionId: string | undefined,
        userId: string,
        userMessage: string,
        branchid: string,
        callerSignal?: AbortSignal,
        actor?: Pick<LegacyChatToolContext, "globalRole" | "branchRole">,
    ): AsyncGenerator<ChatStreamEvent> {
        let session = sessionId
            ? await this.sessionRepository.findById(sessionId, userId, branchid)
            : null;

        if (sessionId && !session) {
            throw new Error("Session not found or expired");
        }

        if (!session) {
            session = ChatSessionEntity.create(userId, branchid);
            session = await this.sessionRepository.create(session);
            this.logger.log(`Created new session: ${session.id} for user: ${userId}`);
        }

        session.addMessage('user', redactSensitiveLegacyChatContent(userMessage));

        if (this.shouldDirectDashboardStats(userMessage)) {
            yield { type: 'tool_call', toolName: 'getDashboardStats', toolStatus: 'executing' };
            const dashboardResult = await this.toolExecutor.execute({
                userId,
                branchId: branchid,
                sessionId: session.id,
                ...actor,
            }, "getDashboardStats", {});

            if (dashboardResult.success && this.isDashboardStatsData(dashboardResult.data)) {
                const responseText = this.formatDashboardResponse(userMessage, dashboardResult.data);
                session.addMessage('assistant', responseText);
                await this.sessionRepository.update(session, userId, branchid);

                yield { type: 'chunk', content: responseText };
                yield { type: 'done', sessionId: session.id };
                return;
            }

            this.logger.warn(
                `Direct dashboard path failed for session ${session.id}: ${dashboardResult.error || "invalid stats payload"}`
            );
        }

        const messages = this.buildGeminiMessages(session.messages);
        let toolCallCount = 0;

        try {
            let continueLoop = true;

            while (continueLoop && toolCallCount < MAX_TOOL_CALLS_PER_TURN) {
                continueLoop = false;
                let accumulatedText = '';

                let retryCount = 0;
                const MAX_RETRIES = 1;

                while (retryCount <= MAX_RETRIES) {
                    const streamRedactor = new LegacyChatStreamRedactor();
                    try {
                        for await (const chunk of this.geminiGateway.chatStream(messages, allTools, callerSignal)) {
                            if (chunk.type === 'text' && chunk.content) {
                                const safeContent = streamRedactor.append(chunk.content);
                                accumulatedText += safeContent;
                                if (safeContent) {
                                    yield { type: 'chunk', content: safeContent };
                                }
                            }

                            if (chunk.type === 'function_call' && chunk.functionCall) {
                                const safeTail = streamRedactor.flush();
                                if (safeTail) {
                                    accumulatedText += safeTail;
                                    yield { type: 'chunk', content: safeTail };
                                }

                                toolCallCount++;
                                const { name, args } = chunk.functionCall;

                                yield { type: 'tool_call', toolName: name, toolStatus: 'executing' };

                                const result = await this.toolExecutor.execute({
                                    userId,
                                    branchId: branchid,
                                    sessionId: session.id,
                                    ...actor,
                                }, name, args);

                                if (result.requiresConfirmation) {
                                    yield {
                                        type: 'confirmation',
                                        confirmationMessage: result.confirmationMessage,
                                        confirmationIntentId: result.confirmationIntentId,
                                        confirmationNonce: result.confirmationNonce,
                                        confirmationExpiresAt: result.confirmationExpiresAt,
                                        sessionId: session.id,
                                    };

                                    session.addMessage('assistant', result.confirmationMessage || '');
                                    await this.sessionRepository.update(session, userId, branchid);

                                    yield { type: 'done', sessionId: session.id };
                                    return;
                                }

                                messages.push({
                                    role: 'model',
                                    content: JSON.stringify({ functionCall: { name, args } }),
                                });
                                messages.push({
                                    role: 'user',
                                    content: JSON.stringify({ functionResponse: { name, response: result } }),
                                });

                                continueLoop = true;
                                break;
                            }

                            if (chunk.type === 'done') {
                                const safeTail = streamRedactor.flush();
                                if (safeTail) {
                                    accumulatedText += safeTail;
                                    yield { type: 'chunk', content: safeTail };
                                }

                                const text = accumulatedText.trim();
                                if (!text) {
                                    continue;
                                }

                                const lastMessage = session.messages[session.messages.length - 1];
                                const isDuplicateAssistantMessage =
                                    lastMessage?.role === 'assistant' && lastMessage.content === accumulatedText;

                                if (!isDuplicateAssistantMessage) {
                                    session.addMessage('assistant', accumulatedText);
                                }
                            }

                            if (chunk.type === 'error') {
                                yield {
                                    type: 'error',
                                    error: chunk.error ? redactSensitiveLegacyChatContent(chunk.error) : chunk.error,
                                };
                                return;
                            }
                        }

                        const safeTail = streamRedactor.flush();
                        if (safeTail) {
                            accumulatedText += safeTail;
                            yield { type: 'chunk', content: safeTail };
                        }
                        break; // Success, exit retry loop
                    } catch (error) {
                        // Don't retry on user cancellation
                        if (error instanceof Error && error.name === 'AbortError') {
                            throw error;
                        }

                        if (retryCount < MAX_RETRIES) {
                            retryCount++;
                            this.logger.warn(`Gemini API error, retrying (attempt ${retryCount + 1})...`);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            continue;
                        }
                        throw error; // Re-throw after max retries
                    }
                }
            }

            if (toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
                this.logger.warn(`Max tool calls reached for session ${session.id}`);
            }

            await this.sessionRepository.update(session, userId, branchid);
            yield { type: 'done', sessionId: session.id };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Chat stream error: ${redactSensitiveLegacyChatContent(errorMessage)}`);
            yield { type: 'error', error: redactSensitiveLegacyChatContent(errorMessage) };
        }
    }

    async getSession(sessionId: string, userId: string, branchId: string): Promise<ChatSessionEntity | null> {
        return this.sessionRepository.findById(sessionId, userId, branchId);
    }

    async deleteSession(sessionId: string, userId: string, branchId: string): Promise<void> {
        await this.sessionRepository.delete(sessionId, userId, branchId);
    }

    async persistMessages(
        sessionId: string | undefined,
        userId: string,
        userMessage: string,
        assistantContent: string,
        branchId: string,
    ): Promise<{ sessionId: string }> {
        let session = sessionId
            ? await this.sessionRepository.findById(sessionId, userId, branchId)
            : null;

        if (sessionId && !session) {
            throw new Error("Session not found or expired");
        }

        if (!session) {
            session = ChatSessionEntity.create(userId, branchId);
            session = await this.sessionRepository.create(session);
            this.logger.log(`Created new session for persist: ${session.id} for user: ${userId}`);
        }

        session.addMessage('user', redactSensitiveLegacyChatContent(userMessage));
        session.addMessage('assistant', redactSensitiveLegacyChatContent(assistantContent));
        await this.sessionRepository.update(session, userId, branchId);

        this.logger.log(`Persisted messages to session: ${session.id}`);
        return { sessionId: session.id };
    }

    async confirmToolAction(
        userId: string,
        branchId: string,
        token: LegacyChatConfirmationToken,
        sessionId?: string,
    ): Promise<ToolExecutionResult> {
        if (!this.confirmationService) {
            throw new Error("Confirmation service is not configured");
        }

        return this.confirmationService.consumeAndExecute(
            { userId, branchId, sessionId },
            token,
            async (intent) => this.toolExecutor.executeAuthorized(
                {
                    userId,
                    branchId,
                    sessionId: intent.sessionId,
                },
                intent.toolName,
                intent.payload,
                intent,
            ),
        );
    }

    private buildGeminiMessages(sessionMessages: SessionMessage[]): ChatMessage[] {
        const messages: ChatMessage[] = [
            { role: 'system', content: SYSTEM_PROMPT },
        ];

        const recentMessages = sessionMessages.slice(-MAX_CONTEXT_MESSAGES);
        for (const msg of recentMessages) {
            messages.push({
                role: msg.role === 'user' ? 'user' : 'model',
                content: redactSensitiveLegacyChatContent(msg.content),
            });
        }

        return messages;
    }

    private shouldDirectDashboardStats(userMessage: string): boolean {
        const text = userMessage.toLowerCase();
        // Casual/status inquiries that imply dashboard
        const hasCasualStatusIntent = /(오늘\s*어때|지금\s*상황|상황\s*어때)/i.test(text);
        const hasDashboardIntent = /(현황|통계|대시보드|dashboard|overview|summary|stats)/i.test(text);
        const hasCountIntent = /(몇\s*명|몇명|몇\s*분|총\s*몇|인원|수\s*알려|count|how\s*many|number\s*of|total)/i.test(text);
        // Expanded domain entities including new synonyms
        const hasDomainEntity = /(산모|이용자|고객|엄마|임산부|신부|client|customer|제공인력|관리사|이모님|이모|직원|돌보미|근무자|employee|caregiver|staff|worker)/i.test(text);

        return hasCasualStatusIntent || hasDashboardIntent || (hasCountIntent && hasDomainEntity);
    }

    private isDashboardStatsData(value: unknown): value is DashboardStatsData {
        if (!value || typeof value !== "object") {
            return false;
        }
        const stats = value as Record<string, unknown>;
        return [
            "totalClients",
            "totalEmployees",
            "startingSoonCount",
            "endingSoonCount",
            "incompleteContractsCount",
            "noContractCount",
        ].every((key) => typeof stats[key] === "number");
    }

    private formatDashboardResponse(userMessage: string, stats: DashboardStatsData): string {
        const text = userMessage.toLowerCase();
        const isKorean = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(userMessage);
        const mentionsEmployees = /(제공인력|관리사|이모님|이모|직원|돌보미|근무자|employee|caregiver|staff|worker|시어머니|친정\s*엄마|산모신생아건강관리도우미)/i.test(text);
        const mentionsClients = /(산모|이용자|고객|엄마|임산부|임신\s*중인\s*사람|신부|바우처\s*이용고객|일반\s*고객|자부담\s*고객|client|customer)/i.test(text);

        if (isKorean) {
            if (mentionsEmployees && !mentionsClients) {
                return `현재 등록된 제공인력(관리사)은 총 **${stats.totalEmployees}명**입니다.`;
            }
            if (mentionsClients && !mentionsEmployees) {
                return `현재 등록된 산모는 총 **${stats.totalClients}명**입니다.`;
            }
            return [
                "현재 전체 현황입니다.",
                "",
                "| 항목 | 수량 |",
                "|------|------:|",
                `| 산모 | ${stats.totalClients}명 |`,
                `| 제공인력(관리사) | ${stats.totalEmployees}명 |`,
                `| 시작 예정 | ${stats.startingSoonCount}건 |`,
                `| 종료 예정 | ${stats.endingSoonCount}건 |`,
                `| 계약 미완료 | ${stats.incompleteContractsCount}건 |`,
                `| 계약 미발송 | ${stats.noContractCount}건 |`,
            ].join("\n");
        }

        if (mentionsEmployees && !mentionsClients) {
            return `There are **${stats.totalEmployees}** registered caregivers.`;
        }
        if (mentionsClients && !mentionsEmployees) {
            return `There are **${stats.totalClients}** registered clients.`;
        }
        return [
            "Current dashboard summary:",
            "",
            "| Metric | Count |",
            "|--------|------:|",
            `| Clients | ${stats.totalClients} |`,
            `| Caregivers | ${stats.totalEmployees} |`,
            `| Starting soon | ${stats.startingSoonCount} |`,
            `| Ending soon | ${stats.endingSoonCount} |`,
            `| Incomplete contracts | ${stats.incompleteContractsCount} |`,
            `| Contract not sent | ${stats.noContractCount} |`,
        ].join("\n");
    }
}
