# 서비스 종료 안내 — 영수증 이미지 링크 발송 (Design Spec)

**Date:** 2026-09-03
**Status:** Implemented on branch `service-end-receipt-link` (2026-09-03). §4–§5.9 were re-aligned with the shipped code in Task 4.1; where the implementation deviates from the original design the reason is noted inline.
**Author:** David Jinho Song (+ Claude)
**Builds on:**
- `2026-06-30-sms-trigger-any-system-template-design.md` (SMS 트리거 ↔ 시스템 템플릿 브리지, skip-and-log 가드 선례)
- `2026-08-08-contract-auto-finalize-design.md` (검토 → 완료 자동 전환, `graceDays` 설정)
- 제공기록지 링크(`service_record_token`, m.admin `(public)/service-record`) — 로그인 없는 산모용 링크 선례

---

## 1. Goal

서비스 종료 시점에 바우처 산모에게 **"서비스 종료 안내"** 메시지를 보내고, 그 안의 URL로 **본인부담금 영수증 PNG 이미지**를 내려받게 한다. 산모는 정부24 또는 보건소 환급 신청에 이 이미지를 첨부한다.

발송은 두 경로 모두 지원한다.
1. **자동 발송 규칙** — 기존 SMS 자동 발송 규칙 UI에서 `SERVICE_END` 이벤트 + 오프셋 + 이 템플릿을 짝지어 등록.
2. **수동 발송** — 계약 문서 미리보기(데스크톱 frontend, 모바일 m.admin shell 둘 다)에서 직원이 "영수증 링크 보내기" 클릭.

부속 변경: 검토 단계 계약서의 자동 완료 전환 유예일을 **0일 → 7일**로 바꾼다(기본값 + 저장값 패치).

## 2. Background — current state (verified)

- **영수증 = 계약서 PDF의 7페이지.** 별도 파일이 아니다. `frontend/src/services/api.ts:242-243`이 `download_files?fileType=document&page=7` URL을 만들고, BFF 라우트 `frontend/src/app/api/eformsign/documents/[documentId]/download_files/route.ts`가 백엔드에서 전체 PDF를 받아 pdf-lib로 7페이지만 잘라 단일 페이지 PDF로 내려준다. 모바일도 같은 URL을 쓴다(`mobile/src/services/api.ts:452`, `mobile/src/app/(shell)/contracts/page.tsx:1245-1330`, Web Share 공유 포함).
- **영수증 페이지 내용은 문서 생성 시 prefill로 채워진다.** `backend/application/services/eformsign.service.ts:169-251` — 이용자 성명·생년월일, 서비스 비용·정부지원금·본인부담금, 본인부담금 수령 년/월/일. 서명·완료와 무관하게 값이 들어 있다.
- **PDF 미러는 상태를 가리지 않는다.** `EformsignDocumentMirrorService.syncDocument → syncFile` (`backend/application/services/eformsign-document-mirror.service.ts:460-469, 581-591`)은 검토 단계 문서도 `eformsign_doc_file`(bytea)에 저장한다. eformsign이 아직 PDF를 생성하지 않았으면 partial로 남는다. `GET /api/documents/:documentId/download_files` (`backend/interface/controllers/eformsign.controller.ts:930-978`)는 저장본 → 없으면 `syncMissingDocumentFile` 재동기화 → 그래도 없으면 503, 상태 검사 없음.
- **문서 ↔ 산모 연결.** `eformsign_doc.clientId`(N:1), `client.eDocId`(현재 문서의 eformsign documentId). `findByClientId(branchId, clientId)`는 연결된 문서 전부를 돌려준다(`sb.eformsign-doc.repository.ts:259-265`).
- **산모 필드.** `client.voucherClient`(boolean, 바우처 수혜 여부), `client.birthday`(VarChar(6), 산모 생년월일 YYMMDD, nullable), `client.birthDate`(Date, 아기 출생일 — 사용 안 함).
- **메시지 시스템.** 알리고 SMS/LMS 텍스트 전용(`send-sms.dto.ts:39-52` — 제목 있거나 90바이트 초과면 LMS). 템플릿 변수는 `{{key}}` 치환, 누락 시 빈 문자열(`sms-trigger-delivery.service.ts:464-471, 595-596`). URL 변수 선례 `serviceRecordUrl`. 시스템 템플릿 레지스트리 `backend/domain/constants/system-template-registry.ts`, 트리거 카탈로그 `backend/domain/constants/message-trigger-catalog.ts`, 스케줄러 매분 실행(`message-trigger-scheduler.service.ts:31`). `SERVICE_END` 이벤트 기준일은 `client.endDate`(`message-trigger.service.ts:1611-1612`).
- **로그인 없는 산모 링크 선례.** `service_record_token`(`schema.prisma:1071~`), 토큰 `efl_` + 32바이트 base64url(`service-record-token.service.ts:64-92`), 만료·잠금·챌린지 필드, 공개 엔드포인트 `GET /service-record/link/:linkToken`, `POST /service-record/verify`(`service-record-entry.controller.ts:30-99`), m.admin `middleware.ts:178-213` PUBLIC_ROUTES(`/service-record`, `/api/service-record`), 페이지 `mobile/src/app/(public)/service-record`, BFF `mobile/src/app/api/service-record`. URL base env `MOBILE_SERVICE_RECORD_BASE_URL`(기본 `https://m.admin.babyjamjam.com`).
- **파일 저장소.** Supabase Storage `documents` 버킷(private, 25MB), 서명 URL 300초(`supabase-storage.adapter.ts:30-150`). 바이너리 응답 선례 `document.controller.ts:321-393`.
- **자동 완료.** 매일 17:00 KST 배치(`contract-auto-finalize-scheduler.service.ts:26`), 정책 `contract-auto-finalize.policy.ts:30-49`: 상태 070(제공기관 검토) ∧ 계약서 종료일 + `graceDays` ≤ 오늘 ∧ 시도 < 3 ∧ 백로그 펜스. `graceDays`는 브랜치별 설정(0~30, `system-setting.service.ts:397-399`), 기본값 `DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.graceDays = 0`(`contract-auto-finalize-scheduler.service.ts:113-132`), UI `frontend/src/components/app/contracts/ContractAutomationsManager.tsx`.
- **런타임.** 백엔드 Lightsail 이미지(`backend/Dockerfile.lightsail`)는 node:20-bookworm-slim + playwright chromium. PDF → 이미지 변환 라이브러리는 백엔드에 없다.

