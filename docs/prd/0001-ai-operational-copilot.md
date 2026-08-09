# PRD 0001: BabyJamJam AI Operational Copilot

| Field | Value |
|---|---|
| Status | Draft for review |
| Version | 0.1 |
| Product | BabyJamJam operational platform |
| Product owner | BabyJamJam product owner |
| Decision date | 2026-08-02 |
| Last updated | 2026-08-02 |
| Target delivery | Phased internal and production rollout |
| Primary applications | Desktop admin first, mobile admin subsequently |
| Default model | `gemini-3.5-flash-lite` |
| Related architecture decision | [`ADR 0001: Adopt a Capability Driven AI Operational Copilot`](../adr/0001-capability-driven-ai-operational-copilot.md) |
| Primary stakeholders | Product, engineering, operations, branch owners, branch administrators, staff |

## 1. Document purpose

This product requirements document defines the user experience, behavior, scope, safety controls, success criteria, rollout plan, and acceptance criteria for the BabyJamJam AI Operational Copilot.

The product will provide a ChatGPT inspired conversational interface that allows authorized BabyJamJam staff to inspect and operate application features using natural Korean or English instructions.

This document defines what the product must accomplish. The related ADR defines the binding architecture and technical boundaries used to implement it.

## 2. Executive summary

BabyJamJam will evolve its current AI chat prototype into a secure operational copilot that can understand staff requests, retrieve live application data, preserve conversational context, prepare actions, obtain explicit approval, and execute authorized tasks through the same canonical application use cases used by the normal product interface.

The experience will resemble the interaction model of ChatGPT:

1. A persistent conversation sidebar
2. A centered message thread
3. A floating multiline composer
4. User messages displayed as compact bubbles
5. Assistant responses displayed directly in the content column
6. Structured cards for entity selection, forms, approvals, progress, and results
7. Conversation history, search, rename, archive, and deletion
8. Responsive behavior for desktop and mobile

The assistant will use `gemini-3.5-flash-lite` as the default model. The model will interpret intent and decide which available capability to invoke, but it will not control authorization, tenant boundaries, approval policy, idempotency, or business rules.

The product will remain synchronized with application changes through domain owned capability definitions, generated capability manifests, compatibility checks, permission parity checks, UI renderer checks, evaluation coverage, and pull request impact reporting.

## 3. Background

BabyJamJam is a multi-application operational platform for postpartum care service management. Its application surface includes:

1. Dashboard and operational alerts
2. Consultation inquiries
3. Client management
4. Employee and caregiver management
5. Scheduling and assignment
6. Electronic contracts
7. Call intake and client drafts
8. Message templates, SMS delivery, scheduling, logs, and automation
9. Voucher and out-of-pocket pricing
10. File storage and document metadata
11. Service record administration
12. Notifications and settings
13. Statistics and analytics
14. User and branch administration
15. Website administration

The current AI chat prototype supports a limited set of manually registered tools. It relies on a large static prompt, a flat tool list, a custom tool loop, plain text message persistence, and text based confirmation.

The prototype demonstrates demand for a conversational operational interface, but it does not provide the correctness, coverage, security, or maintainability required for broad production use.

## 4. Problem statement

BabyJamJam staff currently navigate multiple pages and workflows to complete routine operational tasks. The current AI chat cannot reliably replace or assist these workflows because:

1. It often misunderstands instructions that differ from examples in its prompt.
2. It loses entity references across follow-up messages.
3. It exposes only a small portion of application functionality.
4. Confirmation is not bound to an immutable action.
5. Automatic retries can repeat external side effects.
6. Tool authorization can diverge from application authorization.
7. New product features do not automatically appear in the chatbot.
8. AI-specific workflows can drift from the canonical product workflows.
9. The current UI exposes technical tool names and inconsistent local wizards.
10. The end-to-end test suite does not exercise the real agentic tool loop.

The product needs a reliable conversational command surface that reduces operational friction without weakening the application’s safety, authorization, or tenant boundaries.

## 5. Product vision

BabyJamJam staff should be able to state an operational objective in natural language and have the assistant safely complete or guide the task using live application data.

Examples include:

1. “김민지 산모의 계약서 상태 확인해줘.”
2. “이번 주에 서비스가 끝나는 산모와 담당 관리사를 정리해줘.”
3. “박영숙 관리사를 다음 배정 가능으로 변경해줘.”
4. “상담 문의 중 아직 읽지 않은 항목을 요약해줘.”
5. “어제 통화에서 신규 문의로 분류된 초안을 보여줘.”
6. “김민지 산모에게 서비스 계약서를 발송할 준비를 해줘.”
7. “내일 오전 10시에 서비스 시작 안내 문자를 보내도록 예약해줘.”
8. “남동구 계약 관련 파일을 찾아줘.”
9. “이번 달 문의 추이를 설명해줘.”
10. “현재 화면에서 이 산모의 담당 관리사 일정도 같이 보여줘.”

The assistant will function as an operational copilot, not as an unrestricted autonomous operator.

## 6. Goals

### 6.1 Primary goals

1. Provide a ChatGPT inspired conversational interface that feels native to BabyJamJam.
2. Allow authorized staff to use natural Korean and English to inspect and operate product features.
3. Preserve conversational, branch, and entity context across multi-step tasks.
4. Execute application operations through canonical use cases shared with the normal UI.
5. Require explicit, structured approval for sensitive actions.
6. Prevent duplicate, unauthorized, cross-branch, or stale actions.
7. Expand capability coverage across the complete application over staged releases.
8. Keep capabilities synchronized with application changes through automated repository controls.
9. Make every agent decision and action observable, testable, and auditable.
10. Allow the underlying model provider to change without rewriting business logic.

### 6.2 Secondary goals

1. Reduce time spent navigating between pages.
2. Reduce repetitive data lookup and data entry.
3. Improve consistency in operational workflows.
4. Make complex application features easier for less technical staff to use.
5. Provide contextual explanations and recommended next actions.
6. Create a reusable capability foundation for future voice, mobile, and proactive experiences.

## 7. Non-goals

The initial product will not:

1. Operate as a public customer support chatbot.
2. Provide medical, legal, or financial advice.
3. Execute destructive or privileged actions without explicit approval.
4. Run autonomous background tasks without a separately designed workflow and user consent.
5. Use browser automation to control BabyJamJam’s own interface.
6. Replace every existing form or administrative page.
7. Expose every backend controller method directly to the model.
8. Allow the model to decide authorization or tenant access.
9. Train a custom foundation model.
10. Guarantee support for arbitrary external web research.
11. Provide voice input in the first release.
12. Provide native image generation or image editing.
13. Automatically act on incoming calls, inquiries, or messages without configured rules and approval policy.
14. Allow cross-branch operations from an ordinary branch-scoped session.
15. Maintain a separate AI implementation of business workflows.

## 8. Product principles

### 8.1 Actionable, not merely conversational

The assistant should complete supported tasks instead of only explaining where the user can complete them.

### 8.2 Safe by construction

Security, approval, tenant isolation, validation, and idempotency must be enforced by deterministic server logic.

### 8.3 One business workflow

The assistant and the ordinary application UI must invoke the same canonical use cases.

### 8.4 Transparent operation

The user should understand what the assistant is doing, what data it found, what will change, and whether an action succeeded.

### 8.5 Context without guessing

The assistant should reuse resolved context when reliable and request disambiguation when multiple records match.

### 8.6 Minimal interruption

The assistant should ask only for information that is genuinely required and cannot be safely inferred or retrieved.

### 8.7 Structured interaction

Forms, selections, approvals, results, and errors should use structured UI rather than forcing every workflow into prose.

### 8.8 Current by default

Operational answers must come from live application data. Product capability knowledge must come from the versioned capability registry. Policy answers must come from versioned knowledge sources.

### 8.9 Progressive authority

Read operations may execute immediately. Writes, external side effects, destructive actions, and privileged actions require progressively stronger controls.

### 8.10 Measurable behavior

Every capability must be evaluated for tool selection, argument accuracy, authorization, approval behavior, task completion, latency, and safety.

## 9. Users and personas

### 9.1 Product owner

The product owner oversees all branches, operational policies, application configuration, and system administration.

Needs:

1. Cross-domain operational visibility
2. Branch-aware analysis
3. Controlled privileged administration
4. Capability and model governance
5. Audit and safety visibility

