# ADR 0001: Adopt a Capability Driven AI Operational Copilot

| Field | Value |
|---|---|
| Status | Accepted |
| Decision date | 2026-08-02 |
| Implementation status | Planned |
| Decision owners | Product owner and engineering |
| Affected systems | Backend, frontend, mobile, shared packages, CI, observability |
| Supersedes | The current prototype AI chat architecture |

## 1. Decision summary

BabyJamJam will replace the current prompt driven chatbot prototype with a capability driven operational copilot that can safely inspect and operate application features through canonical application use cases.

The accepted architecture has the following defining decisions:

1. The chat experience will use a ChatGPT inspired interaction model with a conversation sidebar, centered message thread, floating composer, assistant responses without large chat bubbles, and structured operational cards.
2. The default model will be `gemini-3.5-flash-lite`, configured through environment variables and accessed through a provider abstraction.
3. The canonical orchestration runtime will use AI SDK 6 with a typed tool loop rather than the current custom Gemini function calling loop.
4. A single operational agent will be used initially. Domain capability bundles will be selected dynamically for each turn.
5. Every chat enabled operation will be registered as a typed capability owned by the same domain module as its canonical application use case.
6. The ordinary UI and the AI assistant will invoke the same application use cases. The AI layer will not implement duplicate business workflows.
7. Sessions will be bound to the authenticated user and selected branch.
8. All side effects will use server managed action records, explicit approval, authorization, audit logging, and idempotency.
9. The chatbot will remain synchronized with application changes through a generated capability manifest, schema compatibility tests, permission parity tests, renderer coverage tests, and pull request impact reporting.
10. The real tool execution and approval loop will be covered by deterministic end to end tests and behavior evaluations.

## 2. Context

BabyJamJam is a multi application operational platform for postpartum care service management. The repository contains a NestJS backend, desktop and mobile Next.js applications, shared contracts, native applications, and integrations with external providers such as eformsign, Aligo, storage services, and AI providers.

The current AI chat implementation provides a useful prototype, but it is not a durable application agent.

The current implementation includes:

1. A large static system prompt in `backend/application/services/ai-chat.service.ts`.
2. A manually maintained flat list of tool declarations under `backend/application/ai-chat/tools/`.
3. A large tool execution switch in `backend/application/ai-chat/tool-executor.service.ts`.
4. A custom tool calling loop that serializes function calls and results into ordinary text messages.
5. Text based confirmation, where the user sends words such as `확인` to continue an operation.
6. Exact phrase interception in the frontend for a small number of local chat wizards.
7. Session persistence that stores text messages but does not preserve structured tool calls, action state, or branch ownership.
8. Limited capability coverage compared with the complete application surface.
9. An end to end Gemini stub that intentionally does not exercise the tool execution loop.

These constraints cause several observed and foreseeable problems:

1. The model often fails to understand instructions that differ from examples in the prompt.
2. Follow up references such as “그 산모,” “두 번째 관리사,” and “방금 계약서” can be lost.
3. Confirmation is not cryptographically or transactionally bound to an exact action.
4. Automatic stream retries can repeat external side effects.
5. New application features do not automatically become available to the chatbot.
6. AI specific business paths can drift from the workflows used by the normal application UI.
7. Tool authorization can diverge from controller authorization.
8. A larger flat tool list will reduce tool selection accuracy as application coverage grows.
9. Prompt maintenance will become increasingly difficult as terminology, workflows, and features evolve.

## 3. Problem statement

BabyJamJam needs an operational service chatbot that can:

1. Understand natural Korean and English instructions.
2. Search, explain, create, update, and operate records across the application.
3. Complete multi step tasks while preserving entity context.
4. Respect user role, branch membership, and tenant boundaries.
5. Require explicit approval for sensitive actions.
6. Prevent duplicate or conflicting side effects.
7. Display application operations clearly inside the conversation.
8. Stay synchronized with new application features and schema changes.
9. Be measurable through traces, evaluations, and user feedback.
10. Remain provider adaptable without coupling business logic to one model vendor.

## 4. Decision drivers

The decision prioritizes the following qualities, in order:

1. Tenant and authorization safety
2. Side effect correctness
3. Business workflow parity
4. Tool selection reliability
5. Maintainability as the application grows
6. Clear operational user experience
7. Auditability and observability
8. Evaluation coverage
9. Model and provider portability
10. Cost and response latency

## 5. Scope

This ADR governs:

1. The desktop and mobile chat experience
2. Agent orchestration
3. Model configuration
4. Tool and capability definitions
5. Application use case integration
6. Session and message persistence
7. Entity resolution and conversation state
8. Action approval and execution
9. Authorization and tenant isolation
10. Idempotency and audit trails
11. Capability synchronization
12. Agent testing and evaluation
13. Agent observability and rollout

## 6. Non goals

This ADR does not authorize the following:

1. Direct browser or DOM automation against BabyJamJam itself
2. Automatic exposure of every REST endpoint as a model tool
3. Unrestricted autonomous execution of destructive actions
4. Cross branch data access through conversational context
5. Model controlled authorization decisions
6. A multi agent architecture at initial implementation
7. Replacement of deterministic application validation with model reasoning
8. Storage of current operational data in embeddings as a substitute for live queries
9. Pixel perfect copying of ChatGPT branding or proprietary visual details
10. Automatic execution of unsupported third party operations

## 7. User experience decision

### 7.1 ChatGPT inspired interaction model

The assistant UI will follow the interaction principles users associate with ChatGPT while remaining visually consistent with the Glint design system.

The desktop layout will contain:

1. A collapsible conversation sidebar
2. A new conversation action
3. Conversation search
4. Recent conversation titles grouped by time
5. Archive and delete actions
6. A visible current branch context
7. A centered conversation column
8. A floating multiline composer
9. Attachment support where the domain permits it
10. Stop, retry, copy, and feedback actions

The mobile layout will contain:

1. A conversation drawer
2. A full width message thread
3. A safe area aware composer
4. Keyboard safe positioning
5. Structured action cards adapted for a narrow viewport

### 7.2 Message presentation

User messages may use compact right aligned bubbles.

Assistant responses will normally render without a large colored bubble. They will appear as content in the centered thread with clear typography, tables, links, and structured result components.

Technical tool names such as `getContractStatus` will not be shown to operators. Tool activity will use human readable progress labels such as:

```text
김민지 산모를 찾는 중
산모 정보 확인 완료
계약서 상태를 확인하는 중
```

Completed activity may collapse into a disclosure such as `2단계 작업 완료`.

### 7.3 Structured message parts

The conversation protocol will support typed parts rather than a single text field.

Required part types include:

```text
text
reasoning_summary
activity
entity_choice
form_request
action_proposal
approval_request
approval_response
action_result
navigation
attachment
warning
error
```

The frontend will render these through a generic part registry.

The frontend will not infer action state by searching assistant text for phrases such as `하시겠습니까?`.

### 7.4 Removal of competing chat paths

Exact phrase interception for commands such as `산모 등록`, `계약서 전송`, and `계약서 상태 조회` will be removed after equivalent structured capabilities are available.

All text input, quick actions, forms, and approval buttons will use the same agent session and action protocol.

## 8. Model decision

### 8.1 Default model

The default operational model will be configured as:

```env
GEMINI_CHAT_MODEL=gemini-3.5-flash-lite
USE_VERCEL_AI_SDK=true
```

The model identifier will not be hard coded in domain code.

### 8.2 Provider abstraction

Application and domain layers will not import provider specific types.

The model adapter will own:

1. Provider initialization
2. Model selection
3. Model specific generation options
4. Provider error normalization
5. Tool protocol conversion where necessary
6. Usage and latency telemetry

Model specific settings must be verified for the selected model before use. The current global temperature configuration will not remain part of the domain level agent contract. Unsupported or unnecessary sampling options will be removed or isolated inside the provider adapter.

### 8.3 Model policy

The initial model policy is:

```ts
const modelPolicy = {
  default: "gemini-3.5-flash-lite",
};
```

A stronger fallback model will not be introduced until evaluation data demonstrates a defined failure class that cannot be resolved through better schemas, routing, deterministic workflows, or prompts.