## 3. Decisions (confirmed with the user)

| # | 결정 |
|---|---|
| D1 | 발송 경로: 자동 규칙 + 수동 발송 둘 다 |
| D2 | 링크 보호: 추측 불가 토큰 + **산모 생년월일(YYMMDD) 확인** + 발송 시점부터 **30일** 만료 |
| D3 | 대상: **바우처 산모만**(`voucherClient = true`). **계약서 완료 여부는 무관** |
| D4 | 이미지: 발송 시점에 백엔드가 7페이지를 PNG로 렌더링해 저장(접근안 1) |
| D5 | 템플릿 이름 "서비스 종료 안내", 본문은 §5.1 문구, 변수 `name`, `receiptUrl` |
| D6 | 자동 완료 유예일 기본값 7 + 저장된 브랜치 설정 전부 7로 일회성 패치 |
| D7 | 관리자 UI는 데스크톱 frontend와 모바일 m.admin(shell)에 동일 적용 |

**접근안 비교(기록).** ② 산모가 열 때 즉시 렌더링 — 실패가 산모 대기 순간에 터지고 매 요청 CPU 사용, 이점 없음. ③ 산모 브라우저 pdf.js 렌더링 — iOS Safari 캔버스 저장 제약, 기기별 편차, "URL에 PNG" 요구와 불일치. → ①을 택했다.

## 4. Architecture

### 4.1 발송 파이프라인 (자동·수동 공통)

`ReceiptLinkIssueService.issue({ branchId, clientId, source, jobId?, createdBy?, existingUrl? })`가 1~7단계를 맡고, 8단계는 기존 SMS 트리거 파이프라인이 맡는다: `ReceiptLinkDeliveryEnricher`가 `SERVICE_END_NOTICE` 잡의 발송 직전에 `issue()`를 호출해 `templateVariables.receiptUrl`·`buttonUrl`을 채운다(`SmsTriggerPayloadEnricherRegistry`). 자동·수동 모두 같은 잡 큐를 탄다 — 수동 발송은 합성 시스템 규칙 `system:service_end_notice`("서비스 종료 안내 (수동 발송)", `branchId = null`, `isDefault = false`, 모든 지점의 규칙 목록에 읽기 전용으로 보임)에 매달린 `scheduledFor = now` 잡을 `upsertPending`하고, 리스 보유 인스턴스의 매분 크론이 60초 안에 보낸다(즉시 발송 nudge는 tenant-bypass 린트 게이트 때문에 두지 않았다). 단계와 실패 시 스킵 사유:

| 단계 | 동작 | 실패 시 사유 코드 |
|---|---|---|
| 1 | 산모 로드, `voucherClient` 확인 | `not_voucher_client` |
| 2 | `birthday` 6자리 존재·형식 확인 | `missing_birthday` |
| 3 | 계약 문서 선택: 수동 발송은 직원이 고른 문서(잡 payload에 문서 id를 실어 발송 시점에도 같은 문서), 자동 발송은 `client.eDocId`로 조회 → 없으면 `findByClientId` 중 `createdDate` 최신. 어느 쪽이든 `documentKind = contract`이고 그 산모의 문서여야 한다 | `no_contract_document` |
| 4 | 미러 PDF 로드, 없으면 `syncMissingDocumentFile` 재동기화 | `pdf_unavailable` |
| 5 | `PdfPageRasterizer.renderPage(pdf, 7)` → PNG | `render_failed` |
| 6 | Storage 업로드 `receipts/{branchId}/{eformsignDocId}/{sha256}.png` (내용 해시 경로 — 같은 PNG는 재업로드하지 않는다) | `upload_failed` |
| 7 | 같은 문서의 활성 토큰 `active=false, revokedAt=now`, 새 `receipt_link_token` 생성 | — |
| 8 | 변수 `{ name, receiptUrl }`로 템플릿 렌더 → 기존 SMS 발송 경로 → `message_log` | 기존 발송 실패 처리 |

스킵은 **재시도하지 않는 종결 처리**다(비용 안내 `missing_price_data` 선례). 자동 경로는 `ReceiptLinkSkipError`(`SmsTriggerDeliverySkipError` 하위)로 잡을 스킵 종결하고 사유를 로그에 남긴다. 수동 경로(`ReceiptLinkManualSendService`)는 잡을 만들기 **전에** 같은 preflight(1~4단계)를 돌려 사유를 400 `{ reason, message }`로 돌려주므로, 직원은 큐에 들어가기 전에 실패를 본다. 재발급 시 같은 잡의 활성 토큰이 아직 유효하고 `existingUrl`이 있으면 재렌더링 없이 그 URL을 재사용한다(재시도 idempotence).

토큰 URL: `${MOBILE_RECEIPT_BASE_URL ?? MOBILE_SERVICE_RECORD_BASE_URL}/receipt/${linkToken}`.

### 4.2 산모 열람 흐름 (m.admin public)

1. `GET /receipt/{token}` 페이지 진입 → BFF `GET /api/receipt/{token}/status` → 백엔드 `GET /receipt-links/:token/status` → 200 `{ ok: true, state: "pending" | "verified", branchName, expiresAt, remainingAttempts, lockedUntil }`(잠금 중에도 `state`는 `pending`이고 `lockedUntil`이 채워진다)(명시적 프로젝션 — 산모 이름·번호는 절대 포함하지 않는다) / 404 `{ reason: "not_found" }` / 410 `{ reason: "expired" | "revoked" }`. 페이지는 404·410을 각각 `not_found`·`expired` 화면으로 그린다(`revoked`도 만료 화면 — 별도 문구는 승인된 카피에 없다).
2. 생년월일 6자리 입력 → BFF `POST /api/receipt/{token}/verify { birthday }` → 백엔드 검증 → 성공 시 `{ ok: true, accessToken, clientName }` → BFF는 `accessToken`을 HttpOnly 쿠키에만 넣고 브라우저에는 `{ ok: true, clientName }`만 돌려준다(산모 이름은 이 응답에서 처음 노출된다). 8자리 입력은 그대로 보내고 백엔드 `normalizeBirthdayInput`이 뒤 6자리로 축약한다.
3. `<img src="/api/receipt/{token}/image">` → BFF가 쿠키의 accessToken을 헤더로 붙여 백엔드 `GET /receipt-links/:token/image` 호출 → `image/png`, `Content-Disposition: inline`, `Cache-Control: private, no-store`.
4. "이미지 저장" 버튼 = 같은 URL에 `?download=1` → `Content-Disposition: attachment; filename="영수증_{산모명}.png"`(RFC 5987 `filename*` 병기). 저장 방법 안내 문단은 두지 않는다(§5.6 목업 확정).

### 4.3 컴포넌트 배치