### 9.2 Branch owner or administrator

The branch owner or administrator manages clients, employees, contracts, messages, schedules, files, and operational settings for one or more authorized branches.

Needs:

1. Faster record lookup
2. Fewer repetitive form interactions
3. Clear approval before side effects
4. Reliable branch isolation
5. Operational summaries and follow-up actions

### 9.3 Branch staff member

A staff member performs routine client, employee, contract, consultation, message, and document operations within an assigned branch.

Needs:

1. Simple natural language access to common tasks
2. Permission-aware guidance
3. Clear results and links to relevant records
4. Minimal technical terminology
5. Reliable handling of colloquial Korean terms

### 9.4 Auditor or reviewer

An authorized auditor or reviewer inspects completed actions, approvals, errors, and assistant traces.

Needs:

1. Immutable action history
2. User, branch, time, capability, and result attribution
3. Clear distinction between model recommendation and executed action
4. Redacted but useful operational traces

### 9.5 Caregiver or external service provider

Caregivers and external service providers are not initial direct users of the administrative copilot. Their existing no-login and mobile workflows remain separate unless a future product decision explicitly expands the audience.

## 10. Jobs to be done

### JTBD-001: Retrieve operational information

When I need information about a client, employee, contract, schedule, message, inquiry, call, file, or price, I want to ask naturally and receive current, branch-scoped results so that I do not have to navigate multiple pages.

### JTBD-002: Continue from conversational context

When I refer to “그 산모,” “두 번째 관리사,” or “방금 계약서,” I want the assistant to understand the previously selected entity so that I can complete a task naturally.

### JTBD-003: Complete a routine update

When a record needs a safe update, I want the assistant to prepare the exact change and ask for confirmation so that I can complete the task quickly without risking an unintended edit.

### JTBD-004: Execute an external side effect

When I need to send a contract or message, I want to review the recipient, content, timing, and consequences before execution so that I can prevent mis-sends and duplicates.

### JTBD-005: Resolve ambiguity

When several records match my request, I want the assistant to show a compact selection interface so that I can choose the correct record without restating the entire request.

### JTBD-006: Complete missing information

When a task requires data that is not available, I want a concise structured form so that I can provide all missing fields efficiently.

### JTBD-007: Understand operational state

When I ask what requires attention, I want a prioritized summary with direct actions so that I can respond quickly.

### JTBD-008: Trust application currency

When the application changes, I want the assistant to support the updated workflow or clearly state that it is not yet available so that I do not receive outdated instructions.

### JTBD-009: Recover from errors

When a provider or network error occurs, I want the assistant to explain what is known, whether anything already happened, and what I should do next so that I do not repeat a side effect.

### JTBD-010: Verify completed work

When an action completes, I want a structured result with the affected record, outcome, time, and next link so that I can verify the operation.

## 11. Success definition

The product is successful when authorized users can complete supported operational tasks through conversation with accuracy comparable to or better than the ordinary UI, while maintaining zero tolerance for cross-tenant access, unapproved sensitive actions, and duplicate side effects.

### 11.1 North star metric

**Successfully completed and verified operational tasks per weekly active assistant user.**

A task counts only when:

1. The correct capability was selected.
2. The correct branch and entity were used.
3. Required approval was obtained.
4. The canonical use case completed successfully.
5. The result was persisted and shown to the user.
6. No duplicate side effect occurred.

### 11.2 Guardrail metrics

1. Unauthorized action execution rate: `0`
2. Cross-branch data exposure rate: `0`
3. Unapproved sensitive action execution rate: `0`
4. Duplicate external side effect rate: `0`
5. Stale action execution rate: `0`
6. Personal data leakage into unrestricted logs: `0`

## 12. Scope strategy

The product scope is divided into a complete target state and phased releases.

### 12.1 Target state

The target product will support every chat-eligible BabyJamJam domain through one conversational interface.

A feature is chat-eligible when it can be safely represented as one of the following interaction modes:

1. Read
2. Explain
3. Draft
4. Execute after approval
5. Execute after strong approval
6. Structured form handoff
7. Navigation handoff

Not every internal method or endpoint is chat-eligible.

### 12.2 Release A: Safety and read foundation

Release A includes:

1. ChatGPT inspired shell
2. Conversation creation and history
3. User and branch scoped sessions
4. Structured message parts
5. Model migration to `gemini-3.5-flash-lite`
6. Capability registry
7. Dynamic capability selection
8. Client search and detail
9. Employee search and detail
10. Dashboard summaries
11. Schedule reads
12. Voucher and bank account reads
13. Contract status reads
14. Entity disambiguation
15. Navigation links
16. Deterministic agent tests
17. Capability manifest and CI drift checks

Release A is read-only in production.

### 12.3 Release B: Reversible writes

Release B includes:

1. Durable action proposals
2. Explicit approve and reject endpoints
3. Client creation and update
4. Employee creation and update
5. Availability changes
6. Message record and template maintenance
7. Revalidation and optimistic concurrency
8. Idempotency
9. Action audit history

### 12.4 Release C: External side effects

Release C includes:

1. Contract preparation and dispatch
2. SMS preview and delivery
3. Scheduled message delivery
4. Message delivery history and retry
5. Notification test actions
6. External provider uncertainty handling
7. Strong duplicate prevention

### 12.5 Release D: Expanded operational coverage

Release D includes:

1. Consultation inquiries
2. Call records
3. Client drafts
4. Message automation rules
5. File search and metadata management
6. Service record administration
7. Settings
8. Analytics explanations
9. Owner-only system administration
10. Website administration

### 12.6 Future release

Future releases may include:

1. Voice input
2. Mobile-first conversation history
3. Proactive operational suggestions
4. Background workflows with explicit subscription
5. Multi-branch comparative summaries for owners
6. Additional model providers
7. Specialist agents only when evaluations justify them

## 13. Capability coverage matrix

| Domain | Read | Draft | Write | External side effect | Initial release |
|---|---:|---:|---:|---:|---|
| Navigation and screen context | Yes | No | No | No | Release A |
| Dashboard and alerts | Yes | No | No | No | Release A |
| Clients | Yes | Yes | Yes | Indirect | Releases A and B |
| Employees | Yes | Yes | Yes | No | Releases A and B |
| Schedules | Yes | Yes | Yes | No | Releases A through D |
| Voucher prices | Yes | Yes | Controlled | No | Releases A and D |
| Bank accounts | Yes | No | Privileged | No | Releases A and D |
| Contracts | Yes | Yes | Controlled | Yes | Releases A and C |
| Message records and templates | Yes | Yes | Yes | No | Release B |
| Message delivery | Yes | Yes | Controlled | Yes | Release C |
| Message automation | Yes | Yes | Controlled | Yes | Release D |
| Consultations | Yes | Yes | Controlled | No | Release D |
| Calls and transcripts | Yes | Yes | Controlled | No | Release D |
| Client drafts | Yes | Yes | Yes | Indirect | Release D |
| Files and metadata | Yes | Yes | Yes | Download or delete | Release D |
| Service records | Yes | Yes | Controlled | Document finalization | Release D |
| Notifications | Yes | Yes | Controlled | Yes | Releases C and D |
| Settings | Yes | Yes | Privileged | Indirect | Release D |
| Statistics and analytics | Yes | No | No | No | Release D |
| User and branch administration | Yes | Yes | Privileged | No | Release D |
| Website administration | Yes | Yes | Privileged | Publication | Release D |

## 14. Experience architecture

### 14.1 Desktop layout

The desktop experience will contain:

1. A collapsible conversation sidebar
2. A centered primary message column
3. A floating composer anchored near the bottom of the viewport
4. Optional contextual panels rendered inside the message flow
5. Responsive behavior when the application sidebar is present

The main message column should target a readable maximum width between approximately 760 and 860 pixels.

### 14.2 Mobile layout

The mobile experience will contain:

1. A full-height conversation view
2. A conversation sidebar presented as a slide-over drawer
3. A safe-area-aware floating composer
4. Keyboard-aware scrolling
5. Structured cards that fit narrow screens without horizontal scrolling
6. Touch targets of at least 44 by 44 CSS pixels for primary controls

### 14.3 Conversation sidebar

The sidebar will support:

1. New conversation
2. Search conversations
3. Recent conversations grouped by date
4. Automatic conversation titles
5. Rename
6. Archive
7. Delete
8. Current branch indicator
9. New branch context warning after branch switch
10. User profile access