Model replacement alone is not considered a solution for missing authorization, approval, idempotency, or workflow parity.

## 9. Agent runtime decision

### 9.1 Canonical runtime

AI SDK 6 will be the canonical orchestration runtime.

The implementation will use a typed agent tool loop rather than the current compatibility shaped `IGeminiGateway` orchestration.

The runtime must preserve native structured message and tool parts, including stable tool call identifiers.

### 9.2 One operational agent initially

The initial architecture will use one BabyJamJam operational agent.

The runtime will select a limited domain capability bundle for each request. It will not provide every capability to the model on every turn.

A multi agent architecture may be considered later only when evaluation evidence shows that a separate specialist has a measurable benefit that exceeds its latency, complexity, and context transfer costs.

### 9.3 Dynamic capability selection

A lightweight routing step will identify the relevant domain and operation class.

Example domains include:

```text
clients
employees
consultations
calls
contracts
messages
files
prices
service_records
notifications
settings
admin
analytics
navigation
```

The runtime will expose only the capabilities relevant to the selected domain and authenticated principal.

### 9.4 Deterministic composite workflows

High consequence operations will be represented as composite application capabilities rather than improvised sequences of low level tools.

Examples include:

1. Preparing and dispatching a contract
2. Sending or scheduling an SMS
3. Confirming a client draft from a call transcript
4. Replacing an assigned caregiver
5. Terminating a service
6. Deleting or cancelling an electronic document
7. Creating or updating a branch
8. Retrying a failed external delivery

The model may collect intent and missing information. The canonical use case will control validation, sequencing, concurrency, reconciliation, and side effects.

## 10. Capability architecture decision

### 10.1 Domain owned capabilities

Every chat enabled operation will be defined inside or beside the domain module that owns its canonical application use case.

Example structure:

```text
backend/
  application/
    clients/
      usecases/
      agent/
        client.capabilities.ts
    contracts/
      usecases/
      agent/
        contract.capabilities.ts
```

The agent module will discover domain capabilities through NestJS dependency injection.

Adding a capability must not require editing a central execution switch.

### 10.2 Single source capability definition

A capability definition will contain the complete operational contract:

```ts
interface CapabilityDefinition<TInput, TOutput> {
  name: string;
  version: number;
  title: string;
  description: string;
  domain: string;
  inputSchema: ZodType<TInput>;
  outputSchema: ZodType<TOutput>;
  risk: ActionRisk;
  branchScope: "required" | "global";
  requiredGlobalRoles?: string[];
  requiredBranchRoles?: string[];
  needsApproval:
    | boolean
    | ((input: TInput, context: AgentContext) => boolean);
  execute(
    context: AgentContext,
    input: TInput,
  ): Promise<TOutput>;
  ui: {
    activity?: string;
    input?: string;
    approval?: string;
    result: string;
  };
}
```

This definition will be the source for:

1. Model tool schemas
2. Runtime validation
3. Authorization metadata
4. Approval policy
5. Execution
6. UI renderer selection
7. Capability documentation
8. Manifest generation
9. Evaluation coverage
10. Version tracking

### 10.3 Canonical application use cases

The ordinary application UI and AI capabilities will invoke the same use cases.

```text
Desktop UI     ┐
Mobile UI      ├──> Canonical application use case ──> Domain and infrastructure
AI capability  ┘
```

The following architecture is prohibited:

```text
Desktop workflow ──> Implementation A
Mobile workflow  ──> Implementation B
AI tool          ──> Implementation C
```

### 10.4 No automatic controller exposure

Controllers and OpenAPI specifications may assist documentation or compatibility checks, but they will not automatically become AI tools.

A conversational capability must be reviewed for:

1. User intent
2. Input semantics
3. Authorization
4. Tenant scope
5. Risk
6. Approval
7. Idempotency
8. User visible consequences
9. Result presentation
10. Evaluation coverage

## 11. Session and context decision

### 11.1 Session ownership

Every session will be bound to:

1. `sessionId`
2. `userId`
3. `branchId`
4. `locale`
5. `agentVersion`
6. `model`