| 계층 | 신규 | 수정 |
|---|---|---|
| shared | `SERVICE_END_NOTICE` 키 | `alimtalk.ts` 트리거 키 union, `SMS_TRIGGER_TEMPLATE_KEYS`, `SMS_TRIGGER_TO_SYSTEM_TEMPLATE` (사유 라벨 맵은 shared export 표면을 건드리지 않으려고 앱별 파일 `frontend/src/lib/receipt-link.ts`·`mobile/src/lib/receipt-link.ts`에 같은 내용으로 둔다) |
| backend | `PdfPageRasterizerService`, `ReceiptLinkTokenService`, `ReceiptLinkIssueService`, `ReceiptLinkManualSendService`, `ReceiptLinkDeliveryEnricher`, `ReceiptLinkCleanupSchedulerService`, `ReceiptLinkController`(공개 3개) + `ReceiptLinkAdminController`(수동 발송 1개), `ReceiptLinkModule`, Prisma 모델 + 도메인 리포지토리(`IReceiptLinkTokenRepository`/`SbReceiptLinkTokenRepository`, 공개 경로 메서드는 `runSystemScope`로 tenant-isolation 통과) | 시스템 템플릿 레지스트리, 트리거 카탈로그, `SMS_TEMPLATE_DELIVERY`, `sms-trigger-delivery`의 변수 빌더, `DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG`, `env.tpl` |
| mobile | `(public)/receipt/[token]` 페이지·`layout.tsx`(탭 제목), `api/receipt/[token]/{status,verify,image}` BFF, `lib/api/receipt-auth.ts`, `lib/receipt-link.ts`, BFF `api/receipt-links/send` | `middleware.ts` PUBLIC_ROUTES/PUBLIC_API_ROUTES, `(shell)/contracts/page.tsx` 액션, `services/api.ts` |
| frontend | `ReceiptSendConfirmDialog`, `lib/receipt-link.ts`, BFF `api/receipt-links/send` | `SharedDocumentPreviewDialog.receiptSendAction`, `ContractDocumentPreviewModal`, 계약 페이지 mutation, `services/api.ts`, 트리거 규칙 폼의 라벨 맵 3종 |
| db patch | `receipt_link_token` 생성 SQL, `graceDays` 7 패치 SQL | — |

## 5. Detailed design

### 5.1 템플릿 — `SERVICE_END_NOTICE`

시스템 템플릿 레지스트리에 추가. `name: "서비스 종료 안내"`, 채널 SMS(LMS 자동 판정), `requiredVariables: [name, receiptUrl]`.

본문(초기값, 시스템 템플릿 페이지에서 편집 가능):

```
[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{name}}산모님~♡

본인부담금 환급신청을 위한 영수증 다운로드 방법 안내 드립니다 :)

아래의 URL로 접속하시면 본인부담금 영수증 다운로드가 가능하십니다. 환급 신청은 관할지 보건소 방문 또는 인터넷 정부24에서 가능하시고, 다운로드 받으신 영수증 이미지를 첨부하시면 환급 신청 가능 하십니다^^

{{receiptUrl}}

추가 문의사항이 있으시면 상세히 답변 드리도록 하겠습니다.

감사합니다 :)
```

트리거 카탈로그 항목: `allowedEventTypes: [SERVICE_END]`, `allowedRecipientTypes: [CLIENT]`, providers는 기존 SMS 항목과 같은 형태. `SMS_TEMPLATE_DELIVERY`: `smsLogTemplateKey: service_end_notice_sms`, `automationKey: SERVICE_END_NOTICE_SMS`, `triggerType: service_end_notice`, `systemTemplateKey: SERVICE_END_NOTICE`.

`buildClientTemplateVariables`의 SMS 일반 변수 백에 `receiptUrl`은 **넣지 않는다**. 이 템플릿은 발송 직전 `sendSmsJob`에서 `ReceiptLinkService`가 토큰을 만든 뒤 `receiptUrl`을 주입한다(URL은 토큰 생성 부작용을 동반하므로 미리 계산하지 않는다).

### 5.2 데이터 모델 — `receipt_link_token`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| branch_id | uuid | |
| client_id | int | FK client, SetNull |
| eformsign_doc_id | int | FK eformsign_doc |
| job_id | text null | 발급을 유발한 `message_trigger_job.id` — 재시도 시 같은 잡의 활성 토큰 재사용에 쓴다 |
| link_token_hash | varchar unique | sha256(`efr_` + 32바이트 base64url 평문). 이 테이블은 해시만 저장한다. 평문은 URL로서 `message_trigger_job.payload.templateVariables.receiptUrl`·`buttonUrl`과 `message_log`(variables·messageBody)에 남는다 — `serviceRecordUrl`과 같은 정책이며, 지점 관리자만 볼 수 있는 화면이다 |
| expected_birthday_hash | varchar | sha256(`RECEIPT_LINK_HASH_SALT` + YYMMDD) |
| access_token_hash | varchar null unique | sha256(accessToken) |
| verified_at | timestamptz null | |
| failed_attempts | int default 0 | |
| locked_at | timestamptz null | |
| expires_at | timestamptz | 발급 + 30일 |
| active | boolean default true | |
| revoked_at | timestamptz null | 재발급으로 무효화된 시각 |
| storage_path | varchar | |
| content_sha256 | char(64) | Storage 경로의 파일명이기도 하다 |
| byte_size | int | |
| source | varchar | `auto_trigger` \| `manual` (CHECK 제약) |
| created_by | uuid null | 수동 발송 직원 |
| created_at | timestamptz | |