### 14.4 Message thread

The thread will support:

1. User text messages
2. Assistant text messages
3. Tool activity
4. Entity selections
5. Structured forms
6. Approval cards
7. Result cards
8. Navigation actions
9. Errors and recovery actions
10. Attachments
11. Feedback
12. Retry where safe
13. Stop generation

### 14.5 Composer

The composer will support:

1. Multiline input
2. Enter to send
3. Shift plus Enter for a newline
4. Attachment selection where supported
5. Stop generation
6. Disabled state during non-interruptible execution
7. Context indicators
8. Suggested prompts only when contextually relevant
9. Clear visual distinction between drafting and executing
10. Accessible labels and keyboard navigation

### 14.6 Assistant identity

The assistant should be presented as the BabyJamJam AI Assistant or BabyJamJam Copilot. It must not introduce itself as “Gemini.”

Provider and model identifiers may appear in administrative diagnostics, but not as the user-facing assistant identity.

## 15. ChatGPT inspired UI requirements

| ID | Requirement |
|---|---|
| UX-001 | The desktop interface must include a persistent or collapsible conversation sidebar. |
| UX-002 | The main conversation must use a centered readable column rather than full-width message bubbles. |
| UX-003 | User messages must appear as compact right-aligned bubbles. |
| UX-004 | Assistant messages must render without a large colored bubble by default. |
| UX-005 | The composer must float above the bottom edge with adequate safe-area spacing. |
| UX-006 | The composer must expand vertically for multiline input up to a defined maximum height. |
| UX-007 | The user must be able to stop a streaming response. |
| UX-008 | The user must be able to create a new conversation from any chat screen. |
| UX-009 | Conversation titles must be generated from the initial task and remain editable. |
| UX-010 | Conversation history must be searchable by title and message content within authorized retention. |
| UX-011 | Technical tool names must not appear in normal progress UI. |
| UX-012 | Tool activity must use human-readable Korean or English descriptions. |
| UX-013 | Completed tool activity should collapse into a compact disclosure. |
| UX-014 | Entity ambiguity must render as selectable records with identifying metadata. |
| UX-015 | Missing task fields should render as a structured form when this is more efficient than serial questioning. |
| UX-016 | Sensitive actions must render a dedicated approval card with exact target, fields, consequences, and actions. |
| UX-017 | Action results must render the affected entity, outcome, timestamp, and relevant navigation link. |
| UX-018 | Errors must distinguish between no action taken, action succeeded but response uncertain, and action partially completed. |
| UX-019 | The UI must support responsive desktop and mobile layouts. |
| UX-020 | The UI must use Glint design system components and tokens. |
| UX-021 | The UI must satisfy WCAG 2.2 AA for supported interactions. |
| UX-022 | Keyboard-only users must be able to navigate the sidebar, thread controls, forms, and approvals. |
| UX-023 | Screen readers must receive meaningful labels for message roles, activity, approvals, and results. |
| UX-024 | Focus must move predictably after sending, receiving an approval request, and completing an action. |
| UX-025 | The interface must not rely on color alone to communicate status. |
| UX-026 | The current branch must be visible in the conversation context. |
| UX-027 | A branch switch must create a visible context boundary in the conversation experience. |
| UX-028 | Exact phrase local wizard interception must be removed after equivalent structured message parts are available. |
| UX-029 | Suggested actions must be contextual and must not remain as a fixed row of generic commands. |
| UX-030 | The interface must allow users to copy assistant text and structured results where permitted. |

## 16. Structured message parts

The chat UI must support the following typed message parts.

### 16.1 Text part

Used for ordinary assistant explanations, summaries, and guidance.

### 16.2 Activity part

Displays current and completed operational progress using human-readable labels.

Example:

```text
✓ 김민지 산모 확인
✓ 계약서 조회
○ 최신 상태 정리 중
```

### 16.3 Entity choice part

Displays multiple matching entities and requires the user to select one.

Required fields:

1. Entity type
2. Stable entity ID
3. Display name
4. Redacted identifying information
5. Status
6. Selection action

### 16.4 Form request part

Displays missing required fields using Glint form components.

The form must submit structured values, not a synthetic natural-language message.

### 16.5 Action approval part

Displays an immutable proposed action.

Required fields:

1. Action ID
2. Capability name and version
3. Human-readable title
4. Target entity
5. Exact changes or external effect
6. Selected branch
7. Risk explanation
8. Expiration
9. Approve control
10. Reject control

### 16.6 Action result part

Displays the completed, failed, or uncertain result.

Required fields:

1. Action ID
2. Final status
3. Affected entity
4. Result summary
5. Completion time
6. Navigation action where available
7. Recovery guidance when needed

### 16.7 Navigation part

Provides a secure deep link to the relevant BabyJamJam page or record.

### 16.8 Attachment part

Displays attached files and upload status. File access must follow the same authorization as the file domain.

### 16.9 Error part

Displays a user-safe error code, explanation, known side-effect state, and permitted recovery actions.

### 16.10 Feedback part

Allows positive or negative feedback and an optional comment. Feedback must attach to a stable assistant message and trace.

## 17. Conversation behavior

### 17.1 Session creation

A new session is created when:

1. The user selects New conversation.
2. No valid session is supplied.
3. The selected branch differs from the session branch.
4. The existing session has expired.
5. The user explicitly resets context.

### 17.2 Session ownership

Every session must belong to exactly one authenticated user and one selected branch.

An owner with access to several branches must still operate within the selected branch for a normal conversation.

### 17.3 Conversation history

The product must store structured messages, not only plain text.

Conversation history must preserve:

1. Text
2. Tool calls
3. Tool results
4. Entity choices
5. Form submissions
6. Action proposals
7. Approval decisions
8. Action results
9. Errors
10. Navigation links
11. Trace references

### 17.4 Entity memory

The assistant may retain structured references to recently selected entities within the session.

Entity memory must include the branch ID and stable entity ID.

Entity memory must be invalidated when:

1. The branch changes.
2. The entity is deleted.
3. Authorization changes.
4. The session expires.
5. The entity reference becomes ambiguous or stale.

### 17.5 Pronoun and follow-up resolution

The assistant should resolve references such as:

1. 그 산모
2. 그분
3. 방금 찾은 관리사
4. 두 번째 사람
5. 그 계약서
6. 같은 내용으로

The assistant must not reuse context when the target is ambiguous or belongs to another branch.

### 17.6 Clarification policy

The assistant should avoid unnecessary questions.

The assistant must ask or render a form when:

1. A required field is missing.
2. Several entities match.
3. The requested action type is ambiguous and has materially different consequences.
4. The intended branch is unavailable or unclear.
5. The user requests a sensitive action without enough detail to create a valid proposal.

### 17.7 Multi-step tasks

The assistant may perform several read operations in one turn.

A multi-step task containing writes must create explicit action proposals for each independently reviewable side effect or one composite proposal when the canonical use case is atomic.

### 17.8 Response behavior

The assistant should:

1. Match the user’s language.
2. Prefer Korean when the user mixes Korean and English.
3. Use concise operational language.
4. Avoid unnecessary model or implementation terminology.
5. Show important records in structured tables or cards.
6. State what was completed.
7. State what remains.
8. Avoid claiming success before the canonical use case confirms success.

## 18. General functional requirements

### 18.1 Conversation requirements

| ID | Requirement |
|---|---|
| CONV-001 | A session must be scoped to an authenticated user and selected branch. |
| CONV-002 | A user must not read, continue, approve, or delete another user’s session. |
| CONV-003 | A branch switch must not retain entity memory from the previous branch. |
| CONV-004 | Structured message parts must be persisted and restored. |
| CONV-005 | The user must be able to rename, archive, and delete a conversation. |
| CONV-006 | Deleted conversations must no longer appear in history. |
| CONV-007 | Conversation retention must be configurable. |
| CONV-008 | The initial default conversation retention target is 30 days, subject to privacy review. |
| CONV-009 | Operational action audit records must use a separately defined retention policy. |
| CONV-010 | The assistant must retain at least the recent conversation plus a compact structured summary. |
| CONV-011 | Context compaction must preserve unresolved actions, entity references, user preferences relevant to the task, and branch context. |
| CONV-012 | Compaction must not convert untrusted tool output into system instructions. |
| CONV-013 | The user must be able to stop response generation without cancelling an already executing server-side action unless cancellation is explicitly supported. |
| CONV-014 | Retrying a text response must not repeat completed side effects. |
| CONV-015 | A session must display a visible branch label. |
| CONV-016 | The system must return a safe error when a supplied session ID is invalid, expired, or unauthorized. |