A session may be loaded only when all required ownership fields match the authenticated request context.

A branch switch will create a new session or explicitly reset branch dependent context.

### 11.2 Structured persistence

Messages will preserve structured parts instead of only plain text.

The persisted representation must retain:

1. Tool call ID
2. Capability name and version
3. Validated input
4. Tool result
5. Approval request
6. Approval response
7. Action ID
8. Entity references
9. Navigation metadata
10. Trace ID

### 11.3 Entity memory

The session will preserve structured selected entities separately from natural language text.

Example:

```json
{
  "currentClient": {
    "id": 483,
    "name": "김민지",
    "branchId": "branch-uuid"
  },
  "currentEmployee": {
    "id": 92,
    "name": "박영숙",
    "branchId": "branch-uuid"
  },
  "currentContract": {
    "documentId": "document-id",
    "clientId": 483
  }
}
```

This state will support follow ups such as `그 산모`, `두 번째 관리사`, and `방금 계약서` without relying only on the language model to reconstruct context.

### 11.4 Context compaction

Recent structured messages will remain available directly.

Older messages will be summarized into a versioned session summary that preserves:

1. User goals
2. Confirmed facts
3. Selected entities
4. Completed actions
5. Pending actions
6. Rejected actions
7. Unresolved questions

Action records and authoritative business data will never be replaced by a summary.

## 12. Authorization and tenant decision

### 12.1 Verified principal

Every capability execution will receive a verified context:

```ts
interface AgentPrincipal {
  userId: string;
  branchId: string;
  globalRole: string;
  branchRole: string;
}
```

The model will never supply or override these fields.

### 12.2 Server side authorization

Every capability must declare its authorization policy.

Authorization will be enforced before proposal creation and again immediately before execution.

The permission model for the AI capability must be equal to or stricter than the corresponding UI or controller operation.

### 12.3 Fail closed behavior

The runtime will fail closed when:

1. The selected branch is missing
2. Session ownership does not match
3. Branch membership is missing or inactive
4. Required role information cannot be resolved
5. A capability has no registered authorization policy
6. A global operation is incorrectly invoked as a branch operation
7. The target entity does not belong to the selected branch

## 13. Action and approval decision

### 13.1 Risk classes

Capabilities will use one of the following risk classifications:

```ts
type ActionRisk =
  | "read"
  | "draft"
  | "reversible_write"
  | "irreversible_write"
  | "external_side_effect"
  | "financial_or_paid"
  | "privileged_admin";
```

### 13.2 Action lifecycle

All mutations and side effects will use a durable server action lifecycle:

```text
requested
resolved
validated
proposed
approved or rejected
executing
completed, failed, or uncertain
```

### 13.3 Immutable action proposal

An action proposal will store:

```ts
interface AgentAction {
  id: string;
  sessionId: string;
  userId: string;
  branchId: string;
  capabilityName: string;
  capabilityVersion: number;
  normalizedInput: unknown;
  inputHash: string;
  targetSnapshot: unknown;
  targetVersion?: string;
  risk: ActionRisk;
  status: AgentActionStatus;
  idempotencyKey: string;
  approvedBy?: string;
  approvedAt?: Date;
  result?: unknown;
  error?: unknown;
  expiresAt: Date;
}
```

### 13.4 Explicit approval endpoints

Approval will use an action identifier:

```http
POST /ai/actions/:actionId/approve
POST /ai/actions/:actionId/reject
```

The frontend will not approve a side effect by sending a natural language word back to the model.

### 13.5 Revalidation

Immediately before execution, the server will revalidate:

1. Session ownership
2. User authorization
3. Selected branch
4. Action expiration
5. Capability version
6. Target existence
7. Target version or state
8. Conflicting operations
9. Previous execution result
10. External provider preconditions

### 13.6 Idempotency

Every side effect will use a stable idempotency key derived from the durable action record.

Repeated requests for a completed action will return the recorded result rather than execute again.

This requirement applies especially to:

1. Contract dispatch
2. SMS and notification delivery
3. Scheduled messaging
4. Client and employee creation
5. Service termination
6. Electronic document cancellation or deletion
7. Message retry
8. Branch and role administration

