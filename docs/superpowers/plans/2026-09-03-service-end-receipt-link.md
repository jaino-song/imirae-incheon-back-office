TL;DR: "서비스 종료 안내" SMS 템플릿을 추가하고, 발송 직전에 계약서 PDF 7쪽(영수증)을 PNG로 렌더링해 30일짜리 생년월일 보호 링크를 만들어 문자에 심는다. 자동 규칙과 수동 발송이 같은 MessageTriggerJob 경로를 타고, m.admin에 산모용 공개 페이지(생년월일 확인 → 이미지 저장)를 붙이며, 검토→완료 자동 전환 유예를 7일로 바꾼다. 4개 페이즈, 15개 태스크.

# 서비스 종료 안내 영수증 링크 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 바우처 산모에게 "서비스 종료 안내" 문자로 본인부담금 영수증 PNG 링크(30일, 생년월일 확인)를 자동·수동으로 보내고, 계약 자동 완료 유예를 7일로 조정한다.

**Architecture:** 템플릿 카탈로그(shared + backend registry/catalog/delivery config)에 `SERVICE_END_NOTICE`를 추가한다. 링크 발급(가드 → 미러 PDF → pdf.js 렌더 → Supabase Storage 업로드 → 토큰)은 `ReceiptLinkIssueService`가 담당하고, `SmsTriggerDeliveryService.sendJob` 직전에 새 `SmsTriggerPayloadEnricherRegistry` 훅으로 `receiptUrl`을 payload에 주입한다(모듈 순환 없이 `ReceiptLinkModule`이 자기 enricher를 등록). 수동 발송은 동기 preflight 후 합성 규칙 `system:service_end_notice`의 job을 enqueue한다. 산모는 m.admin `/receipt/[token]`에서 생년월일(YYMMDD)로 본인 확인 후 이미지를 저장한다.

**Tech Stack:** NestJS(CommonJS) + Prisma + pdfjs-dist 4.10.38(legacy ESM, 동적 import 셸) + @napi-rs/canvas 0.1.100 + Supabase Storage(`documents` 버킷) + Aligo SMS, Next.js(m.admin 공개 라우트 + BFF), React(admin), jest 30 / vitest / Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-service-end-receipt-link-design.md` (승인된 목업: https://claude.ai/code/artifact/b8525136-d170-4aae-a635-be51a0f83770)

## Global Constraints

- 템플릿 이름은 정확히 `서비스 종료 안내`, 키는 `SERVICE_END_NOTICE`, 본문은 스펙 §5.1 문구 그대로(`{{name}}산모님~♡`, `{{receiptUrl}}`).
- 링크 유효기간은 발송(토큰 발급) 시점부터 **30일**. 본인 확인은 산모 생년월일 **YYMMDD 6자리**(8자리 입력 시 뒤 6자리), 5회 연속 실패 시 **30분 잠금**.
- 대상은 `client.voucherClient = true`인 산모만. 계약서 완료 여부는 보지 않는다. 영수증은 계약서 PDF **7쪽**.
- 산모 화면 문구는 스펙 §5.6(목업 확정본)을 그대로 쓴다. **확인 전에는 산모 이름을 노출하지 않고, 전화번호는 어느 화면에도 표시하지 않는다.**
- 자동 완료 유예: 기본값 `graceDays: 7`, 저장된 값은 SQL 패치로 전부 7.
- DB 변경은 `backend/prisma/migrations/<ts>_<name>/migration.sql` 하드코딩 SQL(additive only). CI의 `prisma migrate diff` 드리프트 가드를 통과해야 한다.
- 새 env 키: `MOBILE_RECEIPT_BASE_URL`(없으면 `MOBILE_SERVICE_RECORD_BASE_URL` → `https://m.admin.babyjamjam.com` 순 폴백), `RECEIPT_LINK_HASH_SALT`. `backend/.env`와 `backend/env.tpl` 둘 다 수정, 비밀값은 절대 출력하지 않는다.
- pdf.js는 Node에서 `disableFontFace: true, useSystemFonts: false, cMapUrl, cMapPacked: true, standardFontDataUrl` 옵션 필수(스파이크 검증). 동적 import 셸의 specifier는 **상수 문자열**만.
- 저장소 경로: `receipts/{branchId}/{eformsignDocId}/{sha256}.png`. 토큰은 평문을 저장하지 않고 sha256 해시만 저장한다(제공기록지 토큰과 동일; 스펙 §5.2의 "평문 저장" 문구는 Task 1.1에서 정정).
- 모든 커밋 트레일러: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01R21HZLCwYzbGBXVabKqFmU`.
- 워커 디스패치: 구현은 `Agent({subagent_type:"general-purpose", model:"sonnet"})` @ max, 유닛 워크트리 1개/태스크. 리뷰는 `phase-auditor`(opus @ max). 브리프마다 `EFFORT: max — use the full thinking budget; reason exhaustively before acting and verify before returning.` 를 붙인다.

---

## Phase 1 — 기반 (DB · 템플릿 카탈로그 · 자동 완료 7일 · 의존성/env)

한 줄 요약: 서로 파일이 겹치지 않는 네 가지 기반 작업을 한꺼번에 깔아, Phase 2가 타입과 테이블을 바로 쓰게 한다.

**In parallel:**
- **영수증 토큰 테이블** (db, medium)
  - `receipt_link_token` Prisma 모델 + 마이그레이션 SQL, 스펙 §5.2 해시 저장으로 정정.
- **템플릿 카탈로그 확장** (feature, medium)
  - shared 타입/라벨, backend registry·catalog·variable-sources·delivery config, 자동 변수 빌더, 프론트 fallback 맵. 드리프트 가드 통과.
- **자동 완료 유예 7일** (config, low)
  - 기본값 7 + 저장값 UPDATE 패치 + 테스트 갱신.
- **의존성 · env 키** (infra, low)
  - `pdfjs-dist`, `@napi-rs/canvas` 설치, env.tpl/.env 키 추가, `env-check`.

#### Task 1.1: receipt_link_token 테이블
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260904000000_add_receipt_link_token/migration.sql`, `docs/superpowers/specs/2026-09-03-service-end-receipt-link-design.md`
**Depends:** none

**Files:**
- Modify: `backend/prisma/schema.prisma` (모델 `branch` ~586행, `client` 238~280행, `eformsign_doc` 336~370행에 역관계 추가, 파일 끝에 새 모델)
- Create: `backend/prisma/migrations/20260904000000_add_receipt_link_token/migration.sql`
- Modify: `docs/superpowers/specs/2026-09-03-service-end-receipt-link-design.md:125` (link_token 행)

**Interfaces:**
- Produces: Prisma 델리게이트 `prisma.receipt_link_token` (컬럼: `id, branchId, clientId, eformsignDocId, jobId, linkTokenHash, accessTokenHash, expectedBirthdayHash, verifiedAt, failedAttempts, lockedAt, expiresAt, active, revokedAt, storagePath, contentSha256, byteSize, source, createdBy, createdAt`). Task 2.2/2.4/2.7이 사용.

- [ ] **Step 1: Prisma 모델 추가**

`backend/prisma/schema.prisma` 끝에 추가:

```prisma
model receipt_link_token {
  id                   String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  branchId             String        @map("branch_id") @db.Uuid
  clientId             Int?          @map("client_id")
  eformsignDocId       Int           @map("eformsign_doc_id")
  jobId                String?       @map("job_id")
  linkTokenHash        String        @unique @map("link_token_hash")
  accessTokenHash      String?       @unique @map("access_token_hash")
  expectedBirthdayHash String        @map("expected_birthday_hash")
  verifiedAt           DateTime?     @map("verified_at") @db.Timestamptz(6)
  failedAttempts       Int           @default(0) @map("failed_attempts")
  lockedAt             DateTime?     @map("locked_at") @db.Timestamptz(6)
  expiresAt            DateTime      @map("expires_at") @db.Timestamptz(6)
  active               Boolean       @default(true)
  revokedAt            DateTime?     @map("revoked_at") @db.Timestamptz(6)
  storagePath          String        @map("storage_path")
  contentSha256        String        @map("content_sha256") @db.Char(64)
  byteSize             Int           @map("byte_size")
  source               String
  createdBy            String?       @map("created_by") @db.Uuid
  createdAt            DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  branch               branch        @relation(fields: [branchId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  client               client?       @relation(fields: [clientId], references: [id], onDelete: SetNull, onUpdate: NoAction)
  eformsignDoc         eformsign_doc @relation(fields: [eformsignDocId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@index([eformsignDocId, active], map: "idx_receipt_link_token_doc_active")
  @@index([jobId], map: "idx_receipt_link_token_job")
  @@index([expiresAt], map: "idx_receipt_link_token_expires")
  @@index([branchId], map: "idx_receipt_link_token_branch")
}
```

`branch`, `client`, `eformsign_doc` 모델 안(다른 `[]` 관계 필드 옆)에 각각 한 줄 추가:

```prisma
  receiptLinkTokens receipt_link_token[]
```

- [ ] **Step 2: 마이그레이션 SQL 작성**

`backend/prisma/migrations/20260904000000_add_receipt_link_token/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "receipt_link_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER,
    "eformsign_doc_id" INTEGER NOT NULL,
    "job_id" TEXT,
    "link_token_hash" TEXT NOT NULL,
    "access_token_hash" TEXT,
    "expected_birthday_hash" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMPTZ(6),
    "storage_path" TEXT NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_link_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_link_token_link_token_hash_key" ON "receipt_link_token"("link_token_hash");
CREATE UNIQUE INDEX "receipt_link_token_access_token_hash_key" ON "receipt_link_token"("access_token_hash");
CREATE INDEX "idx_receipt_link_token_doc_active" ON "receipt_link_token"("eformsign_doc_id", "active");
CREATE INDEX "idx_receipt_link_token_job" ON "receipt_link_token"("job_id");
CREATE INDEX "idx_receipt_link_token_expires" ON "receipt_link_token"("expires_at");
CREATE INDEX "idx_receipt_link_token_branch" ON "receipt_link_token"("branch_id");

-- AddForeignKey
ALTER TABLE "receipt_link_token" ADD CONSTRAINT "receipt_link_token_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "receipt_link_token" ADD CONSTRAINT "receipt_link_token_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "receipt_link_token" ADD CONSTRAINT "receipt_link_token_eformsign_doc_id_fkey" FOREIGN KEY ("eformsign_doc_id") REFERENCES "eformsign_doc"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
```

- [ ] **Step 3: 스키마 검증 + 드리프트 가드**

Run:
```bash
pnpm --filter ./backend exec prisma validate
pnpm --filter ./backend exec prisma generate
pnpm --filter ./backend exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
```
Expected: validate/generate 성공, diff exit code 0. (`SHADOW_DATABASE_URL`은 로컬 비어 있는 Postgres DB. 없으면 `docker run --rm -d -p 5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16` 후 `postgresql://postgres@localhost:5433/postgres`.) 드리프트가 나오면 SQL을 diff 출력에 맞춰 고친다 — 스키마가 아니라 SQL을 고친다.

- [ ] **Step 4: 스펙 정정**

`docs/superpowers/specs/...design.md:125` 행을 다음으로 교체:

```
| link_token_hash | varchar unique | sha256(`efr_` + 32바이트 base64url 평문). 평문은 URL에만 존재(제공기록지 `linkTokenHash`와 동일 정책) |
```

- [ ] **Step 5: 커밋**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260904000000_add_receipt_link_token docs/superpowers/specs/2026-09-03-service-end-receipt-link-design.md
git commit -m "feat(db): add receipt_link_token table for service-end receipt links"
```

#### Task 1.2: 템플릿 카탈로그 확장 (SERVICE_END_NOTICE)
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `packages/shared/src/types/message.ts`, `packages/shared/src/message/presentation.ts`, `backend/domain/constants/service-end-notice-message.ts`, `backend/domain/constants/system-template-registry.ts`, `backend/domain/constants/message-trigger-catalog.ts`, `backend/domain/constants/message-trigger-variable-sources.ts`, `backend/application/services/sms-trigger-delivery.service.ts`, `backend/application/services/message-trigger.service.ts`, `frontend/src/components/app/messages/TriggerRulesManager.tsx`, `backend/test/services/service-end-notice-catalog.spec.ts`
**Depends:** none

**Files:**
- Create: `backend/domain/constants/service-end-notice-message.ts`
- Modify: `backend/domain/constants/system-template-registry.ts` (enum 1~14행, `SYSTEM_TEMPLATE_REGISTRY` 38행~, THANKS 항목 256~275행 뒤)
- Modify: `backend/domain/constants/message-trigger-catalog.ts` (enum `MessageTriggerTemplateKey` 21~34행, `CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS` 37~45행, `MESSAGE_TRIGGER_TEMPLATE_CATALOG` 113행~, THANKS 항목 252~262행 뒤)
- Modify: `backend/domain/constants/message-trigger-variable-sources.ts` (`MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS` 16~71행)
- Modify: `backend/application/services/sms-trigger-delivery.service.ts` (`SMS_DELIVERY_CONFIG_VERSION`, `SMS_TEMPLATE_DELIVERY` ~100~185행)
- Modify: `backend/application/services/message-trigger.service.ts:1563-1600` (`buildClientTemplateVariables`)
- Modify: `packages/shared/src/types/message.ts:44-140`, `packages/shared/src/message/presentation.ts:35-53`
- Modify: `frontend/src/components/app/messages/TriggerRulesManager.tsx:168-225`
- Test: `backend/test/services/service-end-notice-catalog.spec.ts` (신규), 기존 `backend/test/services/message-trigger-template-consistency.spec.ts` 통과

**Interfaces:**
- Produces: `MessageTriggerTemplateKey.SERVICE_END_NOTICE = "SERVICE_END_NOTICE"`, `SystemTemplateKey.SERVICE_END_NOTICE = "SERVICE_END_NOTICE"`, 상수 `SERVICE_END_NOTICE_RULE_ID = "system:service_end_notice"`, `SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY = "service_end_notice_sms"`, `SERVICE_END_NOTICE_SMS_AUTOMATION_KEY = "SERVICE_END_NOTICE_SMS"`, `SERVICE_END_NOTICE_SMS_TITLE = "서비스 종료 안내"`, `SERVICE_END_NOTICE_DEFAULT_CONTENT`. 렌더 변수 `name`, `clientName`, `phone`, `receiptUrl`(필수: `name`, `receiptUrl`).

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/test/services/service-end-notice-catalog.spec.ts`:

```ts
import { MESSAGE_TRIGGER_TEMPLATE_CATALOG, MessageTriggerEventType, MessageTriggerRecipientType, MessageTriggerTemplateKey, CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS } from "domain/constants/message-trigger-catalog";
import { MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS } from "domain/constants/message-trigger-variable-sources";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { SERVICE_END_NOTICE_DEFAULT_CONTENT, SERVICE_END_NOTICE_SMS_TITLE } from "domain/constants/service-end-notice-message";
import { SMS_TEMPLATE_DELIVERY } from "application/services/sms-trigger-delivery.service";

describe("SERVICE_END_NOTICE template catalog", () => {
    it("is a client-only SERVICE_END sms template rendered from the system template", () => {
        const entry = MESSAGE_TRIGGER_TEMPLATE_CATALOG[MessageTriggerTemplateKey.SERVICE_END_NOTICE];
        expect(entry.name).toBe(SERVICE_END_NOTICE_SMS_TITLE);
        expect(entry.allowedEventTypes).toEqual([MessageTriggerEventType.SERVICE_END]);
        expect(entry.allowedRecipientTypes).toEqual([MessageTriggerRecipientType.CLIENT]);
        expect(entry.requiredVariables.map((v) => v.key)).toEqual(["name", "receiptUrl"]);
        expect(entry.providers.sms?.templateKey).toBe("SERVICE_END_NOTICE");
        expect(CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS).toContain(MessageTriggerTemplateKey.SERVICE_END_NOTICE);
    });

    it("ships the approved default body with name and receiptUrl placeholders", () => {
        const registry = SYSTEM_TEMPLATE_REGISTRY[SystemTemplateKey.SERVICE_END_NOTICE];
        expect(registry.defaultContent).toBe(SERVICE_END_NOTICE_DEFAULT_CONTENT);
        expect(registry.defaultContent).toContain("{{name}}산모님~♡");
        expect(registry.defaultContent).toContain("{{receiptUrl}}");
        expect(registry.requiredVariables.map((v) => v.key)).toEqual(["name", "receiptUrl"]);
    });

    it("derives every required variable automatically and has a delivery config", () => {
        expect(MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS[MessageTriggerTemplateKey.SERVICE_END_NOTICE]).toEqual(["name", "clientName", "phone", "receiptUrl"]);
        const delivery = SMS_TEMPLATE_DELIVERY[MessageTriggerTemplateKey.SERVICE_END_NOTICE];
        expect(delivery).toMatchObject({
            smsLogTemplateKey: "service_end_notice_sms",
            automationKey: "SERVICE_END_NOTICE_SMS",
            triggerType: "service_end_notice",
            title: "서비스 종료 안내",
            systemTemplateKey: SystemTemplateKey.SERVICE_END_NOTICE,
        });
    });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./backend test -- service-end-notice-catalog`
Expected: FAIL (`SERVICE_END_NOTICE` 없음 / 모듈 없음).

- [ ] **Step 3: 상수 파일 생성**

`backend/domain/constants/service-end-notice-message.ts`:

```ts
export const SERVICE_END_NOTICE_RULE_ID = "system:service_end_notice";
export const SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY = "service_end_notice_sms";
export const SERVICE_END_NOTICE_SMS_AUTOMATION_KEY = "SERVICE_END_NOTICE_SMS";
export const SERVICE_END_NOTICE_SMS_TITLE = "서비스 종료 안내";

export const SERVICE_END_NOTICE_DEFAULT_CONTENT = `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{name}}산모님~♡

본인부담금 환급신청을 위한 영수증 다운로드 방법 안내 드립니다 :)

아래의 URL로 접속하시면 본인부담금 영수증 다운로드가 가능하십니다. 환급 신청은 관할지 보건소 방문 또는 인터넷 정부24에서 가능하시고, 다운로드 받으신 영수증 이미지를 첨부하시면 환급 신청 가능 하십니다^^

{{receiptUrl}}

추가 문의사항이 있으시면 상세히 답변 드리도록 하겠습니다.

감사합니다 :)`;
```

- [ ] **Step 4: backend 레지스트리/카탈로그/변수/딜리버리 수정**

`system-template-registry.ts`: enum에 `SERVICE_END_NOTICE = 'SERVICE_END_NOTICE',` 추가(SERVICE_RECORD_LINK 다음). `SYSTEM_TEMPLATE_REGISTRY`의 THANKS 항목 뒤에:

```ts
  [SystemTemplateKey.SERVICE_END_NOTICE]: {
    key: SystemTemplateKey.SERVICE_END_NOTICE,
    name: SERVICE_END_NOTICE_SMS_TITLE,
    description: '서비스 종료 후 바우처 산모에게 본인부담금 영수증 다운로드 링크를 안내',
    requiredVariables: [
      { key: 'name', label: '산모님 성함', type: 'string', required: true },
      { key: 'receiptUrl', label: '영수증 링크', type: 'string', required: true },
    ],
    defaultContent: SERVICE_END_NOTICE_DEFAULT_CONTENT,
  },
```
(파일 상단에 `import { SERVICE_END_NOTICE_DEFAULT_CONTENT, SERVICE_END_NOTICE_SMS_TITLE } from './service-end-notice-message';`)

`message-trigger-catalog.ts`: enum에 `SERVICE_END_NOTICE = "SERVICE_END_NOTICE",` 추가; `CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS` 배열 끝에 `MessageTriggerTemplateKey.SERVICE_END_NOTICE` 추가; 카탈로그 THANKS 항목 뒤에:

```ts
    [MessageTriggerTemplateKey.SERVICE_END_NOTICE]: {
        key: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        name: SERVICE_END_NOTICE_SMS_TITLE,
        description: "서비스 종료 후 바우처 산모에게 본인부담금 영수증 다운로드 링크를 SMS로 발송",
        allowedEventTypes: [MessageTriggerEventType.SERVICE_END],
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "name", label: "산모님 성함" },
            { key: "receiptUrl", label: "영수증 링크" },
        ],
        providers: {
            sms: { templateKey: "SERVICE_END_NOTICE" },
        },
    },
```

`message-trigger-variable-sources.ts`: 레코드에 `[MessageTriggerTemplateKey.SERVICE_END_NOTICE]: ["name", "clientName", "phone", "receiptUrl"],` 추가.

`sms-trigger-delivery.service.ts`: `SMS_DELIVERY_CONFIG_VERSION`을 `"sms-template-delivery-v2"`로 올리고 `SMS_TEMPLATE_DELIVERY`에 추가:

```ts
    [MessageTriggerTemplateKey.SERVICE_END_NOTICE]: {
        smsLogTemplateKey: SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY,
        automationKey: SERVICE_END_NOTICE_SMS_AUTOMATION_KEY,
        triggerType: "service_end_notice",
        title: SERVICE_END_NOTICE_SMS_TITLE,
        systemTemplateKey: SystemTemplateKey.SERVICE_END_NOTICE,
    },
```

`message-trigger.service.ts` `buildClientTemplateVariables` switch: SMS 계열 case 묶음(`THANKS`, `SURVEY`, `INFO` 등 `{ name, clientName, phone }`을 돌려주는 그룹)에 `case MessageTriggerTemplateKey.SERVICE_END_NOTICE:` 한 줄을 추가한다. `receiptUrl`은 발송 시점에 주입되므로 여기서는 넣지 않는다.

- [ ] **Step 5: shared + frontend 맵 수정**