### 18.2 Model requirements

| ID | Requirement |
|---|---|
| MODEL-001 | The default model must be configured as `gemini-3.5-flash-lite`. |
| MODEL-002 | The model identifier must be environment-configurable. |
| MODEL-003 | Business logic must not depend on provider-specific response text. |
| MODEL-004 | The assistant must use typed tools and structured outputs. |
| MODEL-005 | Deprecated sampling parameters must not be required for Gemini 3.5 operation. |
| MODEL-006 | The product must support configurable reasoning or thinking behavior by task class where the provider permits it. |
| MODEL-007 | Simple classification and lookup tasks should use the lowest sufficient reasoning setting. |
| MODEL-008 | Complex planning may use a higher reasoning setting, but business validation remains deterministic. |
| MODEL-009 | A model change must run the complete behavior evaluation suite before production rollout. |
| MODEL-010 | The user-facing assistant identity must remain BabyJamJam branded regardless of provider. |
| MODEL-011 | A fallback model is not required for the first release. |
| MODEL-012 | A future fallback must preserve the same capability, approval, trace, and action contracts. |

### 18.3 Capability requirements

| ID | Requirement |
|---|---|
| CAP-001 | Every chat-enabled operation must have a registered typed capability. |
| CAP-002 | Every capability must belong to one domain. |
| CAP-003 | Every capability must declare an input schema. |
| CAP-004 | Every capability must declare an output schema or stable output contract. |
| CAP-005 | Every capability must declare its risk class. |
| CAP-006 | Every capability must declare its tenant scope. |
| CAP-007 | Every capability must declare its authorization policy. |
| CAP-008 | Every capability must declare whether approval is required. |
| CAP-009 | Every side-effect capability must declare an idempotency policy. |
| CAP-010 | Every capability must declare its user-facing renderer types. |
| CAP-011 | Every capability must have a version. |
| CAP-012 | The agent must expose only relevant capability bundles for a turn. |
| CAP-013 | Capability selection must not weaken authorization. |
| CAP-014 | A capability must call a canonical application use case. |
| CAP-015 | A capability must not duplicate business workflow logic already owned by another application use case. |
| CAP-016 | Removed or deprecated capabilities must define pending-action behavior. |
| CAP-017 | Capability results must be validated before they are passed to the model or UI. |
| CAP-018 | Tool errors must return stable machine-readable error categories. |
| CAP-019 | Unknown capability names must fail closed. |
| CAP-020 | Capability availability may be controlled by domain and environment feature flags. |

### 18.4 Entity resolution requirements

| ID | Requirement |
|---|---|
| ENT-001 | Entity resolution must be branch-scoped. |
| ENT-002 | Exact stable IDs must take precedence over names. |
| ENT-003 | Names may be used to search when an ID is unavailable. |
| ENT-004 | Multiple matches must return an entity choice part. |
| ENT-005 | The assistant must not select an ambiguous entity automatically for a side effect. |
| ENT-006 | Entity choice results must display enough redacted information to support a correct selection. |
| ENT-007 | A selected entity must be stored as structured session context. |
| ENT-008 | Entity context must include entity type, ID, branch ID, display name, and resolution time. |
| ENT-009 | Side effects must revalidate entity state before execution. |
| ENT-010 | Entity memory must never authorize access that the current principal does not possess. |

### 18.5 Action and approval requirements

| ID | Requirement |
|---|---|
| ACT-001 | Every write or external side effect must be represented by a durable action record before execution. |
| ACT-002 | The action record must contain the user ID, branch ID, session ID, capability name, and capability version. |
| ACT-003 | The action record must contain normalized validated input. |
| ACT-004 | The action record must contain a target snapshot or version where applicable. |
| ACT-005 | Approval must reference the action ID. |
| ACT-006 | Approval must not be inferred from ordinary text such as `확인` or `yes`. |
| ACT-007 | The approval UI must show exact consequences. |
| ACT-008 | Rejected actions must never execute. |
| ACT-009 | Expired actions must never execute. |
| ACT-010 | Approved actions must be revalidated before execution. |
| ACT-011 | Revalidation must include authorization, branch, entity existence, entity version, conflict state, and action status. |
| ACT-012 | Every side effect must use an idempotency key derived from a durable action identity. |
| ACT-013 | Repeated execution of the same action must return the original result or a stable already-completed result. |
| ACT-014 | The UI must distinguish reversible writes, destructive writes, external side effects, paid actions, and privileged actions. |
| ACT-015 | Destructive and privileged actions may require stronger approval or reauthentication. |
| ACT-016 | The model must not modify action arguments after the proposal is created. |
| ACT-017 | A changed proposal must create a new action ID. |
| ACT-018 | Action results must be persisted before the client is told that the action succeeded. |
| ACT-019 | Provider uncertainty must be represented as `uncertain`, not `failed`, until reconciliation determines the outcome. |
| ACT-020 | Automatic client retry must not repeat a completed or uncertain side effect. |
| ACT-021 | Bulk actions must show the count and targets before approval. |
| ACT-022 | Bulk actions must define whether they are atomic, best-effort, or resumable. |
| ACT-023 | The user must be able to inspect a completed action’s audit details where authorized. |
| ACT-024 | A user cancellation after execution begins must not imply that the external action was reversed. |

### 18.6 Authorization and tenant requirements

| ID | Requirement |
|---|---|
| SEC-001 | Every request must use the authenticated principal from the server. |
| SEC-002 | The selected branch must be verified by the tenant guard or equivalent policy. |
| SEC-003 | Every capability must receive the verified user and branch context. |
| SEC-004 | The model must never determine role or permission. |
| SEC-005 | Capability authorization must be enforced immediately before execution. |
| SEC-006 | Owners must still operate within an explicitly selected branch unless using a specifically global capability. |
| SEC-007 | Global capabilities must require an explicit global scope declaration. |
| SEC-008 | Cross-branch reads must be denied by default. |
| SEC-009 | Cross-branch writes must be denied unless a privileged, specifically designed capability permits them. |
| SEC-010 | Tool results must contain only fields authorized for the current user. |
| SEC-011 | Personal data must be redacted from general application logs. |
| SEC-012 | Full traces containing personal data must have restricted access and retention. |
| SEC-013 | External content, attachments, tool output, and retrieved policy text must be treated as untrusted data. |
| SEC-014 | Untrusted content must not override system, authorization, or action policy. |
| SEC-015 | Sensitive action endpoints must use CSRF-resistant authenticated requests. |
| SEC-016 | Approval endpoints must verify that the approver owns or is authorized to approve the action. |
| SEC-017 | Rate limits must apply to model calls, capability calls, action proposals, and approvals. |
| SEC-018 | File attachments must enforce size, type, storage, and access policies. |
| SEC-019 | The system must fail closed when branch or permission context is missing. |
| SEC-020 | Production debugging tools must not store unrestricted prompts or personal data without explicit approval. |

### 18.7 Capability synchronization requirements

| ID | Requirement |
|---|---|
| SYNC-001 | Capability definitions must be owned by the same domain as the canonical use case. |
| SYNC-002 | The build must generate a machine-readable capability manifest. |
| SYNC-003 | The manifest must include capability name, version, domain, status, risk, and renderer references. |
| SYNC-004 | The repository must maintain an explicit inventory of chat-eligible use cases. |
| SYNC-005 | CI must fail when a chat-eligible use case has no capability. |
| SYNC-006 | CI must fail when capability input is incompatible with its canonical command schema. |
| SYNC-007 | CI must fail when capability output is incompatible with its canonical result contract. |
| SYNC-008 | CI must fail when capability authorization is weaker than the canonical product policy. |
| SYNC-009 | CI must fail when a write capability has no approval policy. |
| SYNC-010 | CI must fail when a side-effect capability has no idempotency policy. |
| SYNC-011 | CI must fail when a capability references an unregistered UI renderer. |
| SYNC-012 | CI must fail when a write capability has no approval evaluation. |
| SYNC-013 | Pull requests that change relevant use cases, commands, DTOs, policies, or capabilities must generate an AI capability impact report. |
| SYNC-014 | Behavior-changing capability updates must increment the capability version. |
| SYNC-015 | Pending actions must retain the exact capability version used to create them. |
| SYNC-016 | A capability removed from production must have an expiration or migration plan for pending actions. |
| SYNC-017 | An authenticated diagnostic endpoint may expose non-sensitive capability status. |
| SYNC-018 | Operational data must always be read live rather than copied into static prompt text. |
| SYNC-019 | Internal policy documents used for answers must include version, owner, effective date, and review date. |
| SYNC-020 | Policy retrieval must never replace canonical runtime validation. |