## 14. Persistence decision

The existing chat persistence model will be extended or replaced with the following logical records.

### 14.1 `agent_session`

| Field | Purpose |
|---|---|
| `id` | Session identity |
| `userId` | Session owner |
| `branchId` | Tenant boundary |
| `locale` | Response language |
| `title` | Conversation title |
| `summary` | Compacted context |
| `selectedEntities` | Structured entity memory |
| `model` | Model identifier |
| `agentVersion` | Runtime and prompt version |
| `createdAt` | Creation time |
| `expiresAt` | Session expiration |

### 14.2 `agent_message`

| Field | Purpose |
|---|---|
| `id` | Stable message identity |
| `sessionId` | Parent session |
| `role` | User, assistant, system, or tool |
| `parts` | Structured JSON parts |
| `traceId` | Run trace reference |
| `createdAt` | Creation time |

### 14.3 `agent_action`

The action record will contain the immutable proposal, authorization context, approval, idempotency, execution state, and result.

### 14.4 `agent_trace`

The trace record or external trace reference will contain:

1. Model request and response metadata
2. Selected capability bundle
3. Tool calls and results
4. Latency
5. Token usage
6. Approval events
7. Errors
8. Final outcome
9. Model and agent version
10. Redaction metadata

Sensitive personal data must be redacted from general logs. Access to full operational traces must follow the same or stricter authorization policy as the source business records.

## 15. Capability synchronization decision

### 15.1 Capability manifest

The build will generate a machine readable capability manifest.

Example:

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
      "risk": "read",
      "status": "enabled"
    },
    {
      "name": "contracts.dispatch",
      "version": 1,
      "domain": "contracts",
      "risk": "external_side_effect",
      "status": "experimental"
    }
  ]
}
```

An authenticated diagnostic endpoint may expose non sensitive manifest metadata:

```http
GET /ai/capabilities
```

### 15.2 Chat eligible use case inventory

The repository will maintain an explicit inventory of application use cases that are expected to support chat.

A use case must not become chat enabled merely because it is public or has a controller.

### 15.3 CI drift gates

CI will fail when any of the following conditions occur:

1. A chat eligible use case has no capability
2. A capability input schema is incompatible with its canonical command schema
3. A capability output schema is incompatible with its canonical result schema
4. Capability authorization is weaker than controller or UI authorization
5. A write capability has no approval policy
6. A side effect capability has no idempotency policy
7. A capability references an unregistered UI renderer
8. A write capability has no approval evaluation
9. A capability version changes without a manifest update
10. A removed capability still has active pending actions without a migration policy

### 15.4 Pull request impact report

Pull requests that change controllers, DTOs, domain services, command schemas, use cases, or capability definitions will generate an AI capability impact report.

Example:

```text
AI Capability Impact Report

Changed domains
Client
Contract
Message delivery

Affected capabilities
clients.update
contracts.dispatch
messages.send

Findings
UpdateClientCommand added suppressGreetingSms.
The capability schema does not expose or intentionally exclude the field.

ContractDispatchResult added reconciliationStatus.
The registered result renderer does not support the field.

Result
Capability compatibility check failed.
```

### 15.5 Capability versioning

Capabilities will have a status and version:

```ts
type CapabilityStatus =
  | "experimental"
  | "enabled"
  | "deprecated"
  | "disabled";