인덱스: `(eformsign_doc_id, active)`, `(job_id)`, `(expires_at)`, `(branch_id)`, unique `link_token_hash`, unique `access_token_hash`. 마이그레이션 `20260904000000_add_receipt_link_token`은 additive·멱등(`IF NOT EXISTS`) SQL이며 database-patches 워크플로 3환경 블록에 모두 배선돼 있다. `receipt_link_token`은 `TENANT_MODELS`에 등록돼 tenant-isolation 확장의 감시 대상이다.

### 5.3 렌더러 — `PdfPageRasterizer`

- 의존성: `pdfjs-dist`(legacy Node 빌드) + `@napi-rs/canvas`(prebuilt, apt 불필요). `backend/package.json`에만 추가.
- 입력: PDF Buffer, 페이지 번호(1-base). 출력: PNG Buffer, `{ width, height }`.
- 스케일: 페이지 폭이 1240px이 되도록(A4 150dpi 상당). 파일 크기 상한은 두지 않는다(스파이크 실측 약 220KB).
- 페이지 수 < 7이면 `render_failed(reason: page_out_of_range)`.
- 폰트: PDF 임베드 폰트 사용(eformsign PDF는 CID TrueType 서브셋을 전부 임베드한다).
- **스파이크 결과(2026-09-03, dev DB 실제 계약서 9쪽짜리로 확인): 통과.** Node에서는 반드시 아래 옵션으로 열어야 한다. 기본값(`disableFontFace: false`)이면 브라우저 FontFace API가 없어 한글이 전부 ☒ 박스로 나온다.
  ```ts
  pdfjs.getDocument({
    data,                       // Uint8Array
    disableFontFace: true,      // 임베드 글리프를 path로 직접 그림 (Node 필수)
    useSystemFonts: false,
    cMapUrl: <pdfjs-dist/cmaps/ 경로>, cMapPacked: true,
    standardFontDataUrl: <pdfjs-dist/standard_fonts/ 경로>,
  })
  ```
  `pdfjs-dist/legacy/build/pdf.mjs` + `@napi-rs/canvas`의 `createCanvas`로 폭 1240px 렌더링 시 약 100ms, PNG 약 220KB. 결과는 poppler `pdftoppm -r 150`과 육안상 동일했다. 영수증 페이지는 상·하 두 장(제공기관 보관 / 이용자 보관)이 한 페이지에 있으며 페이지 전체를 그대로 이미지로 쓴다. 참고: 수령일의 "20|025" 겹침은 eformsign 템플릿의 인쇄 글자와 prefill 값이 겹친 것으로 두 렌더러 모두 동일하게 나온다(우리 버그 아님).

### 5.4 토큰·검증 — `ReceiptLinkTokenService`

- 생년월일 정규화: 숫자만 6자리. 입력이 8자리(YYYYMMDD)면 뒤 6자리로 축약해 비교.
- 시도 예약이 비교보다 먼저다: 리포지토리의 단일 조건부 `UPDATE … RETURNING`이 잠금 창 안이면 거부, 창이 지났으면 1로 리셋, 아니면 `failed_attempts += 1`(5회 도달 시 같은 문장에서 `locked_at = now`)을 원자적으로 수행하고, 예약에 성공한 요청만 해시를 비교한다(동시 요청 폭주로 잠금을 우회하지 못하게). 성공 시 `failed_attempts = 0`. 30분 잠금(제공기록지 상수 재사용). 잠금 중엔 `locked` 반환.
- 성공 → `accessToken`(32바이트 랜덤) 발급, 해시 저장, `verified_at` 기록. accessToken 유효기간은 링크 만료와 동일.
- 만료·비활성 토큰은 백엔드 status가 410 `expired`/`revoked`로 구분한다. m.admin 페이지는 둘 다 만료 화면(§5.6 확정 카피)으로 그린다 — 재발급으로 revoke된 구 링크를 연 산모도 "유효기간이 지났습니다"를 본다(별도 문구는 승인되지 않았다).
- 속도 제한: `status`·`verify`는 제공기록지 컨트롤러와 같은 `RateLimitGuard`(IP당 100회/15분). `image`는 접근 토큰 자체가 게이트라 throttle을 두지 않는다. 가드의 버킷 키가 핸들러 메서드 이름이므로 영수증 핸들러는 `receiptStatus`/`receiptVerify`로 이름 붙여 제공기록지 `verify`와 버킷을 공유하지 않는다. BFF는 클라이언트의 `X-Forwarded-For`를 백엔드로 전달하지 않는다(위조 가능 헤더로 throttle을 우회할 수 있어 제거) — 따라서 백엔드는 m.admin 서버 IP 하나로 집계한다(제공기록지 BFF와 같은 기존 특성).