### 18.8 Observability requirements

| ID | Requirement |
|---|---|
| OBS-001 | Every assistant run must have a trace ID. |
| OBS-002 | Every tool call must record capability name, version, latency, outcome, and redacted argument metadata. |
| OBS-003 | Every action proposal, approval, rejection, execution, and result must be traceable. |
| OBS-004 | The trace must record model identifier and agent version. |
| OBS-005 | Token usage and model latency must be measurable. |
| OBS-006 | User feedback must attach to a stable assistant message and trace. |
| OBS-007 | Errors must be categorized as model, routing, validation, authorization, capability, provider, persistence, or client errors. |
| OBS-008 | External provider uncertainty must have a dedicated trace state. |
| OBS-009 | Administrators must be able to inspect aggregate success and failure metrics. |
| OBS-010 | Personal data must be redacted in aggregate telemetry. |
| OBS-011 | Development-only AI debugging tools must be disabled in production by default. |
| OBS-012 | Capability drift failures must be visible in CI output. |
| OBS-013 | Model evaluation results must be stored with model and agent versions. |
| OBS-014 | Production rollout must support domain-level feature flags and emergency disablement. |

## 19. Risk classification

| Risk class | Examples | Default behavior |
|---|---|---|
| Read | Search clients, view contract status | Execute immediately when authorized |
| Draft | Compose SMS, prepare client data | Produce preview, no side effect |
| Reversible write | Update phone, change availability | Structured approval required |
| Irreversible write | Delete record, terminate service | Strong approval and additional warning |
| External side effect | Send contract, send SMS | Structured approval, idempotency, provider reconciliation |
| Paid action | Paid message or provider operation | Cost disclosure and explicit approval |
| Privileged administration | Create branch, change role | Owner-only policy and strong approval |

## 20. Detailed user journeys

### 20.1 Search a client and continue with context

**User intent**

“김민지 산모 찾아줘.”

**Expected flow**

1. The assistant routes to the client capability bundle.
2. The assistant searches within the selected branch.
3. If one record matches, it displays a client summary.
4. The selected client is stored as session entity context.
5. The user asks, “그 산모 계약서 상태도 알려줘.”
6. The assistant uses the selected client ID.
7. The assistant retrieves live contract status.
8. The assistant presents the status and a link to the client or contract page.

**Success criteria**

1. No repeated name entry is required.
2. No other branch is searched.
3. The correct client ID is used.
4. The contract status is live.

### 20.2 Resolve duplicate names

**User intent**

“김민지 산모 정보 보여줘.”

**Expected flow**

1. Search returns several matches.
2. The assistant renders an entity choice part.
3. Each option shows redacted phone, area, service status, and stable selection action.
4. The user selects the intended record.
5. The assistant stores the selected stable ID.
6. The assistant continues the original request without asking the user to repeat it.

**Success criteria**

1. The assistant does not choose automatically.
2. The user can distinguish candidates.
3. The original task resumes after selection.

### 20.3 Register a client

**User intent**

“새 산모 등록해줘. 이름은 김민지이고 전화번호는 010-1234-5678이야.”

**Expected flow**

1. The assistant extracts available fields.
2. The assistant identifies missing required fields.
3. The assistant renders one structured registration form.
4. The user completes required fields.
5. The server validates the data and checks duplicates.
6. The assistant renders an immutable client creation proposal.
7. The user approves.
8. The canonical create client use case executes with an idempotency key.
9. The assistant renders a result card with client ID and navigation link.

**Success criteria**

1. No client is created before approval.
2. Duplicate phone rules match the ordinary UI.
3. A retry does not create another client.

### 20.4 Update a client phone number

**User intent**

“김민지 산모 번호를 010-1111-2222로 변경해줘.”

**Expected flow**

1. The assistant resolves the exact client.
2. The server loads the current phone and record version.
3. The assistant shows old and new values in an approval card.
4. The user approves.
5. The server revalidates version and authorization.
6. The canonical update use case executes.
7. The result card shows the changed field and completion time.

**Success criteria**

1. The exact record is clear before approval.
2. Concurrent changes prevent stale execution.
3. The action is audited.

### 20.5 Prepare and send a contract

**User intent**

“김민지 산모에게 계약서 보내줘.”

**Expected flow**

1. The assistant resolves the client.
2. The canonical contract preparation use case selects the correct contract type and template.
3. The server validates recipient phone, service data, existing contracts, and conflict state.
4. Missing fields are requested through a structured form.
5. The assistant renders an approval card with recipient, contract type, service period, provider, and consequence.
6. The user approves using the action ID.
7. The canonical dispatch use case executes with idempotency.
8. The server reconciles uncertain provider outcomes.
9. The assistant displays sent, failed, or uncertain status.
10. The result includes the document ID and navigation link.

**Success criteria**

1. The contract cannot be sent by an ordinary “확인” message.
2. Automatic retries do not send a second contract.
3. The result reflects the provider’s verified state.

### 20.6 Find and replace a caregiver

**User intent**

“김민지 산모 담당 관리사를 교체하고 싶어. 다음 주 가능한 연수구 프리미엄 관리사 찾아줘.”

**Expected flow**

1. The assistant resolves the client and date window.
2. The assistant queries eligible employees using live availability and schedule data.
3. The assistant presents candidates with grade, work area, availability, and conflicts.
4. The user selects a candidate.
5. The assistant prepares a replacement proposal.
6. The approval card shows current and proposed employees and effective dates.
7. The user approves.
8. The canonical replacement use case executes.
9. The result shows the updated assignment and schedule impact.

**Success criteria**

1. Schedule conflicts are evaluated deterministically.
2. No replacement occurs without candidate selection and approval.
3. The current and replacement employees are explicit.

### 20.7 Review consultations and create a draft

**User intent**

“안 읽은 상담 문의를 요약하고 신규 예약 가능성이 높은 것부터 보여줘.”

**Expected flow**

1. The assistant lists unread inquiries within the selected branch.
2. The assistant summarizes each inquiry using live data.
3. Any prioritization must be presented as an assistant recommendation, not a guaranteed business fact.
4. The user selects an inquiry.
5. The assistant offers a structured draft creation action when supported.
6. The user reviews and approves the draft action.

**Success criteria**

1. The assistant does not expose inquiries from another branch.
2. Recommendations are distinguishable from source facts.
3. Draft creation uses the canonical inquiry or client draft workflow.

### 20.8 Send a scheduled message

**User intent**

“김민지 산모에게 서비스 시작 안내 문자를 내일 오전 10시에 보내줘.”

**Expected flow**

1. The assistant resolves the client.
2. The assistant loads the approved template and current recipient data.
3. The assistant renders a message preview.
4. The server validates sender approval and scheduling rules.
5. The approval card shows recipient, content, scheduled time in Korea Standard Time, provider, and expected cost category when available.
6. The user approves.
7. The canonical message delivery use case executes with idempotency.
8. The result shows the schedule record and delivery status link.

**Success criteria**

1. The user sees exact content and recipient before approval.
2. Scheduling minimum lead time is enforced by the server.
3. Retry does not create a duplicate scheduled message.

### 20.9 Search files

**User intent**

“남동구 계약 관련 PDF 찾아줘.”

**Expected flow**

1. The assistant uses the file capability bundle.
2. Search is scoped to the selected branch and authorized metadata.
3. Matching files are displayed with name, category, tags, date, type, and size.
4. The user may open or download a file through an authorized route.
5. Delete or metadata update requires a proposal and approval.

**Success criteria**

1. Signed storage URLs are not unnecessarily exposed to the model.
2. File access follows existing authorization.
3. The assistant cannot access files from another branch.

### 20.10 Switch branches

**User action**

The owner switches from 남동점 to 검단점.

**Expected flow**