```

A behavior or schema change that affects action meaning requires a capability version increment.

Pending actions will retain the exact capability version used to create them. A pending action will not execute under silently changed semantics.

## 16. Knowledge freshness decision

Three kinds of freshness will be treated separately.

### 16.1 Operational data freshness

Clients, employees, contracts, schedules, messages, files, prices, calls, and other operational records will always come from live application use cases.

Operational records will not be copied into a static prompt or embedding index as the source of truth.

### 16.2 Product capability freshness

Product capability freshness will come from:

1. Domain owned capability definitions
2. Versioned schemas
3. Canonical use cases
4. Generated capability manifest
5. CI drift gates
6. Pull request impact reports

### 16.3 Policy and documentation freshness

Business policy and help content may use a versioned retrieval layer.

Each policy document should include metadata such as:

```yaml
id: contract-dispatch-policy
version: 1
effectiveDate: 2026-08-02
owner: operations
reviewedAt: 2026-08-02
```

Retrieved policy content may inform explanations and input collection. It will not replace server side validation or authorization.

## 17. Testing and evaluation decision

### 17.1 Deterministic agent end to end tests

The deterministic AI provider stub will support scripted tool calls, tool results, approval interruption, approval resumption, and failures.

The end to end suite will exercise the actual agent loop against isolated application data and vendor stubs.

### 17.2 Required test classes

The test suite will include:

1. Session ownership tests
2. Branch isolation tests
3. Role and permission parity tests
4. Tool selection tests
5. Argument validation tests
6. Entity ambiguity tests
7. Follow up entity reference tests
8. Approval proposal tests
9. Approval rejection tests
10. Approval expiration tests
11. Idempotency tests
12. Stream retry after successful side effect tests
13. Canonical workflow parity tests
14. External provider uncertainty tests
15. Capability manifest tests
16. Renderer coverage tests
17. Capability deprecation tests

### 17.3 Behavior evaluations

The repository will maintain Korean and English evaluation cases for:

1. Colloquial terminology
2. Ambiguous names
3. Follow up pronouns
4. Missing fields
5. Date interpretation
6. Multi step requests
7. Several actions in one instruction
8. Unauthorized actions
9. Branch switching
10. Contract duplication
11. Paid message sending
12. Partial external failures
13. Conflicting instructions
14. Bulk action previews
15. Unsupported requests

### 17.4 Metrics

Required metrics include:

| Metric | Definition |
|---|---|
| Domain accuracy | Correct domain selected |
| Capability accuracy | Correct capability selected |
| Argument accuracy | Correct normalized fields and identifiers |
| Entity resolution accuracy | Correct business entity selected |
| Approval accuracy | Sensitive actions pause correctly |
| Authorization accuracy | Forbidden actions are blocked |
| Task completion | Intended business outcome is reached |
| Duplicate action rate | Same side effect executes more than once |
| Unsafe action rate | Side effect executes without required approval |
| Recovery rate | Agent recovers from expected tool or provider failures |
| Latency | End to end and per step latency |
| Cost | Tokens and provider cost per task |

## 18. Observability decision

Every run will emit a trace identifier that connects:

1. User request
2. Session
3. Selected branch
4. Agent and model version
5. Selected capability bundle
6. Tool calls
7. Action proposal
8. Approval
9. Execution
10. Final result

The existing feedback feature will be extended so negative feedback can be analyzed against the complete structured trace rather than only assistant text.

Development tooling that records prompts or personal data must remain disabled in production unless storage, access, retention, and redaction have been explicitly approved.

## 19. Proposed repository structure

```text
backend/
  application/
    agent/
      agent-runtime.service.ts
      agent-context.service.ts
      capability-registry.service.ts
      capability-router.service.ts
      action-coordinator.service.ts
      agent-trace.service.ts
      capabilities/
        clients/
        employees/
        consultations/
        calls/
        contracts/
        messages/
        files/
        prices/
        service-records/
        admin/

  domain/
    entities/
      agent-session.entity.ts
      agent-action.entity.ts
    repositories/
      agent-session.repository.ts
      agent-action.repository.ts

  infrastructure/
    agent/
      ai-sdk-agent.factory.ts
      model-adapter.ts
      model-policy.ts
    database/
      repositories/
        agent-session.repository.ts
        agent-action.repository.ts

  interface/
    controllers/
      agent.controller.ts
      agent-action.controller.ts
    dto/
      agent.dto.ts
      agent-action.dto.ts

packages/shared/
  src/
    agent/
      message-parts.ts
      action-types.ts
      capability-types.ts

frontend/
  src/components/app/chat/
    shell/
    composer/
    conversation-sidebar/
    parts/
      TextPart.tsx
      ActivityPart.tsx
      EntityChoicePart.tsx
      FormRequestPart.tsx
      ActionApprovalPart.tsx
      ActionResultPart.tsx
      NavigationPart.tsx