`packages/shared/src/types/message.ts`: union에 `| "SERVICE_END_NOTICE"`; `MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS`에 `SERVICE_END_NOTICE: ["name", "clientName", "phone", "receiptUrl"],`; `SMS_TRIGGER_TO_SYSTEM_TEMPLATE`에 `SERVICE_END_NOTICE: "SERVICE_END_NOTICE",`(SystemTemplateKey union에도 `"SERVICE_END_NOTICE"` 추가); `SMS_TRIGGER_TEMPLATE_KEYS` 배열 끝에 `"SERVICE_END_NOTICE"`. `CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS` 필터는 그대로(자동 규칙에서 선택 가능해야 함).

`packages/shared/src/message/presentation.ts` `MESSAGE_TEMPLATE_LABELS`에 `SERVICE_END_NOTICE: "서비스 종료 안내",` 와 `service_end_notice_sms: "서비스 종료 안내",` 추가.

`frontend/src/components/app/messages/TriggerRulesManager.tsx` `TRIGGER_TEMPLATE_MESSAGE_FALLBACKS`에 `SERVICE_END_NOTICE: "{{name}}산모님, 본인부담금 영수증은 아래 링크에서 내려받으실 수 있습니다.\n{{receiptUrl}}",` 추가.

- [ ] **Step 6: 테스트 통과 + 드리프트 가드 + 타입 체크**

Run:
```bash
pnpm --filter ./backend test -- service-end-notice-catalog message-trigger-template-consistency
pnpm --filter @babyjamjam/shared run build:backend-runtime
pnpm --filter ./backend run type-check
pnpm --filter ./frontend run type-check
pnpm --filter ./mobile run type-check
```
Expected: 모두 PASS/exit 0. `frontend`/`mobile`에서 `Record<TriggerTemplateKey, …>` 완전성 오류가 나오면 그 맵에 `SERVICE_END_NOTICE` 항목을 같은 방식으로 추가한다(라벨 "서비스 종료 안내").

- [ ] **Step 7: 커밋**

```bash
git add packages/shared/src/types/message.ts packages/shared/src/message/presentation.ts backend/domain/constants backend/application/services/sms-trigger-delivery.service.ts backend/application/services/message-trigger.service.ts frontend/src/components/app/messages/TriggerRulesManager.tsx backend/test/services/service-end-notice-catalog.spec.ts
git commit -m "feat(messages): add SERVICE_END_NOTICE sms template to the trigger catalog"
```

#### Task 1.3: 자동 완료 유예 7일
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `backend/domain/entities/system-setting.entity.ts`, `backend/test/services/system-setting.service.spec.ts`, `backend/test/services/contract-auto-finalize.policy.spec.ts`, `backend/prisma/migrations/20260904000100_contract_auto_finalize_grace_days_7/migration.sql`
**Depends:** none

**Files:**
- Modify: `backend/domain/entities/system-setting.entity.ts:37-41`
- Modify: `backend/test/services/system-setting.service.spec.ts:100-115` (기본값 단언)
- Modify: `backend/test/services/contract-auto-finalize.policy.spec.ts` (기본 설정으로 종료일 +6일은 대기, +7일은 실행)
- Create: `backend/prisma/migrations/20260904000100_contract_auto_finalize_grace_days_7/migration.sql`

- [ ] **Step 1: 실패하는 테스트**

`backend/test/services/contract-auto-finalize.policy.spec.ts`의 기존 "waits until the grace period has passed" 옆에 추가(기존 테스트가 쓰는 헬퍼/픽스처 이름을 그대로 재사용):

```ts
    it("defaults to a 7-day grace period after the service end date", () => {
        expect(DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.graceDays).toBe(7);
    });
```
(`import { DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG } from "domain/entities/system-setting.entity";`)

`system-setting.service.spec.ts:107` 부근에서 기본 설정을 `graceDays: 0`으로 단언하는 곳은 `graceDays: 7`로 바꾼다(모킹 입력이 아니라 기본값 기대치인 경우만).

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./backend test -- contract-auto-finalize.policy system-setting.service`
Expected: FAIL (`Expected: 7, Received: 0`).

- [ ] **Step 3: 기본값 변경**

`backend/domain/entities/system-setting.entity.ts:37-41`:

```ts
export const DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG: ContractAutoFinalizeConfig = {
    enabled: true,
    graceDays: 7,
    maxAttempts: 3,
};
```

- [ ] **Step 4: 저장값 패치 SQL**

`backend/prisma/migrations/20260904000100_contract_auto_finalize_grace_days_7/migration.sql`:

```sql
-- Data patch: every branch's contract auto-finalize grace period becomes 7 days
-- (operator decision 2026-09-03). Additive: only the graceDays key is rewritten.
UPDATE system_setting
SET value = jsonb_set(value::jsonb, '{graceDays}', '7', true)::text,
    updated_at = now()
WHERE key LIKE 'branch:%:contract_automation:auto_finalize';
```

- [ ] **Step 5: 테스트 통과**

Run: `pnpm --filter ./backend test -- contract-auto-finalize system-setting`
Expected: PASS. 프론트/모바일의 `ContractAutomationsManager`, `ContractAutomationEditor`, `ContractAutomationsPanel`은 값 7을 이미 "종료일 7일 후"로 표시하므로 수정 없음.

- [ ] **Step 6: 커밋**

```bash
git add backend/domain/entities/system-setting.entity.ts backend/test/services backend/prisma/migrations/20260904000100_contract_auto_finalize_grace_days_7
git commit -m "feat(contracts): default auto-finalize grace period to 7 days and patch stored configs"
```

#### Task 1.4: 의존성 설치 + env 키
**Tier:** trivial
**Sandbox:** network
**Agent:** main
**Model:** claude-fable-5-1
**Effort:** medium
**Paths:** `backend/package.json`, `pnpm-lock.yaml`, `backend/env.tpl`, `backend/.env`
**Depends:** none

**Files:**
- Modify: `backend/package.json` (dependencies), `pnpm-lock.yaml`
- Modify: `backend/env.tpl:76` 근처, `backend/.env` (git-ignored)

- [ ] **Step 1: 패키지 설치**

Run (워크트리 루트에서):
```bash
pnpm --filter ./backend add pdfjs-dist@4.10.38 @napi-rs/canvas@0.1.100
node -e "require('@napi-rs/canvas'); console.log('canvas ok')"
```
Expected: lockfile 갱신, `canvas ok`.

- [ ] **Step 2: env 키 추가**

`backend/env.tpl`의 `MOBILE_SERVICE_RECORD_BASE_URL` 행 아래에:

```
# 영수증 링크 베이스 URL (m.admin). 비우면 MOBILE_SERVICE_RECORD_BASE_URL → https://m.admin.babyjamjam.com 순으로 폴백
MOBILE_RECEIPT_BASE_URL="http://192.168.219.142:3002"
# 생년월일 해시 솔트 (비밀값)
RECEIPT_LINK_HASH_SALT=
```

`backend/.env`에는 같은 두 키를 추가하되 `RECEIPT_LINK_HASH_SALT`는 `openssl rand -base64 32` 출력으로 채운다(값을 채팅에 출력하지 않는다).

- [ ] **Step 3: 검증**

Run: `~/.agents/bin/env-check`
Expected: exit 0. 사용자에게 `env-backup backend/.env` 실행을 요청한다(볼트 백업 갱신).

- [ ] **Step 4: 커밋**

```bash
git add backend/package.json pnpm-lock.yaml backend/env.tpl
git commit -m "chore(backend): add pdfjs-dist and @napi-rs/canvas; declare receipt link env keys"
```

---
## Phase 2 — 백엔드 (렌더러 · 토큰 · 발급 파이프라인 · 발송 훅 · API · 정리 크론)

한 줄 요약: PDF 7쪽을 PNG로 만들고 토큰을 발급하는 코어를 만든 뒤, 발송 훅·공개 API·수동 발송·야간 정리까지 붙인다.

**In parallel (batch A):**
- **PDF 페이지 래스터라이저** (infra, medium) — pdf.js + napi-canvas, 빌드 후 검증 스크립트 + CI 스텝.
- **영수증 토큰 서비스** (feature, high) — 발급/상태/생년월일 검증/접근 토큰/만료 정리 쿼리.
- **발송 payload enricher 훅** (feature, medium) — 레지스트리 + `sendJob` 건너뜀 처리.

**Run together (batch B, A 완료 후):**
- **영수증 링크 발급 서비스** (feature, high) — 가드 → PDF → 렌더 → 업로드 → 토큰 → URL.

**Sequential (C → D → E):**
- **모듈 + 공개 API + enricher 등록** (feature, high)
- **수동 발송 API** (feature, medium)
- **만료 링크 정리 크론** (feature, low)

#### Task 2.1: PdfPageRasterizerService
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `backend/infrastructure/pdf/pdf-page-rasterizer.service.ts`, `backend/scripts/verify-pdf-rasterizer.mjs`, `backend/package.json` (scripts만), `.github/workflows/backend-ci.yml`
**Depends:** Task 1.4

**Files:**
- Create: `backend/infrastructure/pdf/pdf-page-rasterizer.service.ts`
- Create: `backend/scripts/verify-pdf-rasterizer.mjs`
- Modify: `backend/package.json` scripts에 `"verify:pdf-rasterizer": "node scripts/verify-pdf-rasterizer.mjs"`
- Modify: `.github/workflows/backend-ci.yml` (build 스텝(105행 부근) 직후 스텝 추가)

**Interfaces:**
- Produces: `class PdfPageRasterizerService { renderPageToPng(pdf: Buffer, pageNumber: number, options?: { width?: number }): Promise<Buffer> }`, `class PdfPageOutOfRangeError extends Error { pageNumber; pageCount }`. 기본 width 1240.

왜 Jest가 아닌 스크립트인가: pdfjs-dist 4.x는 ESM 전용이라 CommonJS 백엔드에서 `new Function("specifier","return import(specifier)")` 셸로 로드한다(스파이크 검증). Jest의 vm 컨텍스트는 `--experimental-vm-modules` 없이는 이 동적 import를 지원하지 않으므로 실렌더 검증은 빌드 산출물을 plain Node로 실행한다. 나머지 서비스 테스트는 래스터라이저를 모킹한다.

- [ ] **Step 1: 검증 스크립트(실패하는 테스트) 작성**

`backend/scripts/verify-pdf-rasterizer.mjs`:

```js
// Renders a 2-page synthetic PDF through the compiled rasterizer and checks the PNG.
// Run after `pnpm --filter ./backend build`: `pnpm --filter ./backend run verify:pdf-rasterizer`
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PdfPageRasterizerService, PdfPageOutOfRangeError } = require(
    "../dist/infrastructure/pdf/pdf-page-rasterizer.service.js",
);

// Minimal 2-page PDF: page 1 blue, page 2 red. pdf.js tolerates the missing xref table.
const MINI_PDF = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 5 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 6 0 R >> endobj
5 0 obj << /Length 25 >> stream
0 0 1 rg 0 0 200 100 re f
endstream
endobj
6 0 obj << /Length 25 >> stream
1 0 0 rg 0 0 200 100 re f
endstream
endobj
trailer << /Root 1 0 R >>
%%EOF
`);

const service = new PdfPageRasterizerService();
const png = await service.renderPageToPng(MINI_PDF, 2, { width: 400 });
assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
assert.equal(png.readUInt32BE(16), 400, "IHDR width");
assert.equal(png.readUInt32BE(20), 200, "IHDR height");
await assert.rejects(() => service.renderPageToPng(MINI_PDF, 3), PdfPageOutOfRangeError);
console.log(`pdf rasterizer ok: ${png.length} bytes`);
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./backend build && pnpm --filter ./backend run verify:pdf-rasterizer`
Expected: FAIL (`Cannot find module '../dist/infrastructure/pdf/pdf-page-rasterizer.service.js'`).

- [ ] **Step 3: 서비스 구현**

`backend/infrastructure/pdf/pdf-page-rasterizer.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import type * as PdfJs from "pdfjs-dist";

export class PdfPageOutOfRangeError extends Error {
    constructor(
        readonly pageNumber: number,
        readonly pageCount: number,
    ) {
        super(`PDF page ${pageNumber} is out of range (1..${pageCount})`);
        this.name = "PdfPageOutOfRangeError";
    }
}

export const DEFAULT_RASTER_WIDTH = 1240;

// pdfjs-dist 4.x is ESM-only and the backend compiles to CommonJS. A dynamic
// import written directly would be rewritten to require() by tsc, so the import
// goes through a Function shell. The specifier is a constant — never interpolate.
const PDFJS_SPECIFIER = "pdfjs-dist/legacy/build/pdf.mjs";
const importEsm = new Function("specifier", "return import(specifier)") as (
    specifier: string,
) => Promise<unknown>;

type PdfJsModule = typeof PdfJs;

@Injectable()
export class PdfPageRasterizerService {
    private pdfjsPromise: Promise<PdfJsModule> | null = null;

    private loadPdfJs(): Promise<PdfJsModule> {
        if (!this.pdfjsPromise) {
            this.pdfjsPromise = importEsm(PDFJS_SPECIFIER) as Promise<PdfJsModule>;
        }
        return this.pdfjsPromise;
    }

    /** Render one page (1-based) to a white-background PNG scaled to `width` px. */
    async renderPageToPng(
        pdf: Buffer,
        pageNumber: number,
        options: { width?: number } = {},
    ): Promise<Buffer> {
        const targetWidth = options.width ?? DEFAULT_RASTER_WIDTH;
        const pdfjs = await this.loadPdfJs();
        const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
        const doc = await pdfjs.getDocument({
            data: Uint8Array.from(pdf),
            // Node has no FontFace API: embedded CID glyphs must be drawn as paths.
            disableFontFace: true,
            useSystemFonts: false,
            cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps") + path.sep).href,
            cMapPacked: true,
            standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts") + path.sep).href,
        }).promise;

        try {
            if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
                throw new PdfPageOutOfRangeError(pageNumber, doc.numPages);
            }
            const page = await doc.getPage(pageNumber);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: targetWidth / base.width });
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            const context = canvas.getContext("2d");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({
                canvasContext: context as unknown as CanvasRenderingContext2D,
                viewport,
            }).promise;
            return canvas.toBuffer("image/png");
        } finally {
            await doc.destroy();
        }
    }
}
```

- [ ] **Step 4: 빌드 + 검증 통과**

Run: `pnpm --filter ./backend run type-check && pnpm --filter ./backend build && pnpm --filter ./backend run verify:pdf-rasterizer`
Expected: `pdf rasterizer ok: <N> bytes`. 타입 오류가 `pdfjs-dist` 타입 해석에서 나면 `import type * as PdfJs from "pdfjs-dist/types/src/pdf"`로 바꾼다.

- [ ] **Step 5: CI 스텝 추가**

`.github/workflows/backend-ci.yml` build 스텝 바로 뒤:

```yaml
      - name: Verify pdf rasterizer (pdfjs + napi-canvas on the built output)
        run: pnpm --filter ./backend run verify:pdf-rasterizer
```

- [ ] **Step 6: 커밋**

```bash
git add backend/infrastructure/pdf/pdf-page-rasterizer.service.ts backend/scripts/verify-pdf-rasterizer.mjs backend/package.json .github/workflows/backend-ci.yml
git commit -m "feat(backend): add pdf page rasterizer (pdfjs legacy + napi-canvas) with build-time verification"
```

#### Task 2.2: ReceiptLinkTokenService
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `backend/application/services/receipt-link-token.service.ts`, `backend/test/services/receipt-link-token.service.spec.ts`
**Depends:** Task 1.1

**Files:**
- Create: `backend/application/services/receipt-link-token.service.ts`
- Test: `backend/test/services/receipt-link-token.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.receipt_link_token` (Task 1.1), `ConfigService.get("RECEIPT_LINK_HASH_SALT")`.
- Produces (Task 2.4/2.5/2.7이 사용):
  - `issue(params: IssueReceiptLinkTokenParams): Promise<IssuedReceiptLinkToken>` — 같은 문서의 활성 토큰을 revoke하고 새 토큰 발급, 평문 `linkToken`(`efr_…`) 반환.
  - `getStatus(linkToken, now): Promise<ReceiptLinkStatus>`
  - `verifyBirthday(linkToken, rawInput, now): Promise<VerifyReceiptBirthdayResult>`
  - `resolveAccess(linkToken, accessToken, now): Promise<ReceiptLinkAccess | null>`
  - `collectExpired(cutoff): Promise<{ ids: string[]; orphanStoragePaths: string[] }>` / `deleteByIds(ids)`
  - `normalizeBirthdayInput(raw: string): string | null` (export)

서비스가 쓰는 Prisma 호출은 정확히 다음 다섯 가지뿐이다(테스트 fake가 이 형태만 구현): `findUnique({ where: { linkTokenHash }, include: { branch: { select: { name } }, client: { select: { name } } } })`, `updateMany({ where: { eformsignDocId, active: true }, data })`, `create({ data })`, `update({ where: { id }, data })`, `findMany({ where, select })`, `deleteMany({ where: { id: { in } } })`.

- [ ] **Step 1: 실패하는 테스트**

`backend/test/services/receipt-link-token.service.spec.ts`:

```ts
import { createHash } from "node:crypto";
import {
    ReceiptLinkTokenService,
    RECEIPT_LINK_LOCK_MS,
    RECEIPT_LINK_MAX_FAILED_ATTEMPTS,
    RECEIPT_LINK_TTL_MS,
    normalizeBirthdayInput,
} from "application/services/receipt-link-token.service";

type Row = Record<string, unknown> & { id: string; linkTokenHash: string; active: boolean; expiresAt: Date; eformsignDocId: number };

class FakePrisma {
    rows: Row[] = [];
    receipt_link_token = {
        findUnique: async ({ where }: { where: { linkTokenHash: string } }) => {
            const row = this.rows.find((r) => r.linkTokenHash === where.linkTokenHash);
            return row ? { ...row, branch: { name: "인천 아이미래로" }, client: { name: "김산모" } } : null;
        },
        updateMany: async ({ where, data }: { where: { eformsignDocId: number; active: boolean }; data: Record<string, unknown> }) => {
            const hits = this.rows.filter((r) => r.eformsignDocId === where.eformsignDocId && r.active === where.active);
            hits.forEach((r) => Object.assign(r, data));
            return { count: hits.length };
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
            const row = { id: `row-${this.rows.length + 1}`, failedAttempts: 0, active: true, ...data } as Row;
            this.rows.push(row);
            return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = this.rows.find((r) => r.id === where.id)!;
            Object.assign(row, data);
            return row;
        },
        findMany: async ({ where }: { where: { expiresAt?: { lt?: Date; gte?: Date }; storagePath?: { in: string[] } } }) =>
            this.rows.filter((r) =>
                (where.expiresAt?.lt ? r.expiresAt < where.expiresAt.lt : true) &&
                (where.expiresAt?.gte ? r.expiresAt >= where.expiresAt.gte : true) &&
                (where.storagePath ? where.storagePath.in.includes(r.storagePath as string) : true),
            ),
        deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
            const before = this.rows.length;
            this.rows = this.rows.filter((r) => !where.id.in.includes(r.id));
            return { count: before - this.rows.length };
        },
    };
}

const config = { get: (key: string, fallback?: string) => (key === "RECEIPT_LINK_HASH_SALT" ? "test-salt" : fallback) };
const NOW = new Date("2026-09-03T09:00:00+09:00");

function makeService() {
    const prisma = new FakePrisma();
    const service = new ReceiptLinkTokenService(prisma as never, config as never);
    return { prisma, service };
}

async function issue(service: ReceiptLinkTokenService, overrides: Partial<Parameters<ReceiptLinkTokenService["issue"]>[0]> = {}) {
    return service.issue({
        branchId: "11111111-1111-1111-1111-111111111111",
        clientId: 7,
        eformsignDocId: 42,
        jobId: "job-1",
        birthday: "940315",
        storagePath: "receipts/b/42/abc.png",
        contentSha256: "a".repeat(64),
        byteSize: 1000,
        source: "auto_trigger",
        now: NOW,
        ...overrides,
    });
}

describe("normalizeBirthdayInput", () => {
    it("accepts 6 digits, takes the last 6 of 8 digits, rejects anything else", () => {
        expect(normalizeBirthdayInput("940315")).toBe("940315");
        expect(normalizeBirthdayInput("1994-03-15")).toBe("940315");
        expect(normalizeBirthdayInput("19940315")).toBe("940315");
        expect(normalizeBirthdayInput("9403")).toBeNull();
        expect(normalizeBirthdayInput("")).toBeNull();
    });
});

describe("ReceiptLinkTokenService", () => {
    it("issues an efr_ token, stores only hashes, expires in 30 days, and revokes older tokens for the same document", async () => {
        const { prisma, service } = makeService();
        const first = await issue(service);
        const second = await issue(service, { jobId: "job-2" });

        expect(first.linkToken).toMatch(/^efr_[A-Za-z0-9_-]{43}$/);
        expect(first.expiresAt.getTime()).toBe(NOW.getTime() + RECEIPT_LINK_TTL_MS);
        expect(prisma.rows.map((r) => r.active)).toEqual([false, true]);
        expect(prisma.rows[0].revokedAt).toEqual(NOW);
        expect(prisma.rows[1].linkTokenHash).toBe(createHash("sha256").update(second.linkToken).digest("hex"));
        expect(prisma.rows[1].expectedBirthdayHash).toBe(createHash("sha256").update("test-salt:940315").digest("hex"));
        expect(JSON.stringify(prisma.rows)).not.toContain(second.linkToken);
    });

    it("reports status without exposing the client name", async () => {
        const { service } = makeService();
        const { linkToken } = await issue(service);
        const status = await service.getStatus(linkToken, NOW);
        expect(status).toEqual({
            ok: true,
            state: "pending",
            branchName: "인천 아이미래로",
            expiresAt: new Date(NOW.getTime() + RECEIPT_LINK_TTL_MS).toISOString(),
            remainingAttempts: RECEIPT_LINK_MAX_FAILED_ATTEMPTS,
            lockedUntil: null,
        });
        expect(await service.getStatus("efr_nope", NOW)).toEqual({ ok: false, reason: "not_found" });
        expect(await service.getStatus(linkToken, new Date(NOW.getTime() + RECEIPT_LINK_TTL_MS + 1))).toEqual({ ok: false, reason: "expired" });
    });

    it("verifies the birthday, returns an access token and the client name", async () => {
        const { prisma, service } = makeService();
        const { linkToken } = await issue(service);
        const result = await service.verifyBirthday(linkToken, "19940315", NOW);
        expect(result).toMatchObject({ ok: true, clientName: "김산모" });
        const accessToken = (result as { accessToken: string }).accessToken;
        expect(accessToken).toMatch(/^efra_/);
        expect(prisma.rows[0].accessTokenHash).toBe(createHash("sha256").update(accessToken).digest("hex"));
        expect(prisma.rows[0].verifiedAt).toEqual(NOW);

        const access = await service.resolveAccess(linkToken, accessToken, NOW);
        expect(access).toEqual({ id: "row-1", storagePath: "receipts/b/42/abc.png", clientName: "김산모", expiresAt: new Date(NOW.getTime() + RECEIPT_LINK_TTL_MS) });
        expect(await service.resolveAccess(linkToken, "efra_wrong", NOW)).toBeNull();
    });

    it("counts failures, locks for 30 minutes after 5, and resets after the lock expires", async () => {
        const { service } = makeService();
        const { linkToken } = await issue(service);
        for (let attempt = 1; attempt < RECEIPT_LINK_MAX_FAILED_ATTEMPTS; attempt += 1) {
            expect(await service.verifyBirthday(linkToken, "000000", NOW)).toEqual({
                ok: false,
                reason: "verification_failed",
                remainingAttempts: RECEIPT_LINK_MAX_FAILED_ATTEMPTS - attempt,
            });
        }
        const lockedUntil = new Date(NOW.getTime() + RECEIPT_LINK_LOCK_MS).toISOString();
        expect(await service.verifyBirthday(linkToken, "000000", NOW)).toEqual({ ok: false, reason: "locked", lockedUntil });
        expect(await service.verifyBirthday(linkToken, "940315", NOW)).toEqual({ ok: false, reason: "locked", lockedUntil });
        expect(await service.getStatus(linkToken, NOW)).toMatchObject({ remainingAttempts: 0, lockedUntil });

        const later = new Date(NOW.getTime() + RECEIPT_LINK_LOCK_MS + 1);
        expect(await service.verifyBirthday(linkToken, "940315", later)).toMatchObject({ ok: true });
    });

    it("rejects malformed input without counting an attempt", async () => {
        const { prisma, service } = makeService();
        const { linkToken } = await issue(service);
        expect(await service.verifyBirthday(linkToken, "94", NOW)).toEqual({ ok: false, reason: "invalid_format" });
        expect(prisma.rows[0].failedAttempts).toBe(0);
    });

    it("collects expired tokens and only the storage paths no live token still references", async () => {
        const { prisma, service } = makeService();
        await issue(service, { eformsignDocId: 1, storagePath: "receipts/b/1/old.png", now: new Date("2026-07-01T00:00:00Z") });
        await issue(service, { eformsignDocId: 2, storagePath: "receipts/b/2/shared.png", now: new Date("2026-07-01T00:00:00Z") });
        await issue(service, { eformsignDocId: 3, storagePath: "receipts/b/2/shared.png", now: NOW });

        const cutoff = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
        const collected = await service.collectExpired(cutoff);
        expect(collected.ids).toEqual(["row-1", "row-2"]);
        expect(collected.orphanStoragePaths).toEqual(["receipts/b/1/old.png"]);

        await service.deleteByIds(collected.ids);
        expect(prisma.rows.map((r) => r.id)).toEqual(["row-3"]);
    });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./backend test -- receipt-link-token.service`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 서비스 구현**