1. The application changes the verified branch context.
2. The previous conversation becomes read-only or remains associated with the original branch.
3. A new conversation is created or the user explicitly starts one for the new branch.
4. The UI displays the new branch.
5. Previous entity memory is cleared.

**Success criteria**

1. The new session cannot use prior branch entity IDs.
2. History remains correctly labeled by branch.
3. No cached result is shown as current data for the new branch.

### 20.11 Unauthorized action

**User intent**

A staff member asks to create a new branch.

**Expected flow**

1. The capability router may identify system administration intent.
2. The server determines that the principal lacks the required role.
3. No proposal or action record capable of execution is created.
4. The assistant explains that the action requires owner authority.
5. The assistant may offer a safe navigation or request workflow if available.

**Success criteria**

1. The model cannot override the policy.
2. The denial is audited without exposing sensitive details.

## 21. Domain requirements

### 21.1 Clients

The assistant must eventually support:

1. Search by name, phone, address, status, date, or alert state
2. Client detail
3. Service and assignment summary
4. Create
5. Update
6. Terminate service
7. Replacement preparation
8. Contract context
9. Message context
10. File and service record navigation

### 21.2 Employees

The assistant must eventually support:

1. Search by name, phone, grade, work area, and availability
2. Employee detail
3. Schedule summary
4. Availability and conflict checks
5. Create
6. Update
7. Change assignment availability
8. Replacement candidate search
9. Controlled deletion or deactivation
10. Service record context

### 21.3 Contracts

The assistant must eventually support:

1. List contracts
2. Get latest contract by client
3. Explain status
4. Identify required action
5. Prepare dispatch
6. Dispatch after approval
7. Cancel or purge through canonical policy
8. Reconcile uncertain provider state
9. Open audit files where authorized
10. Navigate to the contract record

### 21.4 Messages

The assistant must distinguish among:

1. Notice board messages
2. User-created templates
3. System templates
4. Immediate SMS
5. Scheduled SMS
6. Message trigger rules
7. Upcoming jobs
8. Delivery history
9. Retry actions
10. Sender approval state

The assistant must not use the vague term “message” without resolving the intended message type when consequences differ.

### 21.5 Consultations and calls

The assistant must eventually support:

1. List and search inquiries
2. Unread counts
3. Mark read
4. Summarize inquiry content
5. List and search call records
6. Summarize transcripts
7. Review extracted proposals
8. Inspect client drafts
9. Patch drafts
10. Confirm or discard drafts after appropriate approval

### 21.6 Files

The assistant must eventually support:

1. Search metadata
2. Category filtering
3. Tag filtering
4. Detail
5. Rename
6. Re-categorize
7. Update tags
8. Open or download
9. Delete after approval
10. Attachment-driven upload through structured UI

### 21.7 Service records

The administrative assistant may support authenticated oversight of:

1. Case status
2. Assignment status
3. Link issuance state
4. Schedule change requests
5. Completion state
6. Document reconciliation

The assistant must not bypass the separate caregiver verification and no-login security model.

### 21.8 Administration

Privileged capabilities may eventually support:

1. Branch requests
2. Branch creation
3. Branch update
4. User assignment
5. Role management
6. System settings
7. Website administration

These capabilities require owner-only or explicitly defined privileged policies and strong approval.

## 22. Keeping the assistant current with application changes

### 22.1 Source of truth

The assistant must not periodically reread the codebase and attempt to infer new features at runtime.

The product capability registry is the source of truth for what the assistant can do.

### 22.2 Domain ownership

Each capability must live next to or be exported by the domain that owns its canonical application use case.

When a domain use case changes, the corresponding capability definition, schema, renderer, and evaluation must be reviewed in the same pull request.

### 22.3 Capability manifest

The build will generate a manifest similar to:

```json
{
  "generatedAt": "2026-08-02T10:00:00+09:00",
  "appVersion": "git-commit",
  "capabilitySchemaVersion": 1,
  "capabilities": [
    {
      "name": "clients.search",
      "version": 1,
      "domain": "clients",
      "status": "enabled",
      "risk": "read"
    }
  ]
}
```

### 22.4 Pull request impact reporting

Relevant pull requests must report:

1. Changed domains
2. Affected capabilities
3. Input schema differences
4. Output contract differences
5. Authorization differences
6. Approval differences
7. Renderer differences
8. Evaluation differences
9. Required capability version changes

### 22.5 Runtime capability status

An authenticated diagnostic view should show:

1. Capability name
2. Version
3. Domain
4. Status
5. Risk
6. Required role
7. Feature flag state
8. Renderer registration state
9. Last successful compatibility test
10. Last successful evaluation version

### 22.6 Capability lifecycle

Capabilities may have these states:

1. Experimental
2. Enabled
3. Deprecated
4. Disabled

A disabled capability must not be offered to the model.

### 22.7 Operational data freshness

Client, employee, contract, message, schedule, file, price, inquiry, and administration data must be read from live application services at execution time.

### 22.8 Policy knowledge freshness

Operational policy documents used for explanatory answers must be versioned and reviewed.

Each policy source should include:

1. Stable ID
2. Version
3. Owner
4. Effective date
5. Review date
6. Applicable branches or scope
7. Superseded version where relevant

## 23. Knowledge behavior

The product must distinguish among:

1. Live operational data
2. Product capability metadata
3. Internal policy knowledge
4. Model general knowledge

The assistant must clearly communicate when an answer is based on:

1. Current BabyJamJam records
2. An internal policy source
3. An assistant recommendation
4. General explanatory knowledge

The assistant must not present model inference as a confirmed application fact.

## 24. Data and privacy requirements

1. Chat sessions may contain personal and operational data.
2. Conversation retention must be configurable and reviewed by the business owner.
3. Action audit retention must be independent from conversation retention.
4. General logs must not include full phone numbers, addresses, transcripts, document content, tokens, or signed URLs.
5. Trace access must be role-restricted.
6. Export and deletion behavior must follow application policy.
7. Attachments must use the existing storage and authorization model.
8. The model should receive only fields necessary for the task.
9. Tool results should minimize unnecessary personal data.
10. Production prompts and tool payloads must not be sent to unapproved telemetry destinations.
11. Data sent to the configured AI provider must follow the organization’s approved provider policy.
12. The user must not be able to use prompt injection to access hidden fields or another branch.
13. Retrieved documents and transcripts must be treated as untrusted content.
14. Secrets, access tokens, refresh tokens, and provider credentials must never be exposed to the model.

## 25. Non-functional requirements

### 25.1 Performance

| ID | Target |
|---|---|
| PERF-001 | Median time to first visible response or activity event should be at most 1.5 seconds under normal production conditions. |
| PERF-002 | P95 time to first visible response or activity event should be at most 3 seconds. |
| PERF-003 | P95 completion time for a simple read task should be at most 10 seconds, excluding known slow external providers. |
| PERF-004 | The interface must remain responsive during streaming. |
| PERF-005 | Small streaming deltas must be batched to avoid excessive React renders. |
| PERF-006 | Capability routing should not add more than 1 second P95 before the first operational step. |
| PERF-007 | Conversation history should load incrementally. |

### 25.2 Reliability

| ID | Target |
|---|---|
| REL-001 | The chat service target availability is 99.5 percent monthly after production launch. |
| REL-002 | A model failure must not corrupt session or action state. |
| REL-003 | A client disconnect must not silently repeat or reverse a side effect. |
| REL-004 | Action execution must be resumable or safely inspectable after process restart. |
| REL-005 | Provider uncertainty must be reconcilable. |
| REL-006 | The system must tolerate duplicate approve requests without duplicate execution. |
| REL-007 | Feature flags must allow immediate disablement of a capability domain. |

### 25.3 Scalability

1. The capability registry must support at least 100 registered capabilities without exposing all capabilities on every turn.
2. Session storage must support pagination and compaction.
3. Action execution must support concurrent users without cross-session contamination.
4. Rate limits must protect AI and external provider budgets.
5. The architecture must allow model routing without changing capability code.

### 25.4 Accessibility

1. WCAG 2.2 AA target
2. Complete keyboard navigation
3. Screen-reader labels for message roles and action states
4. Visible focus indicators
5. Sufficient contrast
6. Reduced motion support
7. Touch target compliance
8. Accessible error summaries for structured forms

### 25.5 Localization