evals/
  agent/
    cases.jsonl
    run-agent-evals.ts
    graders/
    fixtures/
```

The final placement may be adjusted to match existing repository layering, but the separation of runtime, capability, action, persistence, shared contracts, UI parts, and evaluations is mandatory.

## 20. Migration plan

### Phase 0: Safety foundation

1. Bind sessions to `userId` and `branchId`.
2. Reject mismatched session IDs.
3. Reset context after branch changes.
4. Introduce durable agent action records.
5. Introduce explicit approve and reject endpoints.
6. Introduce idempotency keys.
7. Pass a verified principal into every capability.
8. Add immutable audit events.
9. Add cross user and cross branch tests.
10. Keep new mutation capabilities disabled until these controls pass.

### Phase 1: Runtime foundation

1. Introduce the AI SDK agent runtime.
2. Introduce Zod based capability schemas.
3. Introduce the capability registry.
4. Introduce dynamic capability selection.
5. Persist structured message parts.
6. Introduce generic chat part renderers.
7. Remove text based confirmation.
8. Remove exact phrase wizard interception after replacement.
9. Configure `gemini-3.5-flash-lite` as the default model.
10. Add deterministic agent end to end tests.

### Phase 2: Existing capability migration

Migrate the current capability set to canonical use cases in this order:

1. Client search and detail
2. Employee search and detail
3. Dashboard reads
4. Schedule reads
5. Voucher and bank account reads
6. Contract status reads
7. Client and employee writes
8. Contract preparation and dispatch
9. Existing message record operations

### Phase 3: Missing domain coverage

Add new capabilities in this order:

1. Consultations
2. Call records and transcript summaries
3. Client drafts
4. Message previews and delivery
5. Scheduled messaging and delivery history
6. Message automation rules
7. File search and metadata management
8. Service record administration
9. Notifications and settings
10. Owner only system administration
11. Website administration
12. Analytics explanations

### Phase 4: Intelligence improvements

1. Entity memory
2. Context compaction
3. Policy retrieval
4. Compound task planning
5. Bulk action previews
6. Model comparison and optional fallback policy
7. Proactive operational suggestions

### Phase 5: Controlled rollout

1. Internal shadow mode
2. Read only production release
3. Reversible writes
4. External side effects
5. Destructive actions
6. Privileged administration
7. Domain level feature flags
8. Automatic rollback thresholds based on safety metrics

## 21. Acceptance criteria

This decision is considered implemented only when all of the following are true:

1. The default configured model is `gemini-3.5-flash-lite`.
2. The custom text serialized tool loop is no longer the canonical runtime.
3. Sessions are scoped to authenticated user and branch.
4. Structured tool calls and results are persisted.
5. The UI uses a ChatGPT inspired shell and structured message parts.
6. Text matching is not used to determine approvals.
7. Side effects use durable action records and idempotency.
8. Every capability enforces server side authorization.
9. The first migrated domains invoke canonical use cases shared with normal UI paths.
10. The capability manifest is generated in CI.
11. Schema, permission, renderer, approval, and evaluation drift gates run in CI.
12. The deterministic end to end suite exercises tool calls and approvals.
13. Agent traces connect requests, tools, approvals, and results.
14. Mutation capabilities can be enabled and disabled independently.
15. No capability can access another branch through session context or entity memory.

## 22. Consequences

### 22.1 Positive consequences

1. New features can become chat accessible through a defined domain workflow.
2. The chatbot remains synchronized with application changes through CI.
3. Business logic remains consistent across desktop, mobile, API, and AI surfaces.
4. Approval becomes explicit and auditable.
5. Duplicate external side effects are preventable.
6. Tool selection becomes easier because the model sees fewer relevant capabilities.
7. Follow up conversations become more reliable through structured entity memory.
8. The UI can present operational work clearly without reducing everything to prose.
9. Model providers can change without rewriting domain behavior.
10. Failures become diagnosable through structured traces and evaluations.

### 22.2 Negative consequences

1. The migration requires meaningful backend, frontend, data model, and CI work.
2. Capability registration adds an explicit maintenance responsibility to each domain.
3. Structured messages and actions increase persistence complexity.
4. Approval and idempotency introduce additional database operations.
5. Dynamic routing adds another evaluated model or deterministic classification step.
6. Supporting old sessions and pending actions may require migration logic.
7. The assistant will not immediately support every application feature.
8. Some workflows will use embedded forms or UI handoff instead of pure natural language.

### 22.3 Accepted tradeoff

The additional engineering complexity is accepted because the alternative is an increasingly unsafe and unmaintainable chatbot whose behavior depends on prompt wording and duplicated workflows.

## 23. Alternatives considered

### 23.1 Continue extending the current prompt and switch statement

Rejected.

This approach has low initial cost but increases prompt conflict, tool ambiguity, duplicated business logic, and synchronization risk.

### 23.2 Change only the model

Rejected as a complete solution.

A stronger or newer model cannot establish session ownership, authorization, immutable approval, idempotency, or workflow parity.

### 23.3 Expose controllers or OpenAPI operations automatically

Rejected.

Controller operations are too low level and may not provide conversational semantics, risk classification, approval, idempotency, or appropriate result presentation.

### 23.4 Use browser automation to operate BabyJamJam

Rejected.

Internal browser automation is less reliable, harder to authorize, slower, and duplicates functionality already available through application use cases.

### 23.5 Start with multiple specialist agents

Rejected for the initial implementation.

Multiple agents add context boundaries, latency, routing failure modes, and operational complexity before a measured need exists.

### 23.6 Adopt a second agent framework immediately

Rejected for the initial implementation.

The repository already contains AI SDK 6. Introducing a second orchestration runtime would create two abstractions and increase migration cost. A future framework change remains possible behind the capability and model adapter boundaries.

### 23.7 Preserve exact phrase local wizards alongside the agent

Rejected as a permanent architecture.

Two command systems produce inconsistent behavior for equivalent intentions. Structured UI parts provide a unified replacement.

## 24. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Flash Lite does not meet complex planning quality | Measure with evaluations, improve capability schemas and deterministic workflows first, then consider a fallback policy |
| Capability registry becomes stale | Generated manifest and CI drift gates |
| Authorization differs from application UI | Permission parity tests and shared policy functions |
| User approves stale data | Target snapshots, version checks, expiration, and execution revalidation |
| Network retry repeats side effects | Durable action ID and idempotency key |
| Tool list becomes too large | Dynamic domain routing and capability filtering |
| Structured UI becomes inconsistent | Shared message part contracts and renderer registry |
| Personal data leaks into traces | Redaction, restricted access, retention controls, and production telemetry policy |
| Old pending actions execute under new semantics | Capability version binding and expiration |
| AI path diverges from UI path | Canonical shared application use cases |

## 25. Operational governance

The following changes require either an amendment to this ADR or a new ADR:

1. Replacing AI SDK as the canonical runtime
2. Introducing a multi agent production architecture
3. Changing the default model family or provider strategy
4. Removing durable action approval
5. Allowing model controlled authorization
6. Automatically generating capabilities from controllers
7. Changing the branch isolation model
8. Allowing autonomous destructive actions
9. Replacing structured message parts with plain text only
10. Removing capability compatibility gates from CI

## 26. Revisit triggers

This decision should be reviewed when any of the following occurs:

1. Evaluation data shows the selected default model cannot meet required task completion thresholds.
2. The capability count creates measurable routing or latency problems.
3. A second agent or specialist can demonstrate a significant measured improvement.
4. The application adopts a different canonical command or workflow architecture.
5. Compliance requirements change for personal data, audit logs, or automated decisions.
6. The provider tool calling protocol requires a material runtime redesign.
7. More than one production incident is caused by capability drift.
8. Structured action persistence becomes a scaling bottleneck.

## 27. Implementation rule

No new AI mutation capability may be enabled in production until Phase 0 acceptance criteria are satisfied.

Read capabilities may be migrated earlier only when they enforce session ownership, branch isolation, and server side authorization.