### 5.5 백엔드 API

| 메서드 | 경로 | 가드 | 응답 |
|---|---|---|---|
| POST | `/receipt-links/send` | Jwt + Tenant + 발신 승인(`ensureApproved`) | 200 `{ jobId, scheduledFor, clientName }` / 400 `{ reason, message }`(preflight 스킵 사유 또는 `document_not_linked`, `missing_phone`) / 404 `{ reason: "document_not_found" }` / 403 `{ message }`(발신 승인 없음) 또는 `{ reason: "branch_required" }` |
| GET | `/receipt-links/:token/status` | 공개, throttle | 200 `{ ok, state: "pending"\|"verified", branchName, expiresAt, remainingAttempts, lockedUntil }` / 404 `{ reason: "not_found" }` / 410 `{ reason: "expired"\|"revoked" }` |
| POST | `/receipt-links/:token/verify` | 공개, throttle | 200 `{ ok: true, accessToken, clientName }` / 401 `{ reason: "verification_failed", remainingAttempts }` / 423 `{ reason: "locked", lockedUntil }` / 400 `{ reason: "invalid_format" }` / 404 / 410 |
| GET | `/receipt-links/:token/image?download=0\|1` | 공개 + `X-Receipt-Access-Token`(또는 `Authorization: Bearer`) | PNG 스트림(`Content-Length`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`) / 401 `{ reason: "access_required" }`(토큰 없음·불일치·만료 모두) / 410 `{ reason: "expired" }`(Storage 객체가 이미 정리됨) |

수동 발송 요청 본문은 `{ documentId }`(eformsign documentId; BFF가 비어 있으면 400 `invalid_request`로 먼저 거른다). 백엔드가 문서의 `clientId`로 산모를 찾고, 영수증은 **그 문서**의 7페이지를 렌더링한다(문서에 산모가 연결되지 않았으면 `no_contract_document` 대신 `document_not_linked`; 연락처가 없거나 형식이 틀리면 `missing_phone`). 400/404 본문은 BFF(frontend·mobile)가 상태·본문 그대로 전달한다 — 공유 `errorResponse`는 `reason`을 버리므로 쓰지 않는다. 5xx는 일반 오류 본문으로 감춘다.

수동 발송 사유 라벨(두 앱 동일): `not_voucher_client`, `missing_birthday`, `no_contract_document`, `document_not_linked`, `document_not_found`, `pdf_unavailable`, `missing_phone`; 맵에 없는 사유는 서버 `message`(문자열일 때만) → 공통 폴백 순으로 안내한다.

### 5.6 m.admin — 산모 공개 페이지

- 라우트 `mobile/src/app/(public)/receipt/[token]/page.tsx`, BFF `mobile/src/app/api/receipt/[token]/{status,verify,image}/route.ts`.
- `middleware.ts` PUBLIC_ROUTES에 `/receipt`, `/api/receipt` 추가.
- 화면 상태: `loading` → `verify`(생년월일 입력, 잘못된 입력 횟수 표시) → `image`(이미지 + "이미지 저장") → `expired` / `locked` / `not_found`.
- 쿠키: 이름 `receipt_access`, `Path=/api/receipt/{token}`(토큰별 격리), HttpOnly, SameSite=Lax, 프로덕션에서 Secure, Max-Age 30일 고정. 링크 만료와 정확히 같지는 않지만 백엔드가 `image` 요청마다 `expires_at`을 재검증하므로 쿠키가 접근을 연장하지 못한다(verify 응답에 `expiresAt`이 없어 `min()`을 계산하지 않았다).
- 탭 제목: `(public)/receipt/[token]/layout.tsx`가 metadata title "본인부담금 영수증"을 준다(상위 레이아웃의 "서비스 제공기록지"를 상속하지 않도록).
- **화면 목업(사용자 수정본, 2026-09-03 확정):** https://claude.ai/code/artifact/b8525136-d170-4aae-a635-be51a0f83770 — 제공기록지 공개 페이지와 같은 비주얼(파랑 `#004aad` 상단바 + 진행 막대, 12px 라운드 입력, 굵은 파랑 버튼, 시스템 고딕). 목업에서 확정된 카피·구성:
  - 상단바: 제목 "본인부담금 영수증", 지점명, 단계 크럼("1단계 · 본인 확인" / "2단계 · 영수증 저장"), 진행 막대 50% → 100%.
  - `verify`: 제목 "산모님 본인 확인", 설명 "본인부담금 영수증은 산모님 본인만 열람하실 수 있습니다. 계약 시 등록하신 생년월일을 입력해 주세요.", 라벨 "산모 생년월일", placeholder "예) 940315", 보조문구 "주민등록번호 앞 6자리", 버튼 "확인하기", 안내 박스 "입력하신 생년월일은 본인 확인에만 사용되며 저장되지 않습니다. 확인 후 영수증 이미지를 바로 내려받으실 수 있습니다." **확인 전에는 산모 이름을 노출하지 않는다.**
  - 불일치: 입력 테두리 오류색, 메시지 "생년월일이 일치하지 않습니다. 남은 횟수 N회", 버튼 "다시 확인하기", 경고 박스 "5회 연속 틀리면 30분 동안 확인이 잠깁니다. 계약서에 적힌 산모님 생년월일과 같은지 확인해 주세요."
  - `image`: 제목 "{산모명} 산모님 영수증" + "확인 완료" 칩, 영수증 PNG, 버튼 "이미지 저장"(다운로드 아이콘). 별도 저장 방법 안내 문단은 두지 않는다.
  - `expired`: 시계 아이콘, 제목 "링크 유효기간이 지났습니다", 설명 "영수증 링크는 문자 발송일로부터 30일간 열어보실 수 있습니다. 영수증이 다시 필요하시면 인천 아이미래로에 연락 주세요." 전화 버튼·전화번호는 두지 않는다.
  - 모든 화면 하단 공통 문구 "이 링크는 발송일로부터 30일간 유효합니다." **연락처(전화번호)는 어느 화면에도 표시하지 않는다.**

### 5.7 관리자 UI — 데스크톱 + 모바일 동일 적용

공통 계약: 같은 API, 같은 확인 흐름(확인 다이얼로그 → 발송 → 결과 토스트), 같은 사유 라벨 맵(앱별 파일, 내용 동일 — §4.3).

- **frontend**: `SharedDocumentPreviewDialog`가 `receiptSendAction?: ReactNode` 슬롯을 받고, `ContractDocumentPreviewModal`이 푸터 파일 액션 영역의 "영수증" 다운로드 버튼 옆에 "영수증 문자 발송" 버튼(`…_footer_file-actions_receipt-send`)을 넣는다. 버튼은 `onSendReceiptLink` 핸들러가 주어지면 항상 보이고(대상 판정은 백엔드 preflight가 한다), 기존 "영수증" 다운로드 버튼의 완료 게이트는 유지. 계약 페이지가 `useMutation`을 소유하고, 확인은 `ReceiptSendConfirmDialog`(`…_dialogs_receipt-send-confirm`).
- **mobile shell**: `(shell)/contracts/page.tsx` 상세 액션에 "영수증 문자"(`mobile_contracts_detail-sheet_stack_detail-page_actions_receipt-send`), 확인은 `ApprovalTwoButtonModal`(`…_dialogs_receipt-send-confirm`, 설명 문구 표시).
- 확인 다이얼로그 내용: 수신 산모 **이름만**(연락처는 표시하지 않는다 — 전역 no-phone 규칙), "본인부담금 영수증 링크가 담긴 문자를 1분 내 발송합니다. 링크는 30일간 유효하며, 산모님이 생년월일로 본인 확인 후 열람합니다.", 발송 버튼. 원안의 렌더링된 메시지 미리보기는 두지 않았다(본문이 고정 템플릿이고 URL은 발송 시 생성되므로 정적 문구의 사본만 늘어난다). 성공 토스트: "{이름} 산모님께 1분 내 발송됩니다. 링크는 30일간 유효합니다." 400 사유는 라벨 맵으로 안내(§5.5). 수동 발송은 백엔드에서 dedupe하지 않으므로(재발송 허용) 확인 다이얼로그와 `isPending` 비활성화가 오클릭의 유일한 방어다.
- 트리거 규칙 폼: `TRIGGER_TEMPLATE_MESSAGE_FALLBACKS`, `TEMPLATE_LABELS` ×2에 새 키 추가(exhaustive Record). 드롭다운·미리보기는 데이터 드리븐이라 자동 노출.

### 5.8 자동 완료 유예일 7일

- `DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.graceDays: 0 → 7`.
- 정책 테스트 경계: 종료일+6일 미대상, +7일 대상.
- 일회성 SQL 패치 `20260904000100_contract_auto_finalize_grace_days_7`: 설정은 `system_setting(key, value)`에 키 `branch:{branchId}:contract_automation:auto_finalize`, 값은 JSON 문자열로 저장된다(`system-setting.service.ts:46`). database-patches 워크플로는 이 파일을 push마다 재실행하므로 `DO $$` 블록으로 (1) 행별 `::jsonb` 캐스트 실패·비객체 값은 건너뛰고, (2) `updated_at < '2026-09-04'`인 행만 `jsonb_set(value, '{graceDays}', '7')`로 고친다 — 이후 운영자가 바꾼 값을 재실행이 덮어쓰지 않도록.
- UI 기본값 표시도 7로 맞춘다.
- 기준일은 현재처럼 계약서 문서의 종료일. 메시지 `SERVICE_END`의 `client.endDate`와는 별개 기준을 유지한다(둘 다 기존 기준).

### 5.9 정리 스윕

`ReceiptLinkCleanupSchedulerService` — 매일 04:30 KST, 스케줄러 리스 보유 인스턴스만: `expires_at < now - 1일`인 토큰(회당 최대 1000행)을 모아 다른 활성 행이 참조하지 않는 Storage 객체를 먼저 지우고(실패는 경고 후 계속), 그 다음 행을 삭제한다. 원안의 "행 유지·`storage_path = null`"은 채택하지 않았다 — `storage_path`가 NOT NULL이고 감사 기록은 `message_log`가 이미 보유한다. 재발급으로 revoke된 토큰도 `expires_at`이 지나면 같은 스윕에서 정리된다. 객체→행 순서는 스윕 도중 크래시 시 다음 날 재시도가 가능하도록 테스트로 고정돼 있다.

### 5.10 환경 변수

- `MOBILE_RECEIPT_BASE_URL`(선택, 없으면 `MOBILE_SERVICE_RECORD_BASE_URL`), `RECEIPT_LINK_HASH_SALT`(필수, 비밀). `backend/env.tpl`에 추가하고 사용자에게 `env-backup` 안내.

## 6. Error handling & security

- 렌더링·업로드 실패는 발송 전에 잡히므로 산모가 깨진 링크를 받지 않는다.
- 생년월일은 경우의 수 10^6 → 토큰의 추측 불가성이 1차, 시도 제한·잠금이 2차 방어. 해시에 서버 솔트.
- 재발급 시 이전 토큰 즉시 무효화(문서당 활성 토큰 1개).
- 이미지 응답은 `no-store`, 서명 URL을 산모에게 직접 노출하지 않고 백엔드가 스트리밍한다.
- 자동 규칙의 `dedupeKey`가 중복 자동 발송을 막는다. 수동 발송은 의도적 재발송을 허용한다.
- 백엔드 Sentry는 service-records 이벤트만 통과하므로 이 도메인의 오류는 앱 로그와 `message_log` 스킵 사유로 관측한다.

## 7. Verification plan

**0단계 스파이크 — 완료(2026-09-03).** dev DB의 실제 계약서 1건으로 pdfjs-dist + @napi-rs/canvas 렌더링을 돌려 7페이지 PNG의 한글·표·로고를 육안 확인했다. §5.3의 옵션으로 정상 렌더링됨. chromium 대안은 불필요.

**단위(backend).** 렌더러(픽스처 PDF → 크기·해시, 페이지 범위 초과), 토큰 서비스(만료·잠금·재발급 무효화·8자리 입력 축약), `issueAndSend` 가드 사유별 스킵, 템플릿 카탈로그 드리프트 가드(`SMS_TEMPLATE_DELIVERY` keys === `SMS_TRIGGER_TEMPLATE_KEYS`), 자동 완료 정책 경계.

**e2e(backend).** 수동 발송 → status active → verify 실패 5회 → locked → 잠금 해제 후 성공 → image 200 → 재발급 후 구 토큰 revoked → 만료 후 410.

**e2e(mobile Playwright).** 공개 페이지 입력 → 이미지 표시 → 저장 버튼 응답 헤더 → 만료·잠금 화면. shell 계약 페이지 발송 액션 → 확인 모달 → 성공 토스트.

**프론트.** 미리보기 푸터 버튼 노출 조건, 확인 다이얼로그, 사유 라벨. 트리거 규칙 폼에 새 템플릿 노출·미리보기.

**배포.** Lightsail Dockerfile 빌드에서 `@napi-rs/canvas` prebuilt가 node:20-bookworm-slim에서 로드되는지 확인. `env-check` 통과.

## 8. Non-goals

알림톡 버전, MMS 이미지 첨부, PDF 다운로드 옵션, 산모 앱 로그인 연동, 제공기록지 토큰 테이블과의 통합, 영수증 페이지 번호의 템플릿별 설정(현재 7 고정 유지), `SERVICE_END` 기준일 통일.