`backend/application/services/receipt-link-token.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "infrastructure/database/prisma.service";

export const RECEIPT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RECEIPT_LINK_MAX_FAILED_ATTEMPTS = 5;
export const RECEIPT_LINK_LOCK_MS = 30 * 60 * 1000;

export type ReceiptLinkSource = "auto_trigger" | "manual";

export interface IssueReceiptLinkTokenParams {
    branchId: string;
    clientId: number;
    eformsignDocId: number;
    jobId?: string | null;
    /** 산모 생년월일 YYMMDD */
    birthday: string;
    storagePath: string;
    contentSha256: string;
    byteSize: number;
    source: ReceiptLinkSource;
    createdBy?: string | null;
    now?: Date;
}

export interface IssuedReceiptLinkToken {
    id: string;
    linkToken: string;
    expiresAt: Date;
}

export type ReceiptLinkUnusableReason = "not_found" | "expired" | "revoked";

export type ReceiptLinkStatus =
    | {
          ok: true;
          state: "pending" | "verified";
          branchName: string;
          expiresAt: string;
          remainingAttempts: number;
          lockedUntil: string | null;
      }
    | { ok: false; reason: ReceiptLinkUnusableReason };

export type VerifyReceiptBirthdayResult =
    | { ok: true; accessToken: string; clientName: string }
    | { ok: false; reason: "verification_failed"; remainingAttempts: number }
    | { ok: false; reason: "locked"; lockedUntil: string }
    | { ok: false; reason: "invalid_format" }
    | { ok: false; reason: ReceiptLinkUnusableReason };

export interface ReceiptLinkAccess {
    id: string;
    storagePath: string;
    clientName: string;
    expiresAt: Date;
}

interface TokenRow {
    id: string;
    eformsignDocId: number;
    accessTokenHash: string | null;
    expectedBirthdayHash: string;
    verifiedAt: Date | null;
    failedAttempts: number;
    lockedAt: Date | null;
    expiresAt: Date;
    active: boolean;
    storagePath: string;
    branch: { name: string } | null;
    client: { name: string } | null;
}

const DEFAULT_CLIENT_NAME = "산모";

/** 6자리 그대로, 8자리(YYYYMMDD)는 뒤 6자리, 그 외는 null. 숫자 외 문자는 무시. */
export function normalizeBirthdayInput(raw: string): string | null {
    const digits = (raw ?? "").replace(/\D/g, "");
    if (digits.length === 6) return digits;
    if (digits.length === 8) return digits.slice(2);
    return null;
}

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class ReceiptLinkTokenService {
    private readonly logger = new Logger(ReceiptLinkTokenService.name);
    private readonly salt: string;

    constructor(
        private readonly prisma: PrismaService,
        configService: ConfigService,
    ) {
        this.salt = configService.get<string>("RECEIPT_LINK_HASH_SALT", "") ?? "";
        if (!this.salt) {
            this.logger.warn("RECEIPT_LINK_HASH_SALT is empty; birthday hashes are unsalted");
        }
    }

    private hashBirthday(yymmdd: string): string {
        return sha256(`${this.salt}:${yymmdd}`);
    }

    async issue(params: IssueReceiptLinkTokenParams): Promise<IssuedReceiptLinkToken> {
        const now = params.now ?? new Date();
        const linkToken = `efr_${randomBytes(32).toString("base64url")}`;
        const expiresAt = new Date(now.getTime() + RECEIPT_LINK_TTL_MS);

        await this.prisma.receipt_link_token.updateMany({
            where: { eformsignDocId: params.eformsignDocId, active: true },
            data: { active: false, revokedAt: now },
        });

        const row = await this.prisma.receipt_link_token.create({
            data: {
                branchId: params.branchId,
                clientId: params.clientId,
                eformsignDocId: params.eformsignDocId,
                jobId: params.jobId ?? null,
                linkTokenHash: sha256(linkToken),
                expectedBirthdayHash: this.hashBirthday(params.birthday),
                expiresAt,
                storagePath: params.storagePath,
                contentSha256: params.contentSha256,
                byteSize: params.byteSize,
                source: params.source,
                createdBy: params.createdBy ?? null,
                createdAt: now,
            },
        });

        return { id: row.id, linkToken, expiresAt };
    }

    private async findRow(linkToken: string): Promise<TokenRow | null> {
        return this.prisma.receipt_link_token.findUnique({
            where: { linkTokenHash: sha256(linkToken) },
            include: { branch: { select: { name: true } }, client: { select: { name: true } } },
        }) as Promise<TokenRow | null>;
    }

    private unusableReason(row: TokenRow | null, now: Date): ReceiptLinkUnusableReason | null {
        if (!row) return "not_found";
        if (!row.active) return "revoked";
        if (row.expiresAt.getTime() <= now.getTime()) return "expired";
        return null;
    }

    private lockedUntil(row: TokenRow, now: Date): Date | null {
        if (!row.lockedAt) return null;
        const until = new Date(row.lockedAt.getTime() + RECEIPT_LINK_LOCK_MS);
        return until.getTime() > now.getTime() ? until : null;
    }

    async getStatus(linkToken: string, now: Date): Promise<ReceiptLinkStatus> {
        const row = await this.findRow(linkToken);
        const unusable = this.unusableReason(row, now);
        if (unusable || !row) return { ok: false, reason: unusable ?? "not_found" };

        const lockedUntil = this.lockedUntil(row, now);
        const failed = lockedUntil || !row.lockedAt ? row.failedAttempts : 0;
        return {
            ok: true,
            state: row.verifiedAt ? "verified" : "pending",
            branchName: row.branch?.name ?? "",
            expiresAt: row.expiresAt.toISOString(),
            remainingAttempts: lockedUntil ? 0 : Math.max(0, RECEIPT_LINK_MAX_FAILED_ATTEMPTS - failed),
            lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
        };
    }

    async verifyBirthday(linkToken: string, rawInput: string, now: Date): Promise<VerifyReceiptBirthdayResult> {
        const row = await this.findRow(linkToken);
        const unusable = this.unusableReason(row, now);
        if (unusable || !row) return { ok: false, reason: unusable ?? "not_found" };

        const lockedUntil = this.lockedUntil(row, now);
        if (lockedUntil) return { ok: false, reason: "locked", lockedUntil: lockedUntil.toISOString() };

        const normalized = normalizeBirthdayInput(rawInput);
        if (!normalized) return { ok: false, reason: "invalid_format" };

        // A lock that has already expired resets the counter on the next attempt.
        const priorFailures = row.lockedAt ? 0 : row.failedAttempts;

        if (this.hashBirthday(normalized) !== row.expectedBirthdayHash) {
            const failedAttempts = priorFailures + 1;
            if (failedAttempts >= RECEIPT_LINK_MAX_FAILED_ATTEMPTS) {
                await this.prisma.receipt_link_token.update({
                    where: { id: row.id },
                    data: { failedAttempts, lockedAt: now },
                });
                return { ok: false, reason: "locked", lockedUntil: new Date(now.getTime() + RECEIPT_LINK_LOCK_MS).toISOString() };
            }
            await this.prisma.receipt_link_token.update({
                where: { id: row.id },
                data: { failedAttempts, lockedAt: null },
            });
            return { ok: false, reason: "verification_failed", remainingAttempts: RECEIPT_LINK_MAX_FAILED_ATTEMPTS - failedAttempts };
        }

        const accessToken = `efra_${randomBytes(32).toString("base64url")}`;
        await this.prisma.receipt_link_token.update({
            where: { id: row.id },
            data: { accessTokenHash: sha256(accessToken), verifiedAt: now, failedAttempts: 0, lockedAt: null },
        });
        return { ok: true, accessToken, clientName: row.client?.name ?? DEFAULT_CLIENT_NAME };
    }

    async resolveAccess(linkToken: string, accessToken: string, now: Date): Promise<ReceiptLinkAccess | null> {
        const row = await this.findRow(linkToken);
        if (!row || this.unusableReason(row, now)) return null;
        if (!row.accessTokenHash || row.accessTokenHash !== sha256(accessToken)) return null;
        return { id: row.id, storagePath: row.storagePath, clientName: row.client?.name ?? DEFAULT_CLIENT_NAME, expiresAt: row.expiresAt };
    }

    /** Tokens expired before `cutoff`, plus the storage paths that no token expiring at/after `cutoff` still uses. */
    async collectExpired(cutoff: Date): Promise<{ ids: string[]; orphanStoragePaths: string[] }> {
        const expired = (await this.prisma.receipt_link_token.findMany({
            where: { expiresAt: { lt: cutoff } },
            select: { id: true, storagePath: true },
        })) as Array<{ id: string; storagePath: string }>;
        if (expired.length === 0) return { ids: [], orphanStoragePaths: [] };

        const candidatePaths = Array.from(new Set(expired.map((row) => row.storagePath)));
        const stillUsed = (await this.prisma.receipt_link_token.findMany({
            where: { storagePath: { in: candidatePaths }, expiresAt: { gte: cutoff } },
            select: { storagePath: true },
        })) as Array<{ storagePath: string }>;
        const usedSet = new Set(stillUsed.map((row) => row.storagePath));

        return {
            ids: expired.map((row) => row.id),
            orphanStoragePaths: candidatePaths.filter((path) => !usedSet.has(path)),
        };
    }

    async deleteByIds(ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;
        const result = await this.prisma.receipt_link_token.deleteMany({ where: { id: { in: ids } } });
        return result.count;
    }
}
```

- [ ] **Step 4: 테스트 통과**

Run: `pnpm --filter ./backend test -- receipt-link-token.service`
Expected: PASS (6 tests).

- [ ] **Step 5: 커밋**

```bash
git add backend/application/services/receipt-link-token.service.ts backend/test/services/receipt-link-token.service.spec.ts
git commit -m "feat(receipt-link): add birthday-protected receipt link token service"
```

#### Task 2.3: SMS 발송 payload enricher 훅
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `backend/application/services/sms-trigger-payload-enricher.registry.ts`, `backend/application/services/sms-trigger-delivery.service.ts` (constructor + `sendJob`만), `backend/module/message.module.ts`, `backend/test/services/sms-trigger-payload-enricher.spec.ts`
**Depends:** Task 1.2

**Files:**
- Create: `backend/application/services/sms-trigger-payload-enricher.registry.ts`
- Modify: `backend/application/services/sms-trigger-delivery.service.ts` (constructor ~191~199행, `sendJob` ~329~355행)
- Modify: `backend/module/message.module.ts` (providers/exports)
- Test: `backend/test/services/sms-trigger-payload-enricher.spec.ts`

**Interfaces:**
- Produces: `interface SmsTriggerPayloadEnricher { enrich(job: MessageTriggerJobEntity): Promise<void> }`, `class SmsTriggerDeliverySkipError extends Error { reason: string }`, `class SmsTriggerPayloadEnricherRegistry { register(key, enricher): void; get(key): SmsTriggerPayloadEnricher | null }`. `MessageModule`이 `SmsTriggerPayloadEnricherRegistry`와 `MessageTriggerSchedulerService`를 export.

- [ ] **Step 1: 실패하는 테스트**

`backend/test/services/sms-trigger-payload-enricher.spec.ts`:

```ts
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import {
    SmsTriggerDeliverySkipError,
    SmsTriggerPayloadEnricherRegistry,
} from "application/services/sms-trigger-payload-enricher.registry";

function makeJob(): MessageTriggerJobEntity {
    return MessageTriggerJobEntity.create({
        branchId: "11111111-1111-1111-1111-111111111111",
        ruleId: "system:service_end_notice",
        scheduledFor: new Date(),
        clientId: 7,
        recipientType: MessageTriggerRecipientType.CLIENT,
        recipientPhone: "01012345678",
        templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        dedupeKey: "system:service_end_notice:client:7",
        payload: { memberId: "client:7", recipientName: "김산모", recipientPhone: "01012345678", templateVariables: { name: "김산모" } },
    });
}

function makeService(registry: SmsTriggerPayloadEnricherRegistry) {
    const aligo = { sendSms: jest.fn() };
    const templates = { getByKey: jest.fn() };
    const logRepository = { create: jest.fn(), update: jest.fn() };
    const service = new SmsTriggerDeliveryService(aligo as never, templates as never, logRepository as never, undefined, registry);
    const sendSmsJob = jest.spyOn(service as unknown as { sendSmsJob: () => Promise<boolean> }, "sendSmsJob").mockResolvedValue(true);
    return { service, sendSmsJob, aligo };
}

describe("SmsTriggerPayloadEnricherRegistry", () => {
    it("registers one enricher per template key", () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const enricher = { enrich: jest.fn() };
        registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, enricher);
        expect(registry.get(MessageTriggerTemplateKey.SERVICE_END_NOTICE)).toBe(enricher);
        expect(registry.get(MessageTriggerTemplateKey.THANKS)).toBeNull();
        expect(() => registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, enricher)).toThrow(/already registered/);
    });
});

describe("SmsTriggerDeliveryService.sendJob with enrichers", () => {
    it("runs the enricher before sending so it can fill template variables", async () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, {
            enrich: async (job) => {
                job.payload.templateVariables.receiptUrl = "https://m.admin.example/receipt/efr_x";
            },
        });
        const { service, sendSmsJob } = makeService(registry);
        const job = makeJob();

        await expect(service.sendJob(job)).resolves.toBe(true);
        expect(job.payload.templateVariables.receiptUrl).toBe("https://m.admin.example/receipt/efr_x");
        expect(sendSmsJob).toHaveBeenCalledTimes(1);
    });

    it("cancels the job with the skip reason when the enricher throws SmsTriggerDeliverySkipError", async () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, {
            enrich: async () => {
                throw new SmsTriggerDeliverySkipError("not_voucher_client", "바우처 이용 산모가 아닙니다");
            },
        });
        const { service, sendSmsJob, aligo } = makeService(registry);
        const job = makeJob();

        await expect(service.sendJob(job)).resolves.toBe(false);
        expect(job.status).toBe("canceled");
        expect(job.cancelReason).toBe("메시지 발송 건너뜀: 바우처 이용 산모가 아닙니다");
        expect(sendSmsJob).not.toHaveBeenCalled();
        expect(aligo.sendSms).not.toHaveBeenCalled();
    });

    it("sends normally when no enricher is registered for the template", async () => {
        const { service, sendSmsJob } = makeService(new SmsTriggerPayloadEnricherRegistry());
        await expect(service.sendJob(makeJob())).resolves.toBe(true);
        expect(sendSmsJob).toHaveBeenCalledTimes(1);
    });
});
```
(`job.status`/`job.cancelReason` 접근자 이름은 `MessageTriggerJobEntity`의 실제 getter 이름을 따른다 — `backend/domain/entities/message-trigger-job.entity.ts`에서 `cancel()`이 설정하는 필드의 getter를 확인해 맞춘다. `cancel()`이 `"canceled"`가 아닌 다른 상태 문자열을 쓰면 그 값으로 단언한다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./backend test -- sms-trigger-payload-enricher`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 레지스트리 구현**

`backend/application/services/sms-trigger-payload-enricher.registry.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";

/**
 * Fills job.payload.templateVariables right before an SMS trigger job is sent.
 * Throw SmsTriggerDeliverySkipError to cancel the job with a human-readable reason
 * instead of failing it (mirrors MissingSmsTemplateVariablesError handling).
 */
export interface SmsTriggerPayloadEnricher {
    enrich(job: MessageTriggerJobEntity): Promise<void>;
}

export class SmsTriggerDeliverySkipError extends Error {
    constructor(
        readonly reason: string,
        message?: string,
    ) {
        super(message ?? reason);
        this.name = "SmsTriggerDeliverySkipError";
    }
}

@Injectable()
export class SmsTriggerPayloadEnricherRegistry {
    private readonly enrichers = new Map<MessageTriggerTemplateKey, SmsTriggerPayloadEnricher>();

    register(templateKey: MessageTriggerTemplateKey, enricher: SmsTriggerPayloadEnricher): void {
        if (this.enrichers.has(templateKey)) {
            throw new Error(`SMS payload enricher already registered for ${templateKey}`);
        }
        this.enrichers.set(templateKey, enricher);
    }

    get(templateKey: MessageTriggerTemplateKey): SmsTriggerPayloadEnricher | null {
        return this.enrichers.get(templateKey) ?? null;
    }
}
```

- [ ] **Step 4: 딜리버리 서비스 훅**

`sms-trigger-delivery.service.ts` constructor 마지막 파라미터로 추가:

```ts
        @Optional()
        private readonly enricherRegistry?: SmsTriggerPayloadEnricherRegistry,
```

`sendJob`의 `try` 블록을 다음으로 교체(기존 `MissingSmsTemplateVariablesError` 분기는 유지):

```ts
        try {
            const enricher = this.enricherRegistry?.get(job.templateKey) ?? null;
            if (enricher) {
                await enricher.enrich(job);
            }
            return await this.sendSmsJob(job, config);
        } catch (error) {
            if (error instanceof SmsTriggerDeliverySkipError) {
                job.cancel(`메시지 발송 건너뜀: ${error.message}`);
                this.logger.warn(`[SmsTrigger] job ${job.id} skipped (${error.reason})`);
                return false;
            }
            if (error instanceof MissingSmsTemplateVariablesError) {
                // ...기존 코드 그대로...
            }
            throw error;
        }
```
import: `import { SmsTriggerDeliverySkipError, SmsTriggerPayloadEnricherRegistry } from "./sms-trigger-payload-enricher.registry";`

- [ ] **Step 5: 모듈 등록/export**

`backend/module/message.module.ts` providers에 `SmsTriggerPayloadEnricherRegistry` 추가, exports에 `SmsTriggerPayloadEnricherRegistry`, `MessageTriggerSchedulerService` 추가(Task 2.5/2.6이 사용).

- [ ] **Step 6: 테스트 통과**

Run: `pnpm --filter ./backend test -- sms-trigger-payload-enricher sms-trigger-delivery && pnpm --filter ./backend run type-check`
Expected: PASS, 기존 delivery 스펙도 그대로 PASS.

- [ ] **Step 7: 커밋**

```bash
git add backend/application/services/sms-trigger-payload-enricher.registry.ts backend/application/services/sms-trigger-delivery.service.ts backend/module/message.module.ts backend/test/services/sms-trigger-payload-enricher.spec.ts
git commit -m "feat(messages): add pre-send payload enricher hook to sms trigger delivery"
```

#### Task 2.4: ReceiptLinkIssueService (발급 파이프라인)
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `backend/application/services/receipt-link-issue.service.ts`, `backend/test/services/receipt-link-issue.service.spec.ts`
**Depends:** Task 2.1, Task 2.2, Task 2.3

**Files:**
- Create: `backend/application/services/receipt-link-issue.service.ts`
- Test: `backend/test/services/receipt-link-issue.service.spec.ts`

**Interfaces:**
- Consumes: `PdfPageRasterizerService.renderPageToPng` (2.1), `ReceiptLinkTokenService.issue` (2.2), `SmsTriggerDeliverySkipError` (2.3), `FileStoragePort.upload(file, path, mimetype)` (`domain/ports/file-storage.port`, 토큰 `FILE_STORAGE_PORT`), `EformsignDocumentMirrorService.syncDocument(documentId, principal, options)`, Prisma `client`/`eformsign_doc`/`eformsign_doc_file`/`receipt_link_token`.
- Produces (2.5/2.6이 사용):
  - `type ReceiptLinkSkipReason = "not_voucher_client" | "missing_birthday" | "no_contract_document" | "pdf_unavailable" | "render_failed" | "upload_failed"`
  - `class ReceiptLinkSkipError extends SmsTriggerDeliverySkipError { skipReason: ReceiptLinkSkipReason }`, `RECEIPT_LINK_SKIP_MESSAGES`
  - `preflight({ branchId, clientId }): Promise<ReceiptLinkPreflight>` — 렌더 없이 1~4단계 가드만.
  - `issue({ branchId, clientId, source, jobId?, createdBy? }): Promise<{ url: string; tokenId: string; expiresAt: Date }>`
  - `buildReceiptUrl(linkToken): string`
  - 상수 `RECEIPT_PAGE_NUMBER = 7`, `RECEIPT_IMAGE_WIDTH = 1240`

- [ ] **Step 1: 실패하는 테스트**

`backend/test/services/receipt-link-issue.service.spec.ts`:

```ts
import { createHash } from "node:crypto";
import { ReceiptLinkIssueService, ReceiptLinkSkipError, RECEIPT_PAGE_NUMBER } from "application/services/receipt-link-issue.service";

const BRANCH = "11111111-1111-1111-1111-111111111111";
const PDF = Buffer.from("%PDF-1.4 fake");
const PNG = Buffer.from("png-bytes");
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");

function makeService(overrides: { client?: Record<string, unknown> | null; doc?: Record<string, unknown> | null; file?: { content: Buffer } | null; storedPath?: boolean; baseUrl?: string } = {}) {
    const client = overrides.client === undefined
        ? { id: 7, name: "김산모", phone: "01012345678", voucherClient: true, birthday: "940315", eDocId: "doc-ext-1" }
        : overrides.client;
    const doc = overrides.doc === undefined ? { id: 42, documentId: "doc-ext-1" } : overrides.doc;
    const prisma = {
        client: { findFirst: jest.fn().mockResolvedValue(client) },
        eformsign_doc: { findFirst: jest.fn().mockResolvedValue(doc) },
        eformsign_doc_file: { findUnique: jest.fn().mockResolvedValue(overrides.file === undefined ? { content: PDF } : overrides.file) },
        receipt_link_token: { findFirst: jest.fn().mockResolvedValue(overrides.storedPath ? { id: "existing" } : null) },
    };
    const config = { get: jest.fn((key: string) => (key === "MOBILE_RECEIPT_BASE_URL" ? overrides.baseUrl ?? "https://m.admin.example/" : undefined)) };
    const rasterizer = { renderPageToPng: jest.fn().mockResolvedValue(PNG) };
    const tokenService = { issue: jest.fn().mockResolvedValue({ id: "tok-1", linkToken: "efr_abc", expiresAt: new Date("2026-10-03T00:00:00Z") }) };
    const storage = { upload: jest.fn().mockResolvedValue("receipts/x"), download: jest.fn(), delete: jest.fn() };
    const mirror = { syncDocument: jest.fn().mockResolvedValue({}) };
    const service = new ReceiptLinkIssueService(prisma as never, config as never, rasterizer as never, tokenService as never, storage as never, mirror as never);
    return { service, prisma, rasterizer, tokenService, storage, mirror };
}

describe("ReceiptLinkIssueService", () => {
    it("renders page 7, uploads under a content-addressed path, issues a token and builds the url", async () => {
        const { service, rasterizer, storage, tokenService, prisma } = makeService();
        const result = await service.issue({ branchId: BRANCH, clientId: 7, source: "auto_trigger", jobId: "job-1" });

        expect(prisma.client.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7, branchId: BRANCH } }));
        expect(rasterizer.renderPageToPng).toHaveBeenCalledWith(PDF, RECEIPT_PAGE_NUMBER, { width: 1240 });
        expect(storage.upload).toHaveBeenCalledWith(PNG, `receipts/${BRANCH}/42/${PNG_SHA}.png`, "image/png");
        expect(tokenService.issue).toHaveBeenCalledWith(expect.objectContaining({
            branchId: BRANCH, clientId: 7, eformsignDocId: 42, jobId: "job-1", birthday: "940315",
            storagePath: `receipts/${BRANCH}/42/${PNG_SHA}.png`, contentSha256: PNG_SHA, byteSize: PNG.length, source: "auto_trigger",
        }));
        expect(result).toEqual({ url: "https://m.admin.example/receipt/efr_abc", tokenId: "tok-1", expiresAt: new Date("2026-10-03T00:00:00Z") });
    });

    it.each([
        ["not_voucher_client", { client: { id: 7, name: "김산모", phone: null, voucherClient: false, birthday: "940315", eDocId: null } }],
        ["missing_birthday", { client: { id: 7, name: "김산모", phone: null, voucherClient: true, birthday: null, eDocId: null } }],
        ["no_contract_document", { doc: null }],
        ["no_contract_document", { client: null }],
    ] as const)("skips with %s", async (reason, overrides) => {
        const { service, rasterizer } = makeService(overrides as never);
        await expect(service.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).rejects.toMatchObject({ skipReason: reason });
        expect(rasterizer.renderPageToPng).not.toHaveBeenCalled();
    });

    it("re-syncs the mirror once when the pdf is missing, then skips with pdf_unavailable if still missing", async () => {
        const { service, prisma, mirror } = makeService({ file: null });
        await expect(service.preflight({ branchId: BRANCH, clientId: 7 })).rejects.toMatchObject({ skipReason: "pdf_unavailable" });
        expect(mirror.syncDocument).toHaveBeenCalledWith("doc-ext-1", { branchId: BRANCH, source: "worker" }, expect.objectContaining({ suppressOutboundAutomation: true }));
        expect(prisma.eformsign_doc_file.findUnique).toHaveBeenCalledTimes(2);
    });

    it("uses the pdf that the re-sync brought in", async () => {
        const { service, prisma } = makeService({ file: null });
        prisma.eformsign_doc_file.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ content: PDF });
        const preflight = await service.preflight({ branchId: BRANCH, clientId: 7 });
        expect(preflight.pdf.equals(PDF)).toBe(true);
    });

    it("maps renderer and storage failures to skip reasons", async () => {
        const { service: renderFail, rasterizer } = makeService();
        rasterizer.renderPageToPng.mockRejectedValue(new Error("boom"));
        await expect(renderFail.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).rejects.toMatchObject({ skipReason: "render_failed" });

        const { service: uploadFail, storage } = makeService();
        storage.upload.mockRejectedValue(new Error("network"));
        await expect(uploadFail.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).rejects.toMatchObject({ skipReason: "upload_failed" });
    });

    it("skips the upload when the same image is already stored, and tolerates an already-exists error", async () => {
        const { service: stored, storage: storedStorage } = makeService({ storedPath: true });
        await stored.issue({ branchId: BRANCH, clientId: 7, source: "manual" });
        expect(storedStorage.upload).not.toHaveBeenCalled();

        const { service, storage } = makeService();
        storage.upload.mockRejectedValue(new Error("The resource already exists"));
        await expect(service.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).resolves.toMatchObject({ tokenId: "tok-1" });
    });

    it("falls back to MOBILE_SERVICE_RECORD_BASE_URL and then the production host", () => {
        const { service } = makeService({ baseUrl: "" });
        expect(service.buildReceiptUrl("efr_t")).toBe("https://m.admin.babyjamjam.com/receipt/efr_t");
    });

    it("is a ReceiptLinkSkipError with a Korean message", () => {
        const error = new ReceiptLinkSkipError("missing_birthday");
        expect(error.message).toBe("산모 생년월일이 등록되지 않았습니다");
        expect(error.reason).toBe("missing_birthday");
    });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./backend test -- receipt-link-issue.service`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 서비스 구현**

`backend/application/services/receipt-link-issue.service.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { FILE_STORAGE_PORT, FileStoragePort } from "domain/ports/file-storage.port";
import { PrismaService } from "infrastructure/database/prisma.service";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";
import { EformsignDocumentMirrorService } from "./eformsign-document-mirror.service";
import { ReceiptLinkSource, ReceiptLinkTokenService } from "./receipt-link-token.service";
import { SmsTriggerDeliverySkipError } from "./sms-trigger-payload-enricher.registry";

export const RECEIPT_PAGE_NUMBER = 7;
export const RECEIPT_IMAGE_WIDTH = 1240;
const DEFAULT_RECEIPT_BASE_URL = "https://m.admin.babyjamjam.com";

export type ReceiptLinkSkipReason =
    | "not_voucher_client"
    | "missing_birthday"
    | "no_contract_document"
    | "pdf_unavailable"
    | "render_failed"
    | "upload_failed";

export const RECEIPT_LINK_SKIP_MESSAGES: Record<ReceiptLinkSkipReason, string> = {
    not_voucher_client: "바우처 이용 산모가 아닙니다",
    missing_birthday: "산모 생년월일이 등록되지 않았습니다",
    no_contract_document: "연결된 계약서가 없습니다",
    pdf_unavailable: "계약서 PDF를 아직 불러올 수 없습니다",
    render_failed: "영수증 이미지 생성에 실패했습니다",
    upload_failed: "영수증 이미지 저장에 실패했습니다",
};

export class ReceiptLinkSkipError extends SmsTriggerDeliverySkipError {
    constructor(readonly skipReason: ReceiptLinkSkipReason) {
        super(skipReason, RECEIPT_LINK_SKIP_MESSAGES[skipReason]);
        this.name = "ReceiptLinkSkipError";
    }
}

export interface ReceiptLinkPreflight {
    client: { id: number; name: string; phone: string | null; birthday: string };
    doc: { id: number; documentId: string };
    pdf: Buffer;
}

export interface IssueReceiptLinkParams {
    branchId: string;
    clientId: number;
    source: ReceiptLinkSource;
    jobId?: string | null;
    createdBy?: string | null;
}

export interface IssuedReceiptLink {
    url: string;
    tokenId: string;
    expiresAt: Date;
}

interface ClientRow {
    id: number;
    name: string;
    phone: string | null;
    voucherClient: boolean;
    birthday: string | null;
    eDocId: string | null;
}

@Injectable()
export class ReceiptLinkIssueService {
    private readonly logger = new Logger(ReceiptLinkIssueService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService,
        private readonly rasterizer: PdfPageRasterizerService,
        private readonly tokenService: ReceiptLinkTokenService,
        @Inject(FILE_STORAGE_PORT) private readonly storage: FileStoragePort,
        private readonly documentMirrorService: EformsignDocumentMirrorService,
    ) {}

    /** Steps 1-4 of the pipeline: voucher, birthday, contract document, mirrored PDF. No rendering. */
    async preflight(params: { branchId: string; clientId: number }): Promise<ReceiptLinkPreflight> {
        const client = (await this.prisma.client.findFirst({
            where: { id: params.clientId, branchId: params.branchId },
            select: { id: true, name: true, phone: true, voucherClient: true, birthday: true, eDocId: true },
        })) as ClientRow | null;
        if (!client) throw new ReceiptLinkSkipError("no_contract_document");
        if (!client.voucherClient) throw new ReceiptLinkSkipError("not_voucher_client");

        const birthday = (client.birthday ?? "").trim();
        if (!/^\d{6}$/.test(birthday)) throw new ReceiptLinkSkipError("missing_birthday");

        const doc = await this.findContractDocument(client);
        if (!doc) throw new ReceiptLinkSkipError("no_contract_document");

        const pdf = await this.loadContractPdf(params.branchId, doc);
        if (!pdf) throw new ReceiptLinkSkipError("pdf_unavailable");

        return { client: { id: client.id, name: client.name, phone: client.phone, birthday }, doc, pdf };
    }

    async issue(params: IssueReceiptLinkParams): Promise<IssuedReceiptLink> {
        const { client, doc, pdf } = await this.preflight(params);

        let png: Buffer;
        try {
            png = await this.rasterizer.renderPageToPng(pdf, RECEIPT_PAGE_NUMBER, { width: RECEIPT_IMAGE_WIDTH });
        } catch (error) {
            this.logger.error(`[ReceiptLink] render failed for document ${doc.documentId}: ${describe(error)}`);
            throw new ReceiptLinkSkipError("render_failed");
        }

        const contentSha256 = createHash("sha256").update(png).digest("hex");
        const storagePath = `receipts/${params.branchId}/${doc.id}/${contentSha256}.png`;
        const alreadyStored = await this.prisma.receipt_link_token.findFirst({ where: { storagePath }, select: { id: true } });
        if (!alreadyStored) {
            try {
                await this.storage.upload(png, storagePath, "image/png");
            } catch (error) {
                if (!isAlreadyExistsError(error)) {
                    this.logger.error(`[ReceiptLink] upload failed for ${storagePath}: ${describe(error)}`);
                    throw new ReceiptLinkSkipError("upload_failed");
                }
            }
        }

        const token = await this.tokenService.issue({
            branchId: params.branchId,
            clientId: client.id,
            eformsignDocId: doc.id,
            jobId: params.jobId ?? null,
            birthday: client.birthday,
            storagePath,
            contentSha256,
            byteSize: png.length,
            source: params.source,
            createdBy: params.createdBy ?? null,
        });

        return { url: this.buildReceiptUrl(token.linkToken), tokenId: token.id, expiresAt: token.expiresAt };
    }

    buildReceiptUrl(linkToken: string): string {
        const base =
            this.configService.get<string>("MOBILE_RECEIPT_BASE_URL") ||
            this.configService.get<string>("MOBILE_SERVICE_RECORD_BASE_URL") ||
            DEFAULT_RECEIPT_BASE_URL;
        return `${base.replace(/\/+$/, "")}/receipt/${linkToken}`;
    }

    private async findContractDocument(client: ClientRow): Promise<{ id: number; documentId: string } | null> {
        if (client.eDocId) {
            const byEDocId = await this.prisma.eformsign_doc.findFirst({
                where: { documentId: client.eDocId },
                select: { id: true, documentId: true },
            });
            if (byEDocId) return byEDocId;
        }
        return this.prisma.eformsign_doc.findFirst({
            where: { clientId: client.id, documentKind: "contract" },
            orderBy: { createdDate: "desc" },
            select: { id: true, documentId: true },
        });
    }

    private async loadContractPdf(branchId: string, doc: { id: number; documentId: string }): Promise<Buffer | null> {
        const stored = await this.findStoredPdf(doc.id);
        if (stored) return stored;

        try {
            await this.documentMirrorService.syncDocument(
                doc.documentId,
                { branchId, source: "worker" },
                {
                    skipBranchOwnedProjection: true,
                    skipClientReconciliation: true,
                    skipHealthySameVersionFileRepair: true,
                    suppressOutboundAutomation: true,
                },
            );
        } catch (error) {
            this.logger.warn(`[ReceiptLink] mirror re-sync failed for ${doc.documentId}: ${describe(error)}`);
            return null;
        }
        return this.findStoredPdf(doc.id);
    }

    private async findStoredPdf(eformsignDocId: number): Promise<Buffer | null> {
        const file = await this.prisma.eformsign_doc_file.findUnique({
            where: { eformsignDocId_fileType: { eformsignDocId, fileType: "document" } },
            select: { content: true },
        });
        return file?.content ? Buffer.from(file.content) : null;
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isAlreadyExistsError(error: unknown): boolean {
    return /already exists|duplicate/i.test(describe(error));
}
```
`syncDocument`의 옵션 타입(`SyncEformsignDocumentOptions`)에 위 네 키가 없으면 `eformsign.controller.ts:980-1003`의 `syncMissingDocumentFile`가 넘기는 옵션 이름을 그대로 쓴다.

- [ ] **Step 4: 테스트 통과 + 타입 체크**

Run: `pnpm --filter ./backend test -- receipt-link-issue.service && pnpm --filter ./backend run type-check`
Expected: PASS (9 tests), type-check exit 0.

- [ ] **Step 5: 커밋**

```bash
git add backend/application/services/receipt-link-issue.service.ts backend/test/services/receipt-link-issue.service.spec.ts
git commit -m "feat(receipt-link): issue receipt image links from the mirrored contract pdf"
```

#### Task 2.5: ReceiptLinkModule + 공개 API + 발송 enricher 등록
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `backend/module/receipt-link.module.ts`, `backend/app.module.ts`, `backend/interface/controllers/receipt-link.controller.ts`, `backend/interface/dto/receipt-link.dto.ts`, `backend/application/services/receipt-link-delivery-enricher.service.ts`, `backend/test/services/receipt-link-delivery-enricher.spec.ts`, `backend/test/services/receipt-link.controller.spec.ts`
**Depends:** Task 2.3, Task 2.4

**Files:**
- Create: `backend/module/receipt-link.module.ts`
- Create: `backend/interface/controllers/receipt-link.controller.ts`
- Create: `backend/interface/dto/receipt-link.dto.ts`
- Create: `backend/application/services/receipt-link-delivery-enricher.service.ts`
- Modify: `backend/app.module.ts:94` (`ServiceRecordEntryModule` 다음에 `ReceiptLinkModule`)
- Test: `backend/test/services/receipt-link-delivery-enricher.spec.ts`, `backend/test/services/receipt-link.controller.spec.ts`

**Interfaces:**
- Consumes: 2.2 토큰 서비스, 2.3 레지스트리, 2.4 발급 서비스, `RateLimitGuard`(`infrastructure/auth/rate-limit.guard`), `FileStoragePort.download`.
- Produces (m.admin BFF가 호출):
  - `GET /receipt-links/:token/status` → 200 `ReceiptLinkStatus`(ok:true 형태) | 404 `{reason:"not_found"}` | 410 `{reason:"expired"|"revoked"}`
  - `POST /receipt-links/:token/verify {birthday}` → 200 `{ok:true, accessToken, clientName}` | 400 `{reason:"invalid_format"}` | 401 `{reason:"verification_failed", remainingAttempts}` | 423 `{reason:"locked", lockedUntil}` | 404/410
  - `GET /receipt-links/:token/image?download=0|1` 헤더 `X-Receipt-Access-Token`(또는 `Authorization: Bearer`) → `image/png` | 401 `{reason:"access_required"}`

- [ ] **Step 1: 실패하는 테스트 (enricher)**

`backend/test/services/receipt-link-delivery-enricher.spec.ts`:

```ts
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { SmsTriggerPayloadEnricherRegistry } from "application/services/sms-trigger-payload-enricher.registry";

function makeJob(dedupeKey: string) {
    return MessageTriggerJobEntity.create({
        branchId: "11111111-1111-1111-1111-111111111111",
        ruleId: "system:service_end_notice",
        scheduledFor: new Date(),
        clientId: 7,
        recipientType: MessageTriggerRecipientType.CLIENT,
        recipientPhone: "01012345678",
        templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        dedupeKey,
        payload: { memberId: "client:7", recipientName: "김산모", recipientPhone: "01012345678", templateVariables: { name: "김산모" } },
    });
}

describe("ReceiptLinkDeliveryEnricher", () => {
    it("registers itself for SERVICE_END_NOTICE on module init", () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const enricher = new ReceiptLinkDeliveryEnricher(registry, { issue: jest.fn() } as never);
        enricher.onModuleInit();
        expect(registry.get(MessageTriggerTemplateKey.SERVICE_END_NOTICE)).toBe(enricher);
    });

    it("issues a link for the job's client and writes receiptUrl into the payload", async () => {
        const issueService = { issue: jest.fn().mockResolvedValue({ url: "https://m.admin.example/receipt/efr_1", tokenId: "t", expiresAt: new Date() }) };
        const enricher = new ReceiptLinkDeliveryEnricher(new SmsTriggerPayloadEnricherRegistry(), issueService as never);
        const job = makeJob("rule-1:client:7");
        Object.defineProperty(job, "id", { value: "job-9" });

        await enricher.enrich(job);

        expect(issueService.issue).toHaveBeenCalledWith({ branchId: "11111111-1111-1111-1111-111111111111", clientId: 7, source: "auto_trigger", jobId: "job-9" });
        expect(job.payload.templateVariables.receiptUrl).toBe("https://m.admin.example/receipt/efr_1");
        expect(job.payload.buttonUrl).toBe("https://m.admin.example/receipt/efr_1");
    });

    it("marks manual sends by their dedupe key", async () => {
        const issueService = { issue: jest.fn().mockResolvedValue({ url: "u", tokenId: "t", expiresAt: new Date() }) };
        const enricher = new ReceiptLinkDeliveryEnricher(new SmsTriggerPayloadEnricherRegistry(), issueService as never);
        await enricher.enrich(makeJob("system:service_end_notice:client:7:manual:abc"));
        expect(issueService.issue).toHaveBeenCalledWith(expect.objectContaining({ source: "manual" }));
    });
});
```
(`job.id`가 getter라 `defineProperty`가 안 되면 `MessageTriggerJobEntity`의 생성자를 직접 호출해 id를 넣는다 — 생성자 인자 순서는 `create()` 구현을 그대로 따른다.)

- [ ] **Step 2: 실패하는 테스트 (컨트롤러, supertest)**

`backend/test/services/receipt-link.controller.spec.ts`:

```ts
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { FILE_STORAGE_PORT } from "domain/ports/file-storage.port";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { ReceiptLinkController } from "interface/controllers/receipt-link.controller";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";

describe("ReceiptLinkController", () => {
    let app: INestApplication;
    const tokenService = { getStatus: jest.fn(), verifyBirthday: jest.fn(), resolveAccess: jest.fn() };
    const storage = { download: jest.fn() };

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [ReceiptLinkController],
            providers: [
                { provide: ReceiptLinkTokenService, useValue: tokenService },
                { provide: FILE_STORAGE_PORT, useValue: storage },
            ],
        })
            .overrideGuard(RateLimitGuard)
            .useValue({ canActivate: () => true })
            .compile();
        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe());
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => jest.clearAllMocks());

    it("GET status maps expired links to 410 and unknown links to 404", async () => {
        tokenService.getStatus.mockResolvedValueOnce({ ok: false, reason: "expired" });
        await request(app.getHttpServer()).get("/receipt-links/efr_x/status").expect(410, { reason: "expired" });
        tokenService.getStatus.mockResolvedValueOnce({ ok: false, reason: "not_found" });
        await request(app.getHttpServer()).get("/receipt-links/efr_x/status").expect(404, { reason: "not_found" });
        tokenService.getStatus.mockResolvedValueOnce({ ok: true, state: "pending", branchName: "인천 아이미래로", expiresAt: "2026-10-03T00:00:00.000Z", remainingAttempts: 5, lockedUntil: null });
        await request(app.getHttpServer()).get("/receipt-links/efr_x/status").expect(200).expect((res) => expect(res.body.branchName).toBe("인천 아이미래로"));
    });

    it("POST verify returns 401 with remaining attempts, 423 when locked, 200 with the access token", async () => {
        tokenService.verifyBirthday.mockResolvedValueOnce({ ok: false, reason: "verification_failed", remainingAttempts: 3 });
        await request(app.getHttpServer()).post("/receipt-links/efr_x/verify").send({ birthday: "000000" }).expect(401, { reason: "verification_failed", remainingAttempts: 3 });
        tokenService.verifyBirthday.mockResolvedValueOnce({ ok: false, reason: "locked", lockedUntil: "2026-09-03T01:00:00.000Z" });
        await request(app.getHttpServer()).post("/receipt-links/efr_x/verify").send({ birthday: "000000" }).expect(423, { reason: "locked", lockedUntil: "2026-09-03T01:00:00.000Z" });
        tokenService.verifyBirthday.mockResolvedValueOnce({ ok: true, accessToken: "efra_a", clientName: "김산모" });
        await request(app.getHttpServer()).post("/receipt-links/efr_x/verify").send({ birthday: "940315" }).expect(200, { ok: true, accessToken: "efra_a", clientName: "김산모" });
        await request(app.getHttpServer()).post("/receipt-links/efr_x/verify").send({}).expect(400);
    });

    it("GET image requires the access token and streams the png with a download disposition on demand", async () => {
        await request(app.getHttpServer()).get("/receipt-links/efr_x/image").expect(401);
        tokenService.resolveAccess.mockResolvedValue({ id: "t", storagePath: "receipts/b/1/a.png", clientName: "김산모", expiresAt: new Date() });
        storage.download.mockResolvedValue(Buffer.from("png"));

        const inline = await request(app.getHttpServer()).get("/receipt-links/efr_x/image").set("X-Receipt-Access-Token", "efra_a").expect(200);
        expect(inline.headers["content-type"]).toBe("image/png");
        expect(inline.headers["content-disposition"]).toMatch(/^inline;/);
        expect(inline.headers["cache-control"]).toBe("private, no-store");

        const download = await request(app.getHttpServer()).get("/receipt-links/efr_x/image?download=1").set("Authorization", "Bearer efra_a").expect(200);
        expect(download.headers["content-disposition"]).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''%EC%98%81%EC%88%98%EC%A6%9D_/);
        expect(tokenService.resolveAccess).toHaveBeenLastCalledWith("efr_x", "efra_a", expect.any(Date));
    });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter ./backend test -- receipt-link-delivery-enricher receipt-link.controller`
Expected: FAIL (모듈 없음).

- [ ] **Step 4: enricher 구현**

`backend/application/services/receipt-link-delivery-enricher.service.ts`:

```ts
import { Injectable, OnModuleInit } from "@nestjs/common";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { ReceiptLinkIssueService, ReceiptLinkSkipError } from "./receipt-link-issue.service";
import { SmsTriggerPayloadEnricher, SmsTriggerPayloadEnricherRegistry } from "./sms-trigger-payload-enricher.registry";