1. Korean is the primary operational language.
2. English is supported.
3. The assistant should match the user’s language.
4. Dates and times must use Korea Standard Time by default unless explicitly stated.
5. Business terms should use the application’s canonical Korean terminology.
6. Tool and error codes may remain English internally but must have localized user-facing copy.

## 26. Analytics and metrics

### 26.1 Adoption metrics

1. Weekly active assistant users
2. Conversations per active user
3. Tasks attempted per active user
4. Percentage of eligible users who use the assistant
5. Repeat usage after first successful task

### 26.2 Task metrics

1. Task completion rate
2. Correct capability selection rate
3. Correct argument rate
4. Correct entity resolution rate
5. Clarification rate
6. Average tool calls per task
7. Average time to completion
8. User abandonment rate
9. Navigation handoff rate
10. Approval completion rate

### 26.3 Safety metrics

1. Unauthorized execution rate
2. Cross-branch exposure rate
3. Unapproved execution rate
4. Duplicate side-effect rate
5. Stale action rejection rate
6. Provider uncertainty rate
7. Manual recovery rate
8. Capability drift incidents

### 26.4 Quality metrics

1. Positive feedback rate
2. Negative feedback rate
3. Negative feedback with comment rate
4. Model response relevance
5. Tool result explanation quality
6. Error recovery success
7. Conversation context retention accuracy

### 26.5 Cost metrics

1. Model input tokens per task
2. Model output tokens per task
3. Model cost per completed task
4. External provider cost per action
5. Cost by capability domain
6. Retry cost

## 27. Evaluation requirements

### 27.1 Evaluation categories

The evaluation suite must include:

1. Korean colloquial terminology
2. English instructions
3. Mixed Korean and English
4. Duplicate names
5. Follow-up pronouns
6. Missing information
7. Date and time interpretation
8. Branch switches
9. Unauthorized actions
10. Contract duplication scenarios
11. Message mis-send prevention
12. Bulk actions
13. Provider failures
14. Provider uncertainty
15. Approval rejection
16. Stale approval
17. Duplicate approval
18. Automatic stream retry
19. Prompt injection in tool results
20. Several tasks in one request
21. Unsupported capabilities
22. Capability version changes

### 27.2 Evaluation assertions

Evaluations should assert:

1. Selected capability
2. Tool arguments
3. Tool order
4. Required or forbidden tool calls
5. Entity IDs
6. Approval behavior
7. Authorization behavior
8. Action state
9. Idempotency behavior
10. Final result type
11. User-visible error category
12. Trace creation

### 27.3 Minimum pre-launch evaluation set

Before Release A production rollout, the suite should contain at least 100 representative read cases.

Before Release B, it should contain at least 150 total cases, including approval and write behavior.

Before Release C, it should contain at least 200 total cases, including external side effects, uncertainty, and duplicate prevention.

### 27.4 Launch thresholds

| Metric | Release A | Release B | Release C |
|---|---:|---:|---:|
| Correct domain routing | At least 95% | At least 95% | At least 95% |
| Correct capability selection | At least 92% | At least 94% | At least 95% |
| Correct entity resolution | At least 95% | At least 97% | At least 98% |
| Correct action proposal | Not applicable | At least 97% | At least 98% |
| Required approval triggered | Not applicable | 100% | 100% |
| Unauthorized execution | 0 | 0 | 0 |
| Cross-branch access | 0 | 0 | 0 |
| Duplicate side effect | Not applicable | 0 | 0 |
| Unsafe stale execution | Not applicable | 0 | 0 |

The thresholds may be increased after baseline measurement. They must not be lowered to permit known unsafe behavior.

## 28. Testing requirements

1. Unit tests for capability schemas
2. Unit tests for authorization policy
3. Unit tests for action lifecycle
4. Unit tests for idempotency
5. Integration tests with canonical use cases
6. Deterministic model stub that emits tool calls
7. End-to-end tests for tool selection and execution
8. End-to-end tests for approval pause and resume
9. End-to-end tests for duplicate approval
10. End-to-end tests for branch isolation
11. End-to-end tests for user session ownership
12. End-to-end tests for client disconnect and retry
13. End-to-end tests for provider uncertainty
14. UI tests for structured message parts
15. Accessibility tests for approval and form cards
16. Snapshot or visual regression tests for desktop and mobile chat layouts
17. Capability manifest tests
18. Pull request impact report tests

## 29. Rollout plan

### 29.1 Internal development

1. Implement behind a disabled feature flag.
2. Use deterministic fixtures and test branches.
3. Compare new and old assistant behavior.
4. Prevent production writes.

### 29.2 Shadow mode

1. The new runtime processes selected production-like requests without executing tools.
2. Results are compared with expected capability and arguments.
3. Personal data is handled according to production policy.
4. Shadow results are not shown as completed actions.

### 29.3 Read-only internal release

1. Enable Release A for product owner and selected internal users.
2. Monitor task success and latency.
3. Review negative feedback and traces.
4. Keep all write capabilities disabled.

### 29.4 Read-only production release

1. Enable by branch feature flag.
2. Provide user education and visible beta status.
3. Monitor guardrail metrics.
4. Maintain immediate kill switch.

### 29.5 Reversible write release

1. Enable selected Release B capabilities.
2. Require structured approval.
3. Monitor proposal correctness and rejection rates.
4. Roll back individual capabilities on regression.

### 29.6 External side-effect release

1. Enable one provider action at a time.
2. Begin with internal users.
3. Verify idempotency and reconciliation in production.
4. Expand only after zero duplicate incidents during the observation window.

### 29.7 Privileged capability release

1. Owner-only
2. Strong approval
3. Additional audit review
4. Small allowlist
5. Separate launch decision

## 30. Feature flags

The product must support at least:

1. Global assistant enabled
2. New runtime enabled
3. New UI enabled
4. Read capabilities enabled
5. Client write capabilities enabled
6. Employee write capabilities enabled
7. Contract dispatch enabled
8. Message delivery enabled
9. File capabilities enabled
10. Administration capabilities enabled
11. Per-branch enablement
12. Per-user allowlist
13. Model override for testing

## 31. Administrative controls

Authorized administrators should eventually be able to view:

1. Enabled capability domains
2. Capability versions
3. Model and agent versions
4. Feature flag status
5. Recent task success rate
6. Recent failures
7. Pending actions
8. Uncertain actions
9. Capability drift status
10. Evaluation status
11. Emergency disable controls

Administrative controls must not expose raw personal data unless the administrator is separately authorized for the source records.

## 32. Dependencies

### 32.1 Product dependencies

1. Accepted ADR 0001
2. Glint design system components
3. Existing authentication and branch selection
4. Existing tenant guard and role policies
5. Canonical application use cases
6. Existing Next.js chat routes or their replacement
7. Existing NestJS backend
8. Existing PostgreSQL and Prisma infrastructure
9. Existing external provider adapters
10. Existing feedback and observability surfaces

### 32.2 Implementation dependencies

1. AI SDK 6 agent runtime
2. Gemini provider integration
3. `gemini-3.5-flash-lite` configuration
4. Structured shared message contracts
5. New session and action persistence
6. Capability registry
7. Action coordinator
8. Idempotency support
9. Evaluation harness
10. CI manifest and drift gates

## 33. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Flash Lite misunderstands complex instructions | Incorrect task planning | Dynamic capability scoping, deterministic workflows, evaluations, optional future fallback |
| Capability registry becomes stale | Outdated or missing product behavior | Domain ownership, manifest, CI compatibility checks, PR impact report |
| Authorization differs from UI | Unauthorized action | Shared policy functions, permission parity tests, execution-time validation |
| Approval becomes stale | Wrong record update | Target snapshot, version check, expiration, revalidation |
| Stream retry repeats action | Duplicate external effect | Durable action ID and idempotency |
| Tool list grows too large | Lower tool selection accuracy | Domain routing and dynamic capability bundles |
| Assistant exposes personal data in logs | Privacy incident | Redaction, restricted traces, minimum necessary tool results |
| Structured UI becomes inconsistent | Poor user trust | Shared part contracts and Glint renderer registry |
| AI path diverges from normal UI | Incorrect business behavior | Canonical shared application use cases |
| Provider returns uncertain outcome | Duplicate retry or user confusion | Uncertain action state and reconciliation |
| Conversation context crosses branch | Tenant data exposure | User and branch scoped sessions and memory invalidation |
| Users over-trust assistant recommendations | Poor operational decisions | Distinguish source facts, actions, and recommendations |
| Production model behavior changes | Regression | Version pinning where available, model eval gate, staged rollout |