export const MANUAL_DEDUPE_MARKER = ":manual:";

/** Issues the receipt link at delivery time so the 30-day window starts when the SMS goes out. */
@Injectable()
export class ReceiptLinkDeliveryEnricher implements SmsTriggerPayloadEnricher, OnModuleInit {
    constructor(
        private readonly registry: SmsTriggerPayloadEnricherRegistry,
        private readonly issueService: ReceiptLinkIssueService,
    ) {}

    onModuleInit(): void {
        this.registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, this);
    }

    async enrich(job: MessageTriggerJobEntity): Promise<void> {
        if (!job.branchId || !job.clientId) {
            throw new ReceiptLinkSkipError("no_contract_document");
        }
        const issued = await this.issueService.issue({
            branchId: job.branchId,
            clientId: job.clientId,
            source: job.dedupeKey.includes(MANUAL_DEDUPE_MARKER) ? "manual" : "auto_trigger",
            jobId: job.id,
        });
        job.payload.templateVariables.receiptUrl = issued.url;
        job.payload.buttonUrl = issued.url;
    }
}
```

- [ ] **Step 5: DTO + 컨트롤러 구현**

`backend/interface/dto/receipt-link.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class VerifyReceiptBirthdayDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(12)
    birthday!: string;
}

export class SendReceiptLinkDto {
    @IsString()
    @IsNotEmpty()
    documentId!: string;
}
```

`backend/interface/controllers/receipt-link.controller.ts`:

```ts
import {
    BadRequestException,
    Body,
    Controller,
    Get,
    GoneException,
    Headers,
    HttpCode,
    HttpException,
    HttpStatus,
    Inject,
    NotFoundException,
    Param,
    Post,
    Query,
    Res,
    UnauthorizedException,
    UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { FILE_STORAGE_PORT, FileStoragePort } from "domain/ports/file-storage.port";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { ReceiptLinkTokenService, ReceiptLinkUnusableReason } from "application/services/receipt-link-token.service";
import { VerifyReceiptBirthdayDto } from "interface/dto/receipt-link.dto";

function buildContentDisposition(type: "inline" | "attachment", filename: string): string {
    const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function unusableToHttp(reason: ReceiptLinkUnusableReason): HttpException {
    return reason === "not_found" ? new NotFoundException({ reason }) : new GoneException({ reason });
}

/** Public, unauthenticated endpoints for the mother-facing receipt page. */
@Controller("receipt-links")
export class ReceiptLinkController {
    constructor(
        private readonly tokenService: ReceiptLinkTokenService,
        @Inject(FILE_STORAGE_PORT) private readonly storage: FileStoragePort,
    ) {}

    @Get(":token/status")
    @UseGuards(RateLimitGuard)
    async status(@Param("token") token: string) {
        const result = await this.tokenService.getStatus(token, new Date());
        if (!result.ok) throw unusableToHttp(result.reason);
        return result;
    }

    @Post(":token/verify")
    @HttpCode(200)
    @UseGuards(RateLimitGuard)
    async verify(@Param("token") token: string, @Body() body: VerifyReceiptBirthdayDto) {
        const result = await this.tokenService.verifyBirthday(token, body.birthday, new Date());
        if (result.ok) return result;
        switch (result.reason) {
            case "verification_failed":
                throw new UnauthorizedException({ reason: result.reason, remainingAttempts: result.remainingAttempts });
            case "locked":
                throw new HttpException({ reason: result.reason, lockedUntil: result.lockedUntil }, HttpStatus.LOCKED);
            case "invalid_format":
                throw new BadRequestException({ reason: result.reason });
            default:
                throw unusableToHttp(result.reason);
        }
    }

    @Get(":token/image")
    async image(
        @Param("token") token: string,
        @Query("download") download: string | undefined,
        @Headers("x-receipt-access-token") headerToken: string | undefined,
        @Headers("authorization") authorization: string | undefined,
        @Res() res: Response,
    ): Promise<void> {
        const accessToken = headerToken?.trim() || authorization?.replace(/^Bearer\s+/i, "").trim() || "";
        const access = accessToken ? await this.tokenService.resolveAccess(token, accessToken, new Date()) : null;
        if (!access) throw new UnauthorizedException({ reason: "access_required" });

        const png = await this.storage.download(access.storagePath);
        res.set({
            "Content-Type": "image/png",
            "Content-Length": String(png.length),
            "Content-Disposition": buildContentDisposition(download === "1" ? "attachment" : "inline", `영수증_${access.clientName}.png`),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        });
        res.send(png);
    }
}
```

- [ ] **Step 6: 모듈 + AppModule**

`backend/module/receipt-link.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { FILE_STORAGE_PORT } from "domain/ports/file-storage.port";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SupabaseStorageAdapter } from "infrastructure/adapters/supabase-storage.adapter";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { ReceiptLinkIssueService } from "application/services/receipt-link-issue.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { ReceiptLinkController } from "interface/controllers/receipt-link.controller";
import { EformsignDocModule } from "./eformsign-doc.module";
import { MessageModule } from "./message.module";

// Leaf module: imports MessageModule (registry, job repo, scheduler) and EformsignDocModule
// (mirror service). Nothing imports ReceiptLinkModule except AppModule, so there is no cycle
// even though EformsignDocModule itself imports MessageModule.
@Module({
    imports: [DatabaseModule, ConfigModule, MessageModule, EformsignDocModule],
    controllers: [ReceiptLinkController],
    providers: [
        SupabaseStorageAdapter,
        { provide: FILE_STORAGE_PORT, useClass: SupabaseStorageAdapter },
        PdfPageRasterizerService,
        ReceiptLinkTokenService,
        ReceiptLinkIssueService,
        ReceiptLinkDeliveryEnricher,
    ],
    exports: [ReceiptLinkIssueService, ReceiptLinkTokenService],
})
export class ReceiptLinkModule {}
```
`backend/app.module.ts` imports 배열의 `ServiceRecordEntryModule,` 다음 줄에 `ReceiptLinkModule,` 추가(+ import 문). `SupabaseStorageAdapter`가 다른 의존(예: ConfigService)을 요구하면 `backend/module/document.module.ts:20-40`의 provider 구성을 그대로 복사한다.

- [ ] **Step 7: 테스트 + 부팅 확인**

Run:
```bash
pnpm --filter ./backend test -- receipt-link-delivery-enricher receipt-link.controller
pnpm --filter ./backend run type-check
pnpm --filter ./backend build && (cd backend && timeout 40 node dist/main | grep -E "ReceiptLinkController|Nest application successfully started|Error" | head -5)
```
Expected: 테스트 PASS, `RouterExplorer ... ReceiptLinkController {/receipt-links}` 로그와 정상 기동(순환 의존 오류 없음). 부팅 로그에 DI 오류가 나오면 `document.module.ts`의 storage provider 구성과 비교한다.

- [ ] **Step 8: 커밋**

```bash
git add backend/module/receipt-link.module.ts backend/app.module.ts backend/interface/controllers/receipt-link.controller.ts backend/interface/dto/receipt-link.dto.ts backend/application/services/receipt-link-delivery-enricher.service.ts backend/test/services/receipt-link-delivery-enricher.spec.ts backend/test/services/receipt-link.controller.spec.ts
git commit -m "feat(receipt-link): public status/verify/image api and delivery-time link issuance"
```

#### Task 2.6: 수동 발송 API
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `backend/application/services/receipt-link-manual-send.service.ts`, `backend/interface/controllers/receipt-link-admin.controller.ts`, `backend/module/receipt-link.module.ts`, `backend/module/message-delivery.module.ts`, `backend/test/services/receipt-link-manual-send.service.spec.ts`
**Depends:** Task 2.5

**Files:**
- Create: `backend/application/services/receipt-link-manual-send.service.ts`
- Create: `backend/interface/controllers/receipt-link-admin.controller.ts`
- Modify: `backend/module/receipt-link.module.ts` (controller/provider 추가, `MessageDeliveryModule` import)
- Modify: `backend/module/message-delivery.module.ts` (`exports: [MessageSenderApprovalService]` 추가)
- Test: `backend/test/services/receipt-link-manual-send.service.spec.ts`

**Interfaces:**
- Consumes: `ReceiptLinkIssueService.preflight`, `MESSAGE_TRIGGER_JOB_REPOSITORY.upsertPending(job)`, `MessageTriggerSchedulerService.dispatchDueJobs()`, `MessageSenderApprovalService.ensureApproved(branchId)`, `PrismaService`(eformsign_doc 조회 + 합성 규칙 upsert), `normalizePhone`(`application/utils/normalize-phone`).
- Produces: `POST /receipt-links/send { documentId }` (JwtGuard + TenantGuard) → 200 `{ jobId, scheduledFor, clientName }` | 400 `{ reason }`(reason ∈ ReceiptLinkSkipReason ∪ `"document_not_linked" | "missing_phone"`) | 404 `{ reason: "document_not_found" }`.

- [ ] **Step 1: 실패하는 테스트**

`backend/test/services/receipt-link-manual-send.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";
import { ReceiptLinkSkipError } from "application/services/receipt-link-issue.service";
import { ReceiptLinkManualSendService } from "application/services/receipt-link-manual-send.service";

const BRANCH = "11111111-1111-1111-1111-111111111111";

function makeService(overrides: { doc?: Record<string, unknown> | null; preflight?: () => Promise<unknown> } = {}) {
    const prisma = {
        eformsign_doc: { findUnique: jest.fn().mockResolvedValue(overrides.doc === undefined ? { id: 42, documentId: "doc-ext-1", clientId: 7 } : overrides.doc) },
        message_trigger_rule: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const issueService = {
        preflight: jest.fn(overrides.preflight ?? (async () => ({ client: { id: 7, name: "김산모", phone: "010-1234-5678", birthday: "940315" }, doc: { id: 42, documentId: "doc-ext-1" }, pdf: Buffer.alloc(1) }))),
    };
    const jobRepository = { upsertPending: jest.fn(async (job) => Object.assign(job, { id: "job-1" })) };
    const scheduler = { dispatchDueJobs: jest.fn().mockResolvedValue(undefined) };
    const approval = { ensureApproved: jest.fn().mockResolvedValue(undefined) };
    const service = new ReceiptLinkManualSendService(prisma as never, issueService as never, jobRepository as never, scheduler as never, approval as never);
    return { service, prisma, issueService, jobRepository, scheduler, approval };
}

describe("ReceiptLinkManualSendService", () => {
    it("enqueues a SERVICE_END_NOTICE job for the document's client and nudges the scheduler", async () => {
        const { service, prisma, jobRepository, scheduler, approval } = makeService();
        const result = await service.send({ branchId: BRANCH, documentId: "doc-ext-1", userId: "user-1" });

        expect(approval.ensureApproved).toHaveBeenCalledWith(BRANCH);
        expect(prisma.message_trigger_rule.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: SERVICE_END_NOTICE_RULE_ID } }));
        const job = jobRepository.upsertPending.mock.calls[0][0];
        expect(job.templateKey).toBe(MessageTriggerTemplateKey.SERVICE_END_NOTICE);
        expect(job.ruleId).toBe(SERVICE_END_NOTICE_RULE_ID);
        expect(job.clientId).toBe(7);
        expect(job.recipientType).toBe(MessageTriggerRecipientType.CLIENT);
        expect(job.recipientPhone).toBe("01012345678");
        expect(job.dedupeKey).toMatch(new RegExp(`^${SERVICE_END_NOTICE_RULE_ID}:client:7:manual:`));
        expect(job.payload).toMatchObject({ clientId: 7, clientName: "김산모", memberId: "client:7", recipientName: "김산모", recipientPhone: "01012345678", templateVariables: { name: "김산모", clientName: "김산모", phone: "01012345678" } });
        expect(scheduler.dispatchDueJobs).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ jobId: "job-1", scheduledFor: expect.any(Date), clientName: "김산모" });
    });

    it("404s for an unknown document and 400s for a document without a client", async () => {
        await expect(makeService({ doc: null }).service.send({ branchId: BRANCH, documentId: "x", userId: null })).rejects.toBeInstanceOf(NotFoundException);
        await expect(makeService({ doc: { id: 1, documentId: "x", clientId: null } }).service.send({ branchId: BRANCH, documentId: "x", userId: null }))
            .rejects.toMatchObject({ response: { reason: "document_not_linked" } });
    });

    it("surfaces preflight skip reasons as 400 without enqueueing", async () => {
        const { service, jobRepository } = makeService({ preflight: async () => { throw new ReceiptLinkSkipError("not_voucher_client"); } });
        await expect(service.send({ branchId: BRANCH, documentId: "doc-ext-1", userId: null })).rejects.toMatchObject({ response: { reason: "not_voucher_client", message: "바우처 이용 산모가 아닙니다" } });
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("400s when the client has no phone", async () => {
        const { service } = makeService({ preflight: async () => ({ client: { id: 7, name: "김산모", phone: null, birthday: "940315" }, doc: { id: 42, documentId: "d" }, pdf: Buffer.alloc(1) }) });
        await expect(service.send({ branchId: BRANCH, documentId: "doc-ext-1", userId: null })).rejects.toMatchObject({ response: { reason: "missing_phone" } });
    });

    it("does not fail the request when the scheduler nudge throws", async () => {
        const { service, scheduler } = makeService();
        scheduler.dispatchDueJobs.mockRejectedValue(new Error("lease busy"));
        await expect(service.send({ branchId: BRANCH, documentId: "doc-ext-1", userId: null })).resolves.toMatchObject({ jobId: "job-1" });
    });
});
```
`BadRequestException`은 `expect(...).rejects.toBeInstanceOf(BadRequestException)`으로도 확인한다(import 사용).

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./backend test -- receipt-link-manual-send`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 서비스 구현**

`backend/application/services/receipt-link-manual-send.service.ts`:

```ts
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SERVICE_END_NOTICE_RULE_ID, SERVICE_END_NOTICE_SMS_TITLE } from "domain/constants/service-end-notice-message";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { IMessageTriggerJobRepository, MESSAGE_TRIGGER_JOB_REPOSITORY } from "domain/repositories/message-trigger-job.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { normalizePhone } from "application/utils/normalize-phone";
import { MessageSenderApprovalService } from "./message-sender-approval.service";
import { MessageTriggerSchedulerService } from "./message-trigger-scheduler.service";
import { ReceiptLinkIssueService, ReceiptLinkSkipError } from "./receipt-link-issue.service";

export interface ManualReceiptLinkSendParams {
    branchId: string;
    documentId: string;
    userId: string | null;
}

export interface ManualReceiptLinkSendResult {
    jobId: string;
    scheduledFor: Date;
    clientName: string;
}

@Injectable()
export class ReceiptLinkManualSendService {
    private readonly logger = new Logger(ReceiptLinkManualSendService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly issueService: ReceiptLinkIssueService,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY) private readonly jobRepository: IMessageTriggerJobRepository,
        private readonly scheduler: MessageTriggerSchedulerService,
        private readonly senderApproval: MessageSenderApprovalService,
    ) {}

    async send(params: ManualReceiptLinkSendParams): Promise<ManualReceiptLinkSendResult> {
        await this.senderApproval.ensureApproved(params.branchId);

        const doc = await this.prisma.eformsign_doc.findUnique({
            where: { documentId: params.documentId },
            select: { id: true, documentId: true, clientId: true },
        });
        if (!doc) throw new NotFoundException({ reason: "document_not_found" });
        if (!doc.clientId) throw new BadRequestException({ reason: "document_not_linked", message: "계약서에 연결된 산모가 없습니다" });

        let preflight;
        try {
            preflight = await this.issueService.preflight({ branchId: params.branchId, clientId: doc.clientId });
        } catch (error) {
            if (error instanceof ReceiptLinkSkipError) {
                throw new BadRequestException({ reason: error.skipReason, message: error.message });
            }
            throw error;
        }

        const phone = preflight.client.phone ? normalizePhone(preflight.client.phone) : "";
        if (!phone) throw new BadRequestException({ reason: "missing_phone", message: "산모 연락처가 등록되지 않았습니다" });

        await this.ensureSystemRule();

        const now = new Date();
        const clientName = preflight.client.name;
        const job = MessageTriggerJobEntity.create({
            branchId: params.branchId,
            ruleId: SERVICE_END_NOTICE_RULE_ID,
            scheduledFor: now,
            clientId: preflight.client.id,
            employeeScheduleId: null,
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: phone,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            dedupeKey: `${SERVICE_END_NOTICE_RULE_ID}:client:${preflight.client.id}:manual:${randomUUID()}`,
            payload: {
                clientId: preflight.client.id,
                clientName,
                memberId: `client:${preflight.client.id}`,
                recipientName: clientName,
                recipientPhone: phone,
                templateVariables: { name: clientName, clientName, phone },
            },
        });
        const saved = await this.jobRepository.upsertPending(job);

        // Best effort: the lease holder's minute cron picks the job up regardless.
        try {
            await this.scheduler.dispatchDueJobs();
        } catch (error) {
            this.logger.warn(`[ReceiptLink] scheduler nudge failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        return { jobId: saved.id, scheduledFor: now, clientName };
    }

    /** The synthetic rule row message_trigger_job.rule_id points at (mirrors service-record-link.service.ts ensureSystemRule). */
    private async ensureSystemRule(): Promise<void> {
        await this.prisma.message_trigger_rule.upsert({
            where: { id: SERVICE_END_NOTICE_RULE_ID },
            create: {
                id: SERVICE_END_NOTICE_RULE_ID,
                branchId: null,
                name: SERVICE_END_NOTICE_SMS_TITLE,
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_END,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
                isDefault: false,
                jobsStale: false,
            },
            update: {},
        });
    }
}
```
`normalizePhone`이 `null`을 받지 못하거나 반환형이 다르면 `application/utils/normalize-phone.ts`의 실제 시그니처에 맞춰 호출부만 조정한다(하이픈 제거 후 숫자만 남긴 값이어야 함). 이 합성 규칙은 `branchId: null`이라 자동 규칙 목록 UI에 나타나지 않는다 — `system:service_record_link`와 같은 취급.

- [ ] **Step 4: 컨트롤러 + 모듈**

`backend/interface/controllers/receipt-link-admin.controller.ts`:

```ts
import { Body, Controller, ForbiddenException, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { ReceiptLinkManualSendService } from "application/services/receipt-link-manual-send.service";
import { SendReceiptLinkDto } from "interface/dto/receipt-link.dto";

@Controller("receipt-links")
@UseGuards(JwtGuard, TenantGuard)
export class ReceiptLinkAdminController {
    constructor(private readonly manualSendService: ReceiptLinkManualSendService) {}

    /** Staff action: queue a "서비스 종료 안내" SMS with a fresh receipt link for the document's client. */
    @Post("send")
    @HttpCode(200)
    async send(
        @Body() dto: SendReceiptLinkDto,
        @CurrentTenant() tenant: { branchId?: string },
        @Req() request: { user?: { id?: string } },
    ) {
        if (!tenant.branchId) {
            throw new ForbiddenException({ reason: "branch_required" });
        }
        return this.manualSendService.send({
            branchId: tenant.branchId,
            documentId: dto.documentId,
            userId: request.user?.id ?? null,
        });
    }
}
```
`MessageDeliveryController`가 `tenant.branchId` 부재를 다른 예외 타입으로 처리하고 있으면(`message-delivery.controller.ts:53-70`) 그 타입을 그대로 쓴다. `request.user`는 `JwtGuard`(passport)가 채운다.

`backend/module/message-delivery.module.ts`에 `exports: [MessageSenderApprovalService]` 추가. `backend/module/receipt-link.module.ts`: imports에 `MessageDeliveryModule`, controllers에 `ReceiptLinkAdminController`, providers에 `ReceiptLinkManualSendService`. 라우트 순서: `POST /receipt-links/send`는 `:token/*` 패턴과 겹치지 않는다(`send`는 `:token/status` 형태가 아님).

- [ ] **Step 5: 테스트 + 타입 체크 + 부팅**

Run: `pnpm --filter ./backend test -- receipt-link-manual-send && pnpm --filter ./backend run type-check && pnpm --filter ./backend build`
Expected: PASS / exit 0. `MessageDeliveryModule`을 import했을 때 순환 오류가 나면(그 모듈이 `ReceiptLinkModule`을 간접 import하지 않는 한 발생하지 않음) `MessageSenderApprovalService`를 `ReceiptLinkModule` providers에 직접 추가하고(`PrismaService` + `AdminAuditEventWriter` 의존성은 `message-delivery.module.ts`의 provider 구성을 복사) import를 제거한다.

- [ ] **Step 6: 커밋**

```bash
git add backend/application/services/receipt-link-manual-send.service.ts backend/interface/controllers/receipt-link-admin.controller.ts backend/module/receipt-link.module.ts backend/module/message-delivery.module.ts backend/test/services/receipt-link-manual-send.service.spec.ts
git commit -m "feat(receipt-link): manual send endpoint queues a service-end notice job"
```

#### Task 2.7: 만료 링크 정리 크론
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `backend/application/services/receipt-link-cleanup-scheduler.service.ts`, `backend/module/receipt-link.module.ts`, `backend/test/services/receipt-link-cleanup-scheduler.service.spec.ts`
**Depends:** Task 2.6

**Files:**
- Create: `backend/application/services/receipt-link-cleanup-scheduler.service.ts`
- Modify: `backend/module/receipt-link.module.ts` (imports에 `SchedulerLeaseModule`, providers에 스케줄러)
- Test: `backend/test/services/receipt-link-cleanup-scheduler.service.spec.ts`

**Interfaces:**
- Consumes: `ReceiptLinkTokenService.collectExpired/deleteByIds`, `FileStoragePort.delete`, `SchedulerLeaseService.holdsLease()`(`application/services/scheduler-lease.service`, 모듈 `module/scheduler-lease.module`).
- Produces: `@Cron("30 4 * * *", { timeZone: "Asia/Seoul" }) cleanupExpiredLinks()`; 만료 후 1일 지난 토큰 행 삭제 + 고아 이미지 삭제.

- [ ] **Step 1: 실패하는 테스트**

`backend/test/services/receipt-link-cleanup-scheduler.service.spec.ts`:

```ts
import { ReceiptLinkCleanupSchedulerService } from "application/services/receipt-link-cleanup-scheduler.service";

function makeService(holdsLease = true) {
    const tokenService = {
        collectExpired: jest.fn().mockResolvedValue({ ids: ["a", "b"], orphanStoragePaths: ["receipts/x/1/a.png"] }),
        deleteByIds: jest.fn().mockResolvedValue(2),
    };
    const storage = { delete: jest.fn().mockResolvedValue(undefined) };
    const lease = { holdsLease: () => holdsLease };
    const service = new ReceiptLinkCleanupSchedulerService(tokenService as never, storage as never, lease as never);
    return { service, tokenService, storage };
}

describe("ReceiptLinkCleanupSchedulerService", () => {
    it("deletes orphaned images then the expired rows, using a 1-day cutoff", async () => {
        const { service, tokenService, storage } = makeService();
        const now = new Date("2026-09-03T04:30:00+09:00");
        await service.cleanupExpiredLinks(now);
        expect(tokenService.collectExpired).toHaveBeenCalledWith(new Date(now.getTime() - 24 * 60 * 60 * 1000));
        expect(storage.delete).toHaveBeenCalledWith("receipts/x/1/a.png");
        expect(tokenService.deleteByIds).toHaveBeenCalledWith(["a", "b"]);
    });

    it("keeps going when one storage delete fails", async () => {
        const { service, tokenService, storage } = makeService();
        storage.delete.mockRejectedValueOnce(new Error("not found"));
        await service.cleanupExpiredLinks(new Date());
        expect(tokenService.deleteByIds).toHaveBeenCalled();
    });

    it("does nothing without the scheduler lease", async () => {
        const { service, tokenService } = makeService(false);
        await service.cleanupExpiredLinks(new Date());
        expect(tokenService.collectExpired).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./backend test -- receipt-link-cleanup-scheduler`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

`backend/application/services/receipt-link-cleanup-scheduler.service.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { FILE_STORAGE_PORT, FileStoragePort } from "domain/ports/file-storage.port";
import { ReceiptLinkTokenService } from "./receipt-link-token.service";
import { SchedulerLeaseService } from "./scheduler-lease.service";

const EXPIRED_GRACE_MS = 24 * 60 * 60 * 1000;

/** Nightly: drop receipt images and token rows that expired more than a day ago. */
@Injectable()
export class ReceiptLinkCleanupSchedulerService {
    private readonly logger = new Logger(ReceiptLinkCleanupSchedulerService.name);

    constructor(
        private readonly tokenService: ReceiptLinkTokenService,
        @Inject(FILE_STORAGE_PORT) private readonly storage: FileStoragePort,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    @Cron("30 4 * * *", { timeZone: "Asia/Seoul" })
    async cleanupExpiredLinks(now: Date = new Date()): Promise<void> {
        if (!this.schedulerLease.holdsLease()) return;

        const cutoff = new Date(now.getTime() - EXPIRED_GRACE_MS);
        const { ids, orphanStoragePaths } = await this.tokenService.collectExpired(cutoff);
        if (ids.length === 0) return;

        for (const path of orphanStoragePaths) {
            try {
                await this.storage.delete(path);
            } catch (error) {
                this.logger.warn(`[ReceiptLink] failed to delete ${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        const deleted = await this.tokenService.deleteByIds(ids);
        this.logger.log(`[ReceiptLink] cleanup removed ${deleted} expired tokens and ${orphanStoragePaths.length} images`);
    }
}
```
`@Cron` 핸들러는 인자 없이 호출되므로 `now` 기본값이 실제 크론 경로다. `receipt-link.module.ts` imports에 `SchedulerLeaseModule`(`./scheduler-lease.module`), providers에 `ReceiptLinkCleanupSchedulerService` 추가.

- [ ] **Step 4: 테스트 통과**

Run: `pnpm --filter ./backend test -- receipt-link && pnpm --filter ./backend run type-check && pnpm --filter ./backend run lint`
Expected: receipt-link 스펙 전부 PASS, type-check/lint exit 0.

- [ ] **Step 5: 커밋**

```bash
git add backend/application/services/receipt-link-cleanup-scheduler.service.ts backend/module/receipt-link.module.ts backend/test/services/receipt-link-cleanup-scheduler.service.spec.ts
git commit -m "feat(receipt-link): nightly cleanup of expired receipt links and images"
```

---
## Phase 3 — 클라이언트 (산모 공개 페이지 · admin 데스크톱 수동 발송 · m.admin 셸 수동 발송)

한 줄 요약: 세 앱 표면을 서로 다른 경로에서 동시에 붙인다 — 산모가 링크를 열어 생년월일로 확인하고 이미지를 저장하는 공개 페이지, 그리고 직원이 문서 화면에서 "영수증 문자 발송"을 누르는 데스크톱/모바일 액션.

**In parallel:**
- **m.admin 공개 영수증 페이지 + BFF** (feature, high)
  - `/receipt/[token]` 페이지(목업 문구 고정), `api/receipt/[token]/{status,verify,image}`, 쿠키 헬퍼, 미들웨어 공개 경로, Playwright 흐름 테스트.
- **admin 데스크톱 수동 발송** (feature, medium)
  - 문서 미리보기 다이얼로그 "영수증 문자 발송" 버튼 + 확인 다이얼로그 + BFF + api 클라이언트.
- **m.admin 셸 수동 발송** (feature, medium)
  - 계약 상세 액션 "영수증 문자" + 확인 모달 + BFF + api 클라이언트.

공통 사유 메시지(두 앱에 같은 내용으로 둔다 — shared 패키지 export 표면을 건드리지 않기 위해 앱별 파일):

```ts
export const RECEIPT_LINK_REASON_MESSAGES: Record<string, string> = {
  not_voucher_client: "바우처 이용 산모가 아니어서 영수증 안내를 보낼 수 없습니다.",
  missing_birthday: "산모 생년월일이 등록되지 않았습니다. 산모 정보를 먼저 수정해 주세요.",
  no_contract_document: "연결된 계약서를 찾지 못했습니다.",
  document_not_linked: "계약서에 연결된 산모가 없습니다.",
  document_not_found: "계약서를 찾지 못했습니다.",
  pdf_unavailable: "계약서 PDF를 아직 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.",
  missing_phone: "산모 연락처가 등록되지 않았습니다.",
};
export const RECEIPT_LINK_SEND_FALLBACK_MESSAGE = "영수증 문자 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.";
```

#### Task 3.1: m.admin 공개 영수증 페이지 + BFF
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `mobile/src/app/(public)/receipt/[token]/page.tsx`, `mobile/src/app/api/receipt/[token]/status/route.ts`, `mobile/src/app/api/receipt/[token]/verify/route.ts`, `mobile/src/app/api/receipt/[token]/image/route.ts`, `mobile/src/lib/api/receipt-auth.ts`, `mobile/src/middleware.ts`, `mobile/src/app/api/__tests__/receipt-routes.test.ts`, `mobile/tests/receipt-link-flow.spec.ts`
**Depends:** Task 2.5 (API 계약; 구현은 병렬 가능하나 e2e/수동 확인은 2.5 머지 후)

**Files:**
- Create: `mobile/src/lib/api/receipt-auth.ts`
- Create: `mobile/src/app/api/receipt/[token]/status/route.ts`, `.../verify/route.ts`, `.../image/route.ts`
- Create: `mobile/src/app/(public)/receipt/[token]/page.tsx`
- Modify: `mobile/src/middleware.ts:178-213` (`PUBLIC_ROUTES`에 `"/receipt"`, `PUBLIC_API_ROUTES`에 `"/api/receipt"`)
- Test: `mobile/src/app/api/__tests__/receipt-routes.test.ts` (jest, node env), `mobile/tests/receipt-link-flow.spec.ts` (Playwright)

**Interfaces:**
- Consumes: 백엔드 `GET /receipt-links/:token/status`, `POST /receipt-links/:token/verify`, `GET /receipt-links/:token/image?download=` (Task 2.5).
- Produces (브라우저용): `GET /api/receipt/:token/status` (백엔드 응답 그대로), `POST /api/receipt/:token/verify {birthday}` → 200 `{ ok: true, clientName }` + HttpOnly 쿠키 `receipt_access`(path `/api/receipt/:token`, 30일) / 4xx 백엔드 body 그대로, `GET /api/receipt/:token/image?download=0|1` → PNG 스트림(쿠키 → `Authorization: Bearer`).

- [ ] **Step 1: 실패하는 라우트 테스트**

`mobile/src/app/api/__tests__/receipt-routes.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { POST as verify } from "../receipt/[token]/verify/route";
import { GET as image } from "../receipt/[token]/image/route";
import { GET as status } from "../receipt/[token]/status/route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { get: jest.fn(), post: jest.fn() } }));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const params = { params: Promise.resolve({ token: "efr_t" }) };

describe("receipt BFF routes", () => {
  beforeEach(() => { mockGet.mockReset(); mockPost.mockReset(); });

  it("status proxies the backend payload with no-store", async () => {
    mockGet.mockResolvedValue({ status: 200, data: { ok: true, state: "pending", branchName: "인천 아이미래로", remainingAttempts: 5, lockedUntil: null, expiresAt: "2026-10-03T00:00:00.000Z" } });
    const response = await status(new NextRequest("http://localhost/api/receipt/efr_t/status"), params);
    expect(mockGet).toHaveBeenCalledWith("/receipt-links/efr_t/status");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).branchName).toBe("인천 아이미래로");
  });

  it("verify sets the HttpOnly access cookie and never returns the access token to the browser", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { ok: true, accessToken: "efra_secret", clientName: "김산모" } });
    const request = new NextRequest("http://localhost/api/receipt/efr_t/verify", { method: "POST", body: JSON.stringify({ birthday: "940315" }), headers: { "content-type": "application/json" } });
    const response = await verify(request, params);
    expect(mockPost).toHaveBeenCalledWith("/receipt-links/efr_t/verify", { birthday: "940315" });
    expect(await response.json()).toEqual({ ok: true, clientName: "김산모" });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("receipt_access=efra_secret");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/receipt/efr_t");
  });

  it("verify passes 401/423 bodies through", async () => {
    mockPost.mockResolvedValue({ status: 401, data: { reason: "verification_failed", remainingAttempts: 2 } });
    const request = new NextRequest("http://localhost/api/receipt/efr_t/verify", { method: "POST", body: JSON.stringify({ birthday: "000000" }), headers: { "content-type": "application/json" } });
    const response = await verify(request, params);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ reason: "verification_failed", remainingAttempts: 2 });
  });

  it("image requires the cookie and streams the png with the backend's headers", async () => {
    const denied = await image(new NextRequest("http://localhost/api/receipt/efr_t/image"), params);
    expect(denied.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();

    mockGet.mockResolvedValue({ status: 200, data: Buffer.from("png"), headers: { "content-type": "image/png", "content-disposition": "attachment; filename=\"receipt.png\"" } });
    const request = new NextRequest("http://localhost/api/receipt/efr_t/image?download=1", { headers: { cookie: "receipt_access=efra_secret" } });
    const response = await image(request, params);
    expect(mockGet).toHaveBeenCalledWith("/receipt-links/efr_t/image", expect.objectContaining({ params: { download: "1" }, responseType: "arraybuffer", headers: { Authorization: "Bearer efra_secret" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("png");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./mobile test -- receipt-routes`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 쿠키 헬퍼 + 라우트 구현**

`mobile/src/lib/api/receipt-auth.ts`:

```ts
import type { NextRequest, NextResponse } from "next/server";

import { getServerRuntimeConfig } from "@/lib/env";

export const RECEIPT_ACCESS_COOKIE = "receipt_access";
const RECEIPT_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function receiptApiPath(linkToken: string): string {
    return `/api/receipt/${encodeURIComponent(linkToken)}`;
}

export function getReceiptAuthorization(request: NextRequest): string {
    const authorization = request.headers.get("authorization");
    if (authorization) return authorization;
    const accessToken = request.cookies.get(RECEIPT_ACCESS_COOKIE)?.value;
    return accessToken ? `Bearer ${accessToken}` : "";
}

export function setReceiptAccessCookie(response: NextResponse, linkToken: string, accessToken: string): void {
    response.cookies.set(RECEIPT_ACCESS_COOKIE, accessToken, {
        httpOnly: true,
        maxAge: RECEIPT_COOKIE_MAX_AGE_SECONDS,
        path: receiptApiPath(linkToken),
        sameSite: "lax",
        secure: getServerRuntimeConfig().isProductionNodeEnv,
    });
}
```

`mobile/src/app/api/receipt/[token]/status/route.ts`:

```ts
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";

// Public: is the receipt link still usable? Never returns the client name.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    try {
        const response = await serverAPIClient.get(`/receipt-links/${encodeURIComponent(token)}/status`);
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "receipt link status");
    }
}
```

`mobile/src/app/api/receipt/[token]/verify/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";
import { setReceiptAccessCookie } from "@/lib/api/receipt-auth";

function readVerified(data: unknown): { accessToken: string; clientName: string } | null {
    if (!data || typeof data !== "object") return null;
    const record = data as { ok?: unknown; accessToken?: unknown; clientName?: unknown };
    if (record.ok !== true || typeof record.accessToken !== "string") return null;
    return { accessToken: record.accessToken, clientName: typeof record.clientName === "string" ? record.clientName : "산모" };
}

// Public: birthday challenge. The [token] segment IS the link token.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    try {
        const body = await request.json().catch(() => ({}));
        const response = await serverAPIClient.post(`/receipt-links/${encodeURIComponent(token)}/verify`, {
            birthday: typeof body?.birthday === "string" ? body.birthday : "",
        });
        const verified = readVerified(response.data);
        if (verified) {
            const verifiedResponse = withNoStore(NextResponse.json({ ok: true, clientName: verified.clientName }, { status: 200 }));
            setReceiptAccessCookie(verifiedResponse, token, verified.accessToken);
            return verifiedResponse;
        }
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "verify receipt birthday");
    }
}
```

`mobile/src/app/api/receipt/[token]/image/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, withNoStore } from "@/lib/api/route-utils";
import { getReceiptAuthorization } from "@/lib/api/receipt-auth";

// Public after the birthday challenge: streams the receipt PNG using the HttpOnly cookie.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const authorization = getReceiptAuthorization(request);
    if (!authorization) {
        return withNoStore(NextResponse.json({ reason: "access_required" }, { status: 401 }));
    }
    const download = request.nextUrl.searchParams.get("download") === "1" ? "1" : "0";
    try {
        const response = await serverAPIClient.get(`/receipt-links/${encodeURIComponent(token)}/image`, {
            params: { download },
            responseType: "arraybuffer",
            headers: { Authorization: authorization },
        });
        if (response.status >= 400) {
            return withNoStore(NextResponse.json({ reason: "access_required" }, { status: response.status }));
        }
        const headers = new Headers({
            "Content-Type": String(response.headers?.["content-type"] ?? "image/png"),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        });
        const disposition = response.headers?.["content-disposition"];
        if (disposition) headers.set("Content-Disposition", String(disposition));
        return new NextResponse(Buffer.from(response.data as ArrayBuffer), { status: 200, headers });
    } catch (error) {
        return errorResponse(error, "receipt image");
    }
}
```
`errorResponse`가 axios 4xx의 body(`reason`, `remainingAttempts`, `lockedUntil`)를 그대로 돌려주지 않으면(`route-utils.ts`의 구현을 확인), verify 라우트의 catch에서 `error.response?.data`와 `status`를 그대로 `NextResponse.json`으로 돌려준다 — 화면이 남은 횟수/잠금 시각을 보여줘야 한다.

`mobile/src/middleware.ts`: `PUBLIC_ROUTES` 배열에 `"/receipt"`, `PUBLIC_API_ROUTES`에 `"/api/receipt"` 추가(기존 `/service-record` 항목 옆). 매칭이 prefix 방식이 아니라 정확 일치라면 `/service-record`가 어떻게 `[token]` 하위 경로를 통과시키는지 그대로 따른다.

- [ ] **Step 4: 라우트 테스트 통과**

Run: `pnpm --filter ./mobile test -- receipt-routes`
Expected: PASS (4 tests).

- [ ] **Step 5: 공개 페이지 구현 (목업 문구 고정)**

`mobile/src/app/(public)/receipt/[token]/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Status = {
    ok: true;
    state: "pending" | "verified";
    branchName: string;
    expiresAt: string;
    remainingAttempts: number;
    lockedUntil: string | null;
};

type Screen =
    | { kind: "loading" }
    | { kind: "verify"; branchName: string; remainingAttempts: number; error: string | null }
    | { kind: "locked"; branchName: string; lockedUntil: string }
    | { kind: "expired" }
    | { kind: "invalid" }
    | { kind: "image"; branchName: string; clientName: string };

const BRANCH_FALLBACK = "인천 아이미래로";
const FOOTER = "이 링크는 발송일로부터 30일간 유효합니다.";
const MAX_ATTEMPTS = 5;

function formatLockedUntil(iso: string): string {
    const date = new Date(iso);
    return `${date.getHours()}시 ${String(date.getMinutes()).padStart(2, "0")}분`;
}

export default function ReceiptLinkPage() {
    const params = useParams<{ token: string }>();
    const token = params.token;
    const api = useCallback((path: string) => `/api/receipt/${encodeURIComponent(token)}${path}`, [token]);

    const [screen, setScreen] = useState<Screen>({ kind: "loading" });
    const [birthday, setBirthday] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch(api("/status"), { cache: "no-store" });
                if (cancelled) return;
                if (response.status === 410) return setScreen({ kind: "expired" });
                if (!response.ok) return setScreen({ kind: "invalid" });
                const status = (await response.json()) as Status;
                const branchName = status.branchName || BRANCH_FALLBACK;
                if (status.lockedUntil) return setScreen({ kind: "locked", branchName, lockedUntil: status.lockedUntil });
                setScreen({ kind: "verify", branchName, remainingAttempts: status.remainingAttempts, error: null });
            } catch {
                if (!cancelled) setScreen({ kind: "invalid" });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [api]);

    const submit = async () => {
        if (screen.kind !== "verify" || isSubmitting) return;
        const digits = birthday.replace(/\D/g, "");
        if (digits.length !== 6 && digits.length !== 8) {
            setScreen({ ...screen, error: "생년월일 6자리(YYMMDD)를 입력해 주세요." });
            return;
        }
        setIsSubmitting(true);
        try {
            const response = await fetch(api("/verify"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ birthday: digits }),
            });
            const body = (await response.json().catch(() => ({}))) as { clientName?: string; reason?: string; remainingAttempts?: number; lockedUntil?: string };
            if (response.ok) {
                setScreen({ kind: "image", branchName: screen.branchName, clientName: body.clientName || "산모" });
                return;
            }
            if (response.status === 423 && body.lockedUntil) {
                setScreen({ kind: "locked", branchName: screen.branchName, lockedUntil: body.lockedUntil });
                return;
            }
            if (response.status === 410) return setScreen({ kind: "expired" });
            if (response.status === 401) {
                const remaining = body.remainingAttempts ?? Math.max(0, screen.remainingAttempts - 1);
                setScreen({ kind: "verify", branchName: screen.branchName, remainingAttempts: remaining, error: `생년월일이 일치하지 않습니다. 남은 횟수 ${remaining}회` });
                return;
            }
            setScreen({ ...screen, error: "확인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." });
        } catch {
            setScreen({ ...screen, error: "네트워크 연결을 확인해 주세요." });
        } finally {
            setIsSubmitting(false);
        }
    };

    const stepLabel = screen.kind === "image" ? "2단계 · 영수증 저장" : "1단계 · 본인 확인";
    const progress = screen.kind === "image" ? 100 : 50;
    const branchName = "branchName" in screen ? screen.branchName : BRANCH_FALLBACK;

    return (
        <main className="rcpt" data-component="mobile_receipt_public-page">
            <header className="rcpt-head">
                <p className="rcpt-eyebrow">{branchName}</p>
                <h1>본인부담금 영수증</h1>
                {screen.kind !== "expired" && screen.kind !== "invalid" ? (
                    <>
                        <p className="rcpt-step">{stepLabel}</p>
                        <div className="rcpt-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
                    </>
                ) : null}
            </header>

            {screen.kind === "loading" ? <p className="rcpt-muted">확인 중입니다…</p> : null}

            {screen.kind === "verify" || screen.kind === "locked" ? (
                <section className="rcpt-card" data-component="mobile_receipt_public-page_verify">
                    <h2>산모님 본인 확인</h2>
                    <p className="rcpt-desc">본인부담금 영수증은 산모님 본인만 열람하실 수 있습니다. 계약 시 등록하신 생년월일을 입력해 주세요.</p>
                    <label className="rcpt-label" htmlFor="receipt-birthday">산모 생년월일</label>
                    <input
                        id="receipt-birthday"
                        className="rcpt-input"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="예) 940315"
                        maxLength={8}
                        value={birthday}
                        disabled={screen.kind === "locked" || isSubmitting}
                        onChange={(event) => setBirthday(event.target.value.replace(/\D/g, ""))}
                        onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
                    />
                    <p className="rcpt-helper">주민등록번호 앞 6자리</p>
                    {screen.kind === "verify" && screen.error ? <p className="rcpt-err" role="alert">{screen.error}</p> : null}
                    {screen.kind === "locked" ? (
                        <p className="rcpt-err" role="alert">5회 연속 틀려 {formatLockedUntil(screen.lockedUntil)}까지 확인이 잠겼습니다.</p>
                    ) : null}
                    <button
                        type="button"
                        className="rcpt-btn"
                        data-component="mobile_receipt_public-page_verify_submit"
                        disabled={screen.kind === "locked" || isSubmitting}
                        onClick={() => void submit()}
                    >
                        {screen.kind === "verify" && screen.remainingAttempts < MAX_ATTEMPTS ? "다시 확인하기" : "확인하기"}
                    </button>
                    {screen.kind === "verify" && screen.remainingAttempts < MAX_ATTEMPTS ? (
                        <p className="rcpt-warn">5회 연속 틀리면 30분 동안 확인이 잠깁니다. 계약서에 적힌 산모님 생년월일과 같은지 확인해 주세요.</p>
                    ) : (
                        <p className="rcpt-info">입력하신 생년월일은 본인 확인에만 사용되며 저장되지 않습니다. 확인 후 영수증 이미지를 바로 내려받으실 수 있습니다.</p>
                    )}
                </section>
            ) : null}

            {screen.kind === "image" ? (
                <section className="rcpt-card" data-component="mobile_receipt_public-page_image">
                    <div className="rcpt-titlerow">
                        <h2>{screen.clientName} 산모님 영수증</h2>
                        <span className="rcpt-chip">확인 완료</span>
                    </div>
                    <img className="rcpt-img" src={api("/image")} alt={`${screen.clientName} 산모님 본인부담금 영수증`} />
                    <a className="rcpt-btn" href={api("/image?download=1")} download data-component="mobile_receipt_public-page_image_save">이미지 저장</a>
                </section>
            ) : null}

            {screen.kind === "expired" ? (
                <section className="rcpt-card" data-component="mobile_receipt_public-page_expired">
                    <h2>링크 유효기간이 지났습니다</h2>
                    <p className="rcpt-desc">영수증 링크는 문자 발송일로부터 30일간 열어보실 수 있습니다. 영수증이 다시 필요하시면 인천 아이미래로에 연락 주세요.</p>
                </section>
            ) : null}

            {screen.kind === "invalid" ? (
                <section className="rcpt-card" data-component="mobile_receipt_public-page_invalid">
                    <h2>사용할 수 없는 링크입니다</h2>
                    <p className="rcpt-desc">문자에 있는 링크를 다시 눌러 주세요. 계속 열리지 않으면 인천 아이미래로에 연락 주세요.</p>
                </section>
            ) : null}

            <footer className="rcpt-foot">{FOOTER}</footer>

            <style jsx global>{`
                .rcpt { --primary:#004aad; --ink:#1c2430; --muted:#7c8798; --line:#e4e8ef; --soft:#f3f6fb; --err:#c2456e;
                        max-width:480px; margin:0 auto; padding:24px 20px 40px; color:var(--ink); font-size:15px; line-height:1.55; }
                .rcpt-head h1 { margin:4px 0 12px; font-size:22px; font-weight:800; }
                .rcpt-eyebrow { margin:0; color:var(--muted); font-size:13px; }
                .rcpt-step { margin:0 0 6px; font-size:13px; font-weight:700; color:var(--primary); }
                .rcpt-progress { height:4px; border-radius:2px; background:var(--line); overflow:hidden; margin-bottom:20px; }
                .rcpt-progress span { display:block; height:100%; background:var(--primary); }
                .rcpt-card { background:#fff; border:1px solid var(--line); border-radius:16px; padding:20px; }
                .rcpt-card h2 { margin:0 0 8px; font-size:18px; font-weight:800; }
                .rcpt-desc { margin:0 0 16px; color:var(--muted); }
                .rcpt-label { display:block; margin-bottom:6px; font-size:13px; font-weight:700; }
                .rcpt-input { width:100%; box-sizing:border-box; border:1.5px solid var(--line); border-radius:12px; padding:13px 14px; font-size:18px; letter-spacing:.08em; }
                .rcpt-input:focus { outline:2px solid var(--primary); outline-offset:1px; }
                .rcpt-helper { margin:6px 0 0; color:var(--muted); font-size:13px; }
                .rcpt-err { margin:10px 0 0; color:var(--err); font-weight:700; }
                .rcpt-btn { display:block; width:100%; box-sizing:border-box; margin-top:16px; border:0; border-radius:12px; padding:14px 16px;
                            background:var(--primary); color:#fff; font-size:15px; font-weight:700; text-align:center; text-decoration:none; }
                .rcpt-btn:disabled { opacity:.5; }
                .rcpt-info, .rcpt-warn { margin:14px 0 0; padding:12px 14px; border-radius:12px; background:var(--soft); font-size:13px; color:var(--muted); }
                .rcpt-warn { color:var(--err); background:#fdf1f5; }
                .rcpt-titlerow { display:flex; align-items:center; justify-content:space-between; gap:8px; }
                .rcpt-chip { padding:4px 10px; border-radius:999px; background:#e6f4ea; color:#1f7a3f; font-size:12px; font-weight:700; }
                .rcpt-img { display:block; width:100%; margin-top:12px; border:1px solid var(--line); border-radius:12px; }
                .rcpt-foot { margin-top:24px; color:var(--muted); font-size:12px; text-align:center; }
                .rcpt-muted { color:var(--muted); }
            `}</style>
        </main>
    );
}
```
문구는 스펙 §5.6 그대로다. 확인 전에는 이름을 노출하지 않고(헤더는 지점명+"본인부담금 영수증"), 어느 화면에도 전화번호를 넣지 않는다. `styled-jsx`(`<style jsx global>`)가 프로젝트에서 안 쓰이면 `service-record/[token]/page.tsx`가 스타일을 두는 방식(1156행 이후 `.srec` 블록)을 그대로 따라 `.rcpt` 블록을 둔다.

- [ ] **Step 6: Playwright 흐름 테스트**

`mobile/tests/receipt-link-flow.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const TOKEN = "efr_test";
const STATUS = { ok: true, state: "pending", branchName: "인천 아이미래로", expiresAt: "2026-10-03T00:00:00.000Z", remainingAttempts: 5, lockedUntil: null };

test("mother verifies her birthday and reaches the receipt image", async ({ page }) => {
  let attempts = 0;
  await page.route(`**/api/receipt/${TOKEN}/status`, (route) => route.fulfill({ json: STATUS }));
  await page.route(`**/api/receipt/${TOKEN}/verify`, (route) => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 401, json: { reason: "verification_failed", remainingAttempts: 4 } });
    return route.fulfill({ json: { ok: true, clientName: "김산모" } });
  });
  await page.route(`**/api/receipt/${TOKEN}/image*`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex") }),
  );

  await page.goto(`/receipt/${TOKEN}`);
  await expect(page.getByRole("heading", { name: "본인부담금 영수증" })).toBeVisible();
  await expect(page.getByText("인천 아이미래로")).toBeVisible();
  await expect(page.getByText("김산모")).toHaveCount(0);

  await page.getByLabel("산모 생년월일").fill("000000");
  await page.getByRole("button", { name: "확인하기" }).click();
  await expect(page.getByRole("alert")).toHaveText("생년월일이 일치하지 않습니다. 남은 횟수 4회");
  await expect(page.getByText("5회 연속 틀리면 30분 동안 확인이 잠깁니다", { exact: false })).toBeVisible();

  await page.getByLabel("산모 생년월일").fill("940315");
  await page.getByRole("button", { name: "다시 확인하기" }).click();
  await expect(page.getByRole("heading", { name: "김산모 산모님 영수증" })).toBeVisible();
  await expect(page.getByText("확인 완료")).toBeVisible();
  await expect(page.getByRole("link", { name: "이미지 저장" })).toHaveAttribute("href", `/api/receipt/${TOKEN}/image?download=1`);
  await expect(page.getByText("이 링크는 발송일로부터 30일간 유효합니다.")).toBeVisible();
});

test("expired links show the expiry screen without a phone number", async ({ page }) => {
  await page.route(`**/api/receipt/${TOKEN}/status`, (route) => route.fulfill({ status: 410, json: { reason: "expired" } }));
  await page.goto(`/receipt/${TOKEN}`);
  await expect(page.getByRole("heading", { name: "링크 유효기간이 지났습니다" })).toBeVisible();
  await expect(page.getByText(/010-\d{4}-\d{4}/)).toHaveCount(0);
});

test("a locked link disables the form", async ({ page }) => {
  await page.route(`**/api/receipt/${TOKEN}/status`, (route) => route.fulfill({ json: { ...STATUS, remainingAttempts: 0, lockedUntil: "2026-09-03T01:00:00.000Z" } }));
  await page.goto(`/receipt/${TOKEN}`);
  await expect(page.getByRole("button", { name: "확인하기" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("확인이 잠겼습니다");
});
```

Run: `pnpm --filter ./mobile exec playwright test tests/receipt-link-flow.spec.ts`
Expected: 3 passed (기존 `mobile/playwright.config.ts`의 webServer 설정으로 dev 서버가 뜬다; 미들웨어가 `/receipt`를 공개 경로로 두지 않으면 로그인으로 리다이렉트되어 첫 테스트가 실패한다 — 그게 Step 3의 미들웨어 수정 검증이다).

- [ ] **Step 7: 타입/린트 + 커밋**

Run: `pnpm --filter ./mobile run type-check && pnpm --filter ./mobile run lint`
Expected: exit 0.

```bash
git add "mobile/src/app/(public)/receipt" mobile/src/app/api/receipt mobile/src/lib/api/receipt-auth.ts mobile/src/middleware.ts mobile/src/app/api/__tests__/receipt-routes.test.ts mobile/tests/receipt-link-flow.spec.ts
git commit -m "feat(mobile): public receipt page with birthday verification and image download"
```

#### Task 3.2: admin 데스크톱 수동 발송
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `frontend/src/services/api.ts`, `frontend/src/app/api/receipt-links/send/route.ts`, `frontend/src/lib/receipt-link.ts`, `frontend/src/components/app/documents/shared-document-preview-dialog.tsx`, `frontend/src/components/app/contracts/ContractDocumentPreviewModal.tsx`, `frontend/src/app/(protected)/contracts/page.tsx`, `frontend/src/components/app/contracts/__tests__/ContractDocumentPreviewModal.test.tsx`
**Depends:** Task 2.6 (API 계약)

**Files:**
- Create: `frontend/src/app/api/receipt-links/send/route.ts`, `frontend/src/lib/receipt-link.ts`
- Modify: `frontend/src/services/api.ts:242-243` 근처(`eformsignApi`), `shared-document-preview-dialog.tsx:30-52, 608-620`, `ContractDocumentPreviewModal.tsx:20-30, 91-94`, `frontend/src/app/(protected)/contracts/page.tsx:2244-2260`
- Test: `frontend/src/components/app/contracts/__tests__/ContractDocumentPreviewModal.test.tsx`

**Interfaces:**
- Consumes: `POST /receipt-links/send { documentId }` (Task 2.6).
- Produces: `eformsignApi.sendReceiptLink(documentId): Promise<{ jobId: string; scheduledFor: string; clientName: string }>`; `SharedDocumentPreviewDialog` prop `receiptSendAction?: ReactNode`; `ContractDocumentPreviewModal` props `onSendReceiptLink?: () => void; isSendingReceiptLink?: boolean`; 버튼 `data-component` = `${dataComponent}_footer_file-actions_receipt-send`.

- [ ] **Step 1: 실패하는 컴포넌트 테스트**

`frontend/src/components/app/contracts/__tests__/ContractDocumentPreviewModal.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { ContractDocumentPreviewModal } from "../ContractDocumentPreviewModal";

jest.mock("@/services/api", () => ({ eformsignApi: { getDocumentReceiptDownloadUrl: (id: string) => `/api/receipt/${id}` } }));

const document = {
  id: "doc-1",
  document_name: "산후관리 계약서",
  document_number: "C-1",
  created_date: 1756800000000,
  template: { name: "계약서" },
} as never;

describe("ContractDocumentPreviewModal receipt send action", () => {
  it("renders the send button and calls the handler", () => {
    const onSendReceiptLink = jest.fn();
    render(<ContractDocumentPreviewModal data-component="desktop_contracts_preview" document={document} open onClose={() => {}} onSendReceiptLink={onSendReceiptLink} />);
    const button = screen.getByRole("button", { name: "영수증 문자 발송" });
    expect(button).toHaveAttribute("data-component", "desktop_contracts_preview_footer_file-actions_receipt-send");
    fireEvent.click(button);
    expect(onSendReceiptLink).toHaveBeenCalledTimes(1);
  });

  it("hides the button without a handler and disables it while sending", () => {
    const { rerender } = render(<ContractDocumentPreviewModal data-component="desktop_contracts_preview" document={document} open onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "영수증 문자 발송" })).toBeNull();
    rerender(<ContractDocumentPreviewModal data-component="desktop_contracts_preview" document={document} open onClose={() => {}} onSendReceiptLink={() => {}} isSendingReceiptLink />);
    expect(screen.getByRole("button", { name: /영수증 문자 발송/ })).toBeDisabled();
  });
});
```
(`ContractDocumentPreviewModal`의 필수 props가 위와 다르면 `frontend/src/components/app/contracts/ContractDocumentPreviewModal.tsx:15-30`의 실제 props 이름으로 맞춘다. PDF iframe 등 브라우저 전용 요소가 jsdom에서 문제를 일으키면 `shared-document-preview-dialog`의 미리보기 영역만 `jest.mock`으로 빈 컴포넌트로 대체한다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./frontend test -- ContractDocumentPreviewModal`
Expected: FAIL (버튼 없음 / prop 타입 오류).

- [ ] **Step 3: api 클라이언트 + BFF + 사유 맵**

`frontend/src/services/api.ts` `eformsignApi`에 (`getDocumentReceiptDownloadUrl` 아래):

```ts
    // Queues a "서비스 종료 안내" SMS carrying a fresh receipt link for the document's client.
    sendReceiptLink: async (documentId: string) => {
        const { data } = await api.post(`/receipt-links/send`, { documentId });
        return data as { jobId: string; scheduledFor: string; clientName: string };
    },
```

`frontend/src/app/api/receipt-links/send/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken, unauthorizedResponse } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Authentication required. Please log in.");
    }
    const body = await request.json();
    const response = await serverAPIClient.post("/receipt-links/send", { documentId: body?.documentId }, {
      headers: getAuthHeaders(token),
    });
    // 4xx bodies carry { reason } that the UI maps to a message — pass them through untouched.
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "send receipt link");
  }
}
```

`frontend/src/lib/receipt-link.ts`: Phase 3 서두의 `RECEIPT_LINK_REASON_MESSAGES` / `RECEIPT_LINK_SEND_FALLBACK_MESSAGE` 그대로 + 헬퍼:

```ts
export function describeReceiptLinkError(error: unknown): string {
  const reason = (error as { response?: { data?: { reason?: string } } })?.response?.data?.reason;
  return (reason && RECEIPT_LINK_REASON_MESSAGES[reason]) || RECEIPT_LINK_SEND_FALLBACK_MESSAGE;
}
```

- [ ] **Step 4: 다이얼로그/모달 버튼**

`shared-document-preview-dialog.tsx`: props에 `receiptSendAction?: ReactNode;` 추가(`receiptDownloadFileName` 아래), 구조분해에 추가, 그리고 file-actions 배열에서 `receiptDownloadUrl ? (<Button key="receipt" …>) : null` 바로 다음 원소로 `receiptSendAction ?? null`을 넣는다(배열 원소이므로 `key`가 필요하면 `<Fragment key="receipt-send">{receiptSendAction}</Fragment>`).

`ContractDocumentPreviewModal.tsx`: props에 `onSendReceiptLink?: () => void; isSendingReceiptLink?: boolean;` 추가하고 `SharedDocumentPreviewDialog`에 전달:

```tsx
      receiptSendAction={onSendReceiptLink ? (
        <Button
          key="receipt-send"
          variant="positive-outline"
          size="sm"
          data-component={`${dataComponent}_footer_file-actions_receipt-send`}
          onClick={onSendReceiptLink}
          disabled={isSendingReceiptLink}
          className="min-w-[88px] border-v3-primary"
        >
          {isSendingReceiptLink ? <Spinner className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
          영수증 문자 발송
        </Button>
      ) : undefined}
```
(`Send`는 `lucide-react`.) 영수증 다운로드(`canDownloadReceipt`)와 달리 이 버튼은 계약 완료 여부와 무관하게 노출한다 — 대상 검증은 백엔드 preflight가 한다.

- [ ] **Step 5: 계약 페이지 확인 다이얼로그 + 발송**

`frontend/src/app/(protected)/contracts/page.tsx`의 `ContractDocumentPreviewModal` 사용부(2244행~)를 감싸는 컴포넌트에 추가:

```tsx
const [receiptSendTarget, setReceiptSendTarget] = useState<{ id: string; customerName: string } | null>(null);
const sendReceiptLink = useMutation({
  mutationFn: (documentId: string) => eformsignApi.sendReceiptLink(documentId),
  onSuccess: (result) => {
    setReceiptSendTarget(null);
    toast({ title: "서비스 종료 안내 발송 예약", description: `${result.clientName} 산모님께 1분 내 발송됩니다. 링크는 30일간 유효합니다.` });
  },
  onError: (error) => {
    toast({ title: "영수증 문자를 보내지 못했습니다", description: describeReceiptLinkError(error), variant: "destructive" });
  },
});
```
모달에 `onSendReceiptLink={() => setReceiptSendTarget({ id: previewDocument.id, customerName: previewCustomerName ?? "" })}` 와 `isSendingReceiptLink={sendReceiptLink.isPending}` 전달(변수명은 그 스코프의 실제 이름). 확인 다이얼로그(`@/components/ui/dialog`):

```tsx
<Dialog open={receiptSendTarget !== null} onOpenChange={(open) => { if (!open && !sendReceiptLink.isPending) setReceiptSendTarget(null); }}>
  <DialogContent data-component="desktop_contracts_dialogs_receipt-send-confirm">
    <DialogHeader>
      <DialogTitle>서비스 종료 안내 문자를 보낼까요?</DialogTitle>
      <DialogDescription>
        {receiptSendTarget?.customerName ? `${receiptSendTarget.customerName} 산모님께 ` : ""}본인부담금 영수증 링크가 담긴 문자를 1분 내 발송합니다. 링크는 30일간 유효하며, 산모님이 생년월일로 본인 확인 후 열람합니다.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => setReceiptSendTarget(null)} disabled={sendReceiptLink.isPending}>취소</Button>
      <Button variant="positive" onClick={() => receiptSendTarget && sendReceiptLink.mutate(receiptSendTarget.id)} disabled={sendReceiptLink.isPending}
        data-component="desktop_contracts_dialogs_receipt-send-confirm_submit">
        {sendReceiptLink.isPending ? "발송 예약 중…" : "발송하기"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```
`useMutation`은 이 페이지가 이미 쓰는 `@tanstack/react-query` import를 재사용한다.

- [ ] **Step 6: 테스트/타입/린트**

Run: `pnpm --filter ./frontend test -- ContractDocumentPreviewModal && pnpm --filter ./frontend run type-check && pnpm --filter ./frontend run lint`
Expected: PASS / exit 0.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/services/api.ts frontend/src/app/api/receipt-links frontend/src/lib/receipt-link.ts frontend/src/components/app/documents/shared-document-preview-dialog.tsx frontend/src/components/app/contracts/ContractDocumentPreviewModal.tsx "frontend/src/app/(protected)/contracts/page.tsx" frontend/src/components/app/contracts/__tests__/ContractDocumentPreviewModal.test.tsx
git commit -m "feat(admin): send service-end receipt link sms from the contract preview"
```

#### Task 3.3: m.admin 셸 수동 발송
**Tier:** standard
**Sandbox:** local
**Agent:** worker
**Model:** claude-sonnet-5
**Effort:** max
**Paths:** `mobile/src/services/api.ts`, `mobile/src/app/api/receipt-links/send/route.ts`, `mobile/src/lib/receipt-link.ts`, `mobile/src/app/(shell)/contracts/page.tsx`, `mobile/src/app/api/__tests__/receipt-links-send.route.test.ts`
**Depends:** Task 2.6 (API 계약)

**Files:**
- Create: `mobile/src/app/api/receipt-links/send/route.ts`, `mobile/src/lib/receipt-link.ts`
- Modify: `mobile/src/services/api.ts:452-458` 근처(`eformsignApi`), `mobile/src/app/(shell)/contracts/page.tsx:1225-1250 (state), 1297-1345 (handlers), 1405-1450 (actions)`
- Test: `mobile/src/app/api/__tests__/receipt-links-send.route.test.ts`

**Interfaces:**
- Consumes: `POST /receipt-links/send` (2.6), `ApprovalTwoButtonModal`(`@/components/app/ui/ApprovalTwoButtonModal`), `MobileDetailActions` 액션 항목 `{ label, variant, onClick, disabled?, busy?, dataComponent }`.
- Produces: `eformsignApi.sendReceiptLink(documentId)`; 액션 `data-component` `mobile_contracts_detail-sheet_stack_detail-page_actions_receipt-send`; 확인 모달 `mobile_contracts_detail-sheet_stack_detail-page_dialogs_receipt-send-confirm`.

- [ ] **Step 1: 실패하는 라우트 테스트**

`mobile/src/app/api/__tests__/receipt-links-send.route.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { POST } from "../receipt-links/send/route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
const mockPost = serverAPIClient.post as jest.Mock;

function request(body: unknown, cookie = "auth_token=auth-token") {
  return new NextRequest("http://localhost/api/receipt-links/send", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", cookie } });
}

describe("POST /api/receipt-links/send", () => {
  beforeEach(() => mockPost.mockReset());

  it("401s without an auth cookie and 400s without a documentId", async () => {
    expect((await POST(request({ documentId: "d" }, ""))).status).toBe(401);
    expect((await POST(request({}))).status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards the send and returns the backend body", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { jobId: "job-1", scheduledFor: "2026-09-03T00:00:00.000Z", clientName: "김산모" } });
    const response = await POST(request({ documentId: "doc-1" }));
    expect(mockPost).toHaveBeenCalledWith("/receipt-links/send", { documentId: "doc-1" }, expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer auth-token" }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).clientName).toBe("김산모");
  });

  it("passes 4xx reason bodies through", async () => {
    mockPost.mockRejectedValue({ response: { status: 400, data: { reason: "not_voucher_client", message: "바우처 이용 산모가 아닙니다" } } });
    const response = await POST(request({ documentId: "doc-1" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ reason: "not_voucher_client", message: "바우처 이용 산모가 아닙니다" });
  });
});
```
(`getAuthHeaders(token)`이 만드는 헤더 키가 `Authorization`이 아니면 그 이름으로 단언한다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter ./mobile test -- receipt-links-send`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: BFF + api 클라이언트 + 사유 맵**

`mobile/src/app/api/receipt-links/send/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { getAuthHeaders, getAuthToken, getUpstreamErrorStatus, logUpstreamError, parseBody } from "@/lib/api/route-utils";

const sendReceiptLinkSchema = z.object({ documentId: z.string().min(1) });

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data, response: invalidBody } = await parseBody(sendReceiptLinkSchema, request);
    if (invalidBody) {
      return invalidBody;
    }
    const response = await serverAPIClient.post("/receipt-links/send", data, { headers: getAuthHeaders(token) });
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    const upstream = (error as { response?: { status?: number; data?: unknown } })?.response;
    logUpstreamError("API send receipt link", error);
    if (upstream && upstream.status && upstream.status < 500) {
      // { reason, message } from the backend preflight — the UI maps reason to copy.
      return NextResponse.json(upstream.data ?? { error: "Failed to send receipt link" }, { status: getUpstreamErrorStatus(error) });
    }
    return NextResponse.json({ error: "Failed to send receipt link" }, { status: 500 });
  }
}
```

`mobile/src/services/api.ts` `eformsignApi`에 (`getDocumentReceiptDownloadUrl` 아래):

```ts
    sendReceiptLink: async (documentId: string): Promise<{ jobId: string; scheduledFor: string; clientName: string }> => {
        const { data } = await api.post('/receipt-links/send', { documentId });
        return data;
    },
```

`mobile/src/lib/receipt-link.ts`: Phase 3 서두의 맵 + `describeReceiptLinkError` (frontend와 동일 코드).

- [ ] **Step 4: 계약 상세 액션 + 확인 모달**

`mobile/src/app/(shell)/contracts/page.tsx` 상세 컴포넌트(1225행 `useToast` 있는 스코프)에 상태와 핸들러 추가:

```tsx
  const [isReceiptSendConfirmOpen, setIsReceiptSendConfirmOpen] = useState(false);
  const [isSendingReceiptLink, setIsSendingReceiptLink] = useState(false);

  const handleSendReceiptLink = async () => {
    setIsSendingReceiptLink(true);
    try {
      const result = await eformsignApi.sendReceiptLink(doc.id);
      setIsReceiptSendConfirmOpen(false);
      toast({ title: "서비스 종료 안내 발송 예약", description: `${result.clientName} 산모님께 1분 내 발송됩니다. 링크는 30일간 유효합니다.` });
    } catch (error) {
      toast({ title: "영수증 문자를 보내지 못했습니다", description: describeReceiptLinkError(error), variant: "destructive" });
    } finally {
      setIsSendingReceiptLink(false);
    }
  };
```

`MobileDetailActions`의 `actions` 배열에서 `!isPreviewOpen` 분기 안, "미리보기" 항목 바로 다음에(재알림/영수증 공유 항목 앞) 추가:

```tsx
                  {
                    label: "영수증 문자",
                    variant: "secondary" as const,
                    onClick: () => setIsReceiptSendConfirmOpen(true),
                    disabled: isSendingReceiptLink,
                    dataComponent: "mobile_contracts_detail-sheet_stack_detail-page_actions_receipt-send",
                  },
```

컴포넌트 JSX 끝(`MobileDetailActions` 블록 뒤)에 모달:

```tsx
      <ApprovalTwoButtonModal
        data-component="mobile_contracts_detail-sheet_stack_detail-page_dialogs_receipt-send-confirm"
        open={isReceiptSendConfirmOpen}
        onOpenChange={(open) => { if (!isSendingReceiptLink) setIsReceiptSendConfirmOpen(open); }}
        title="서비스 종료 안내 문자를 보낼까요?"
        description={`${resolvedCustomerName ? `${resolvedCustomerName} 산모님께 ` : ""}본인부담금 영수증 링크가 담긴 문자를 1분 내 발송합니다. 링크는 30일간 유효하며, 산모님이 생년월일로 본인 확인 후 열람합니다.`}
        approvalLabel="발송하기"
        pendingLabel="발송 예약 중"
        onApprove={handleSendReceiptLink}
        isPending={isSendingReceiptLink}
        approvalVariant="positive"
        size="compact"
      />
```
`ApprovalTwoButtonModal` props 이름은 `mobile/src/components/app/ui/ApprovalTwoButtonModal.tsx`의 실제 정의(`open, onOpenChange, title, description, cancelLabel, approvalLabel, pendingLabel, onApprove, isPending, approvalDisabled, approvalVariant, isDescriptionVisuallyHidden, size`)와 맞춘다. 문서에 연결된 산모가 없으면 백엔드가 `document_not_linked`로 거절하고 토스트가 그 사유를 보여준다.

- [ ] **Step 5: 테스트/타입/린트**

Run: `pnpm --filter ./mobile test -- receipt-links-send contracts && pnpm --filter ./mobile run type-check && pnpm --filter ./mobile run lint`
Expected: PASS / exit 0 (기존 contracts 페이지 테스트가 있으면 함께 통과).

- [ ] **Step 6: 커밋**

```bash
git add mobile/src/services/api.ts mobile/src/app/api/receipt-links mobile/src/lib/receipt-link.ts "mobile/src/app/(shell)/contracts/page.tsx" mobile/src/app/api/__tests__/receipt-links-send.route.test.ts
git commit -m "feat(mobile): send service-end receipt link sms from the contract detail"
```

---
## Phase 4 — 통합 검증 · 배포 준비 · 감사

한 줄 요약: 세 앱의 게이트를 전부 돌리고, Lightsail 이미지에서 네이티브 캔버스가 실제로 로드되는지 확인한 뒤, 두 축으로 나눈 phase-auditor 감사를 거쳐 dev 병합을 제안한다.

**Sequential:**
- **통합 게이트 + 컨테이너 스모크** (verify, medium) — main loop.
- **Phase 감사 ×2** (review, medium) — phase-auditor(opus @ max) 두 개 병렬: 백엔드 축 / 클라이언트 축.
- **dev 병합 제안** (release, low) — 사용자 승인 후.

#### Task 4.1: 통합 게이트 + 컨테이너 스모크
**Tier:** heavy
**Sandbox:** network
**Agent:** main
**Model:** claude-fable-5-1
**Effort:** high
**Paths:** (읽기/실행만; 수정은 발견된 결함의 최소 수정에 한함)
**Depends:** Task 3.1, Task 3.2, Task 3.3

- [ ] **Step 1: 전체 게이트**

Run (통합 워크트리 `service-end-receipt-link`에서):
```bash
pnpm install --frozen-lockfile
pnpm --filter @babyjamjam/shared run build:backend-runtime
git diff --exit-code -- backend/vendor/shared-agent/agent   # CI와 동일: vendored 복사본이 바뀌면 안 된다
pnpm --filter ./backend run type-check && pnpm --filter ./backend run lint && pnpm --filter ./backend test
pnpm --filter ./backend build && pnpm --filter ./backend run verify:pdf-rasterizer
pnpm --filter ./frontend run type-check && pnpm --filter ./frontend run lint && pnpm --filter ./frontend test
pnpm --filter ./mobile run type-check && pnpm --filter ./mobile run lint && pnpm --filter ./mobile test
pnpm --filter ./mobile exec playwright test tests/receipt-link-flow.spec.ts
~/.agents/bin/env-check
```
Expected: 전부 exit 0. `git diff` 단계가 실패하면 shared 메시지 타입 변경이 vendored agent 번들에 새어 들어간 것이므로 `packages/shared`의 backend-runtime 빌드 대상에서 메시지 타입이 제외돼 있는지 확인한다(현재 `agent/`, `utils/`만 포함).

- [ ] **Step 2: Lightsail 이미지에서 네이티브 모듈 확인**

Run:
```bash
docker build -f backend/Dockerfile.lightsail -t bjj-backend-receipt-smoke .
docker run --rm bjj-backend-receipt-smoke node -e "require('@napi-rs/canvas'); console.log('napi-canvas ok')"
docker run --rm -w /app/backend bjj-backend-receipt-smoke node scripts/verify-pdf-rasterizer.mjs
```
Expected: `napi-canvas ok`, `pdf rasterizer ok: … bytes`. 실패(`.node` 바이너리 없음)하면 `@napi-rs/canvas-linux-x64-gnu`가 optionalDependencies로 설치되지 않은 것이다 — `Dockerfile.lightsail`의 `pnpm install --frozen-lockfile --filter ./backend...` 단계 앞에 `ENV npm_config_optional=true`가 필요한지 확인하고, 그래도 안 되면 `backend/package.json` dependencies에 `@napi-rs/canvas-linux-x64-gnu@0.1.100`을 명시 추가한다(lockfile 갱신 후 커밋). `scripts/` 폴더가 runtime 이미지에 복사되지 않으면 Dockerfile `COPY --from=build /app/backend/scripts ./backend/scripts`를 추가한다.

- [ ] **Step 3: 로컬 수동 스모크 (dev DB, 실 문자 없이)**

1. `backend/.env`의 `MOBILE_RECEIPT_BASE_URL`이 LAN IP(`http://192.168.219.142:3002`)인지 확인, backend/mobile dev 서버 기동.
2. admin(localhost) 계약 화면에서 바우처 산모의 계약서 미리보기 → "영수증 문자 발송" → 확인. 토스트 "1분 내 발송".
3. dev DB에서 job 확인: `select id, status, cancel_reason from message_trigger_job where rule_id = 'system:service_end_notice' order by created_at desc limit 3;` — Aligo 발송은 dev 자격증명 정책에 따르므로(`ALIGO_*`가 테스트 모드인지 확인), 실제 문자를 원치 않으면 스케줄러 기동 전에 job을 `canceled`로 바꾸고 대신 `receipt_link_token`에 행이 생겼는지, `documents` 버킷에 `receipts/…png`가 올라갔는지 본다.
4. 토큰의 평문은 DB에 없으므로 스모크용 링크는 백엔드 로그(`ReceiptLinkIssueService`가 발급 시 URL을 debug 로그로 남기지 않는다 — 대신 job payload `template_variables.receiptUrl`)에서 얻는다: `select payload->'templateVariables'->>'receiptUrl' from message_trigger_job where id = '<job id>';`
5. 휴대폰에서 링크 열기 → 틀린 생년월일 1회 → 남은 횟수 4회 → 맞는 생년월일 → 이미지 저장. 한글이 ☒ 없이 렌더링되는지 확인.

- [ ] **Step 4: 스펙 갱신 + 메모리**

`docs/superpowers/specs/2026-09-03-service-end-receipt-link-design.md` §5.5 API 표를 구현된 경로/응답 코드와 대조해 다른 곳만 고친다(예: `GET /receipt-links/:token/status` 응답 필드, `POST /receipt-links/send`의 `missing_phone` 사유 추가). 메모리 `service-end-receipt-link-project.md`를 "구현 완료, 검증 통과, dev 병합 대기"로 갱신.

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/specs/2026-09-03-service-end-receipt-link-design.md backend/Dockerfile.lightsail backend/package.json pnpm-lock.yaml
git commit -m "chore(receipt-link): align spec with implementation and verify native canvas in the lightsail image"
```
(변경이 없는 경로는 add에서 자동으로 무시된다.)

#### Task 4.2: Phase 감사 (두 축 병렬)
**Tier:** standard
**Sandbox:** local
**Agent:** phase-auditor
**Model:** claude-opus-5
**Effort:** max
**Paths:** 읽기 전용 감사, 각자 별도 워크트리
**Depends:** Task 4.1

- [ ] **Step 1: 두 감사 동시 디스패치**

감사 A(백엔드 축) 브리프 요지: `git diff dev...HEAD -- backend packages/shared`를 대상으로 (1) 토큰 해시/솔트/잠금 로직의 우회 가능성, (2) `SmsTriggerDeliveryService.sendJob` 훅이 기존 템플릿 발송에 영향을 주지 않는지(레지스트리 미등록 경로), (3) 재시도 시 토큰 재발급 정책(같은 문서의 이전 토큰 revoke)이 이미 발송된 문자를 죽이는 시나리오, (4) `eformsign_doc_file` 재동기화가 `suppressOutboundAutomation`을 지키는지, (5) 마이그레이션 SQL이 `prisma migrate diff`와 일치하는지, (6) 합성 규칙 `system:service_end_notice`가 규칙 UI/스케줄러 재생성 경로에서 오작동하지 않는지(`branchId: null`, `isDefault: false`), (7) 자동 완료 7일 변경이 다른 테스트/문서 가정과 충돌하지 않는지.

감사 B(클라이언트 축) 브리프 요지: `git diff dev...HEAD -- frontend mobile`을 대상으로 (1) 공개 페이지가 확인 전 이름/전화번호를 노출하지 않는지(스펙 §5.6), (2) 쿠키 path/HttpOnly/SameSite와 미들웨어 공개 경로가 최소 범위인지, (3) 이미지 라우트가 4xx를 그대로 전달해 잠금/만료 상태가 화면에 맞게 반영되는지, (4) data-component 네이밍이 기존 규칙(`desktop_contracts_…`, `mobile_contracts_detail-sheet_…`)을 따르는지, (5) 수동 발송 버튼 노출 조건과 사유 메시지 매핑 누락.

두 브리프 모두 끝에 `EFFORT: max — use the full thinking budget; reason exhaustively before acting and verify before returning.` 를 붙인다.

- [ ] **Step 2: 발견 사항 처리**

각 발견을 사실 여부 → 부하 여부(load-bearing) → 이미 처리됨 여부 순으로 판정하고, 통과한 것만 해당 Phase의 태스크 형식(테스트 먼저)으로 고쳐 커밋한다. 거부한 발견은 사유와 함께 채팅에 남긴다.

#### Task 4.3: dev 병합 제안
**Tier:** trivial
**Sandbox:** local
**Agent:** main
**Model:** claude-fable-5-1
**Effort:** low
**Paths:** —
**Depends:** Task 4.2

- [ ] **Step 1:** `git -C <worktree> merge dev` → 충돌 해소 → Task 4.1 Step 1 게이트 재실행.
- [ ] **Step 2:** 사용자에게 보고: 변경 파일 목록, 새 env 키 2개(`MOBILE_RECEIPT_BASE_URL`, `RECEIPT_LINK_HASH_SALT`)를 Lightsail/preview 환경에 넣어야 한다는 점, DB 패치 2건(`receipt_link_token` 생성, `graceDays` 7)이 `database-patches` 워크플로로 승격돼야 한다는 점, `env-backup backend/.env` 요청. **병합은 사용자 승인 후에만** 진행하고, 병합 뒤 워크트리 제거.

---

## 실행 메모 (오케스트레이터용)

- **배치 구성.** Phase 1: 1.1 / 1.2 / 1.3 병렬(경로 disjoint), 1.4는 main이 직접. Phase 2: 2.1 / 2.2 / 2.3 병렬 → 2.4 → 2.5 → 2.6 → 2.7 순차(2.5~2.7은 `receipt-link.module.ts`를 공유). Phase 3: 3.1 / 3.2 / 3.3 병렬(앱별 경로 disjoint). Phase 4 순차.
- **유닛 워크트리.** 프로젝트는 multi-worktree 레이아웃이므로 `/Users/jaino/Development/babyjamjam-admin/service-end-receipt-link-units/unit-<id>/` 아래에 `claude/service-end-receipt-link-<id>` 브랜치로 만들고, 생성 직후 claim 커밋, `pnpm install --frozen-lockfile`, 완료 시 `--no-ff` 머지 → 통합 워크트리 `type-check` → 워크트리/브랜치 제거.
- **1.4는 lockfile을 바꾼다.** 2.1 이후 유닛 워크트리는 1.4가 통합 브랜치에 머지된 뒤에 만든다(frozen install이 새 의존성을 보게).
- **스파이크 산출물**은 `/private/tmp/.../scratchpad/spike/`에 남아 있다(`render-cjs.cjs`, `page-cjs.png`). 2.1 워커 브리프에 "동일 옵션으로 검증된 스파이크"라는 사실과 옵션 목록만 옮기고 파일은 넘기지 않는다.
- **테스트 코드의 가정.** 이 플랜의 테스트는 엔티티 getter 이름(`job.status`, `job.cancelReason`), `errorResponse`의 4xx 처리, `getAuthHeaders` 헤더 키 등 몇 군데에서 "실제 정의와 맞춘다"는 단서를 달았다. 워커는 그 자리의 실제 코드를 읽고 단언만 조정한다 — 동작 요구는 바꾸지 않는다.