## 34. Acceptance criteria by release

### 34.1 Release A acceptance criteria

1. The default configured model is `gemini-3.5-flash-lite`.
2. The user sees the ChatGPT inspired desktop chat shell.
3. Mobile layout is responsive, even if mobile history rollout is deferred.
4. Sessions are scoped to user and branch.
5. Structured message parts persist and restore.
6. Client, employee, dashboard, schedule, voucher, bank account, and contract-status reads use canonical use cases.
7. Duplicate entity names produce structured selection.
8. Follow-up entity references work in evaluation cases.
9. No text-based approval detection is used for Release A functionality.
10. Capability manifest generation runs in CI.
11. Schema and permission drift checks run in CI.
12. Deterministic end-to-end tests emit and execute tool calls.
13. Cross-user and cross-branch tests pass with zero leakage.
14. Release A evaluation thresholds are met.
15. Domain feature flags and emergency disablement work.

### 34.2 Release B acceptance criteria

1. Durable action records exist.
2. Approve and reject endpoints use action IDs.
3. Client and employee writes require structured approval.
4. Action arguments cannot change after proposal.
5. Stale proposals are rejected.
6. Duplicate approval does not repeat execution.
7. Every action has an audit result.
8. Write capability renderer and evaluation coverage pass.
9. Release B evaluation thresholds are met.

### 34.3 Release C acceptance criteria

1. Contract and message external actions use canonical workflows.
2. Recipient and content are visible before approval.
3. Idempotency prevents duplicate sends.
4. Provider uncertainty is represented and reconciled.
5. Client disconnect and retry tests pass.
6. Paid or provider actions disclose relevant consequence or cost category.
7. Release C evaluation thresholds are met.
8. No duplicate external side effect occurs during controlled rollout observation.

## 35. Definition of done

A capability is done only when:

1. Its product intent is documented.
2. Its canonical use case exists.
3. Its input and output contracts are typed.
4. Its authorization is defined and tested.
5. Its tenant scope is defined and tested.
6. Its risk class is defined.
7. Its approval policy is implemented where required.
8. Its idempotency policy is implemented where required.
9. Its structured UI renderers exist.
10. Its happy-path and failure evaluations exist.
11. Its deterministic integration tests pass.
12. Its capability manifest entry is generated.
13. Its PR impact checks pass.
14. Its observability and trace events exist.
15. Its feature flag exists.
16. Its user-facing copy is localized.
17. Its documentation is updated.
18. It meets the applicable launch threshold.

## 36. Open product questions

The following questions should be resolved before the associated release, but they do not block creation of the foundation:

1. Final default conversation retention after privacy review
2. Whether mobile conversation history launches with Release A or immediately afterward
3. Which irreversible actions require reauthentication in addition to approval
4. Whether owners may intentionally create cross-branch analytical conversations
5. Whether paid provider costs can be displayed precisely or only by cost category
6. Which internal policy documents will be included in the first retrieval corpus
7. Whether archived conversations remain searchable
8. Whether action audit details are visible to branch administrators or only owners
9. The observation period required before expanding external side effects to all branches
10. Whether website publication actions require a separate editorial approval role

## 37. Future enhancements

1. Voice input and spoken responses
2. Proactive daily operational brief
3. User-configured recurring summaries
4. Multi-branch owner analytics
5. Policy-aware onboarding assistant
6. Attachment summarization
7. Document field extraction
8. Suggested workflow automation
9. Mobile push completion notifications for long-running actions
10. Optional specialist agents after measured need
11. Provider comparison and automatic model routing
12. Offline draft composition
13. Reusable action templates
14. Team-shared conversation links with authorization
15. Conversation export for audit review

## Appendix A: Initial capability catalog

| Capability | Mode | Release |
|---|---|---|
| `clients.search` | Read | A |
| `clients.get` | Read | A |
| `employees.search` | Read | A |
| `employees.get` | Read | A |
| `dashboard.getSummary` | Read | A |
| `schedules.list` | Read | A |
| `schedules.getByEmployee` | Read | A |
| `voucherPrices.list` | Read | A |
| `voucherPrices.getByType` | Read | A |
| `bankAccounts.list` | Read | A |
| `bankAccounts.getByArea` | Read | A |
| `contracts.getStatus` | Read | A |
| `contracts.listByClient` | Read | A |
| `clients.create` | Reversible write | B |
| `clients.update` | Reversible write | B |
| `employees.create` | Reversible write | B |
| `employees.update` | Reversible write | B |
| `employees.changeAvailability` | Reversible write | B |
| `messages.createTemplate` | Reversible write | B |
| `messages.updateTemplate` | Reversible write | B |
| `contracts.prepareDispatch` | Draft | C |
| `contracts.dispatch` | External side effect | C |
| `messages.previewSms` | Draft | C |
| `messages.sendSms` | External side effect | C |
| `messages.scheduleSms` | External side effect | C |
| `consultations.list` | Read | D |
| `consultations.markRead` | Reversible write | D |
| `calls.list` | Read | D |
| `calls.summarize` | Read | D |
| `clientDrafts.list` | Read | D |
| `clientDrafts.update` | Reversible write | D |
| `clientDrafts.confirm` | Write | D |
| `files.search` | Read | D |
| `files.updateMetadata` | Reversible write | D |
| `files.delete` | Irreversible write | D |
| `serviceRecords.getStatus` | Read | D |
| `analytics.explain` | Read | D |
| `admin.createBranch` | Privileged administration | D |

## Appendix B: Analytics event taxonomy

Suggested events:

1. `agent_conversation_created`
2. `agent_message_sent`
3. `agent_response_started`
4. `agent_response_completed`
5. `agent_response_stopped`
6. `agent_capability_routed`
7. `agent_tool_started`
8. `agent_tool_completed`
9. `agent_tool_failed`
10. `agent_entity_choice_presented`
11. `agent_entity_selected`
12. `agent_form_presented`
13. `agent_form_submitted`
14. `agent_action_proposed`
15. `agent_action_approved`
16. `agent_action_rejected`
17. `agent_action_expired`
18. `agent_action_started`
19. `agent_action_completed`
20. `agent_action_failed`
21. `agent_action_uncertain`
22. `agent_action_reconciled`
23. `agent_navigation_clicked`
24. `agent_feedback_submitted`
25. `agent_conversation_archived`
26. `agent_conversation_deleted`

Events must not contain unrestricted personal data.

## Appendix C: Glossary

| Term | Meaning |
|---|---|
| Operational copilot | The BabyJamJam assistant that can inspect and operate application features through authorized capabilities |
| Capability | A typed, versioned, authorized operation exposed to the agent |
| Canonical use case | The application service or command used by both ordinary UI and AI surfaces |
| Action | A durable proposed or executing side effect |
| Approval | A structured decision bound to an immutable action ID |
| Entity memory | Structured references to selected records within a branch-scoped session |
| Structured message part | A typed UI element such as text, activity, form, approval, result, or entity choice |
| Capability manifest | Generated inventory of available capabilities and metadata |
| Capability drift | A mismatch between application behavior and assistant capability contracts |
| Provider uncertainty | A state where an external request may have completed but the final result is not yet verified |
| Strong approval | Approval with additional warning, reauthentication, or privileged role requirements |
| Shadow mode | Evaluation mode that predicts behavior without executing production side effects |

## Appendix D: Traceability to ADR 0001

This PRD implements the product implications of the architecture decision as follows:

| ADR decision | PRD sections |
|---|---|
| ChatGPT inspired interface | Sections 14 through 16 |
| Gemini 3.5 Flash-Lite | Sections 18.2 and 34 |
| AI SDK typed agent runtime | Sections 18.2, 18.3, and 32 |
| Single operational agent | Sections 12 and 18.3 |
| Domain owned capabilities | Sections 18.3 and 22 |
| Canonical application use cases | Sections 8, 18.3, and 21 |
| User and branch scoped sessions | Sections 17 and 18.1 |
| Durable actions and approval | Sections 16, 18.5, and 20 |
| Idempotency and audit | Sections 18.5, 18.8, and 25 |
| Capability synchronization | Section 22 |
| Evaluations and deterministic tests | Sections 27 and 28 |
| Phased rollout | Sections 12, 29, and 34 |
