# 서비스 종료 안내 — 영수증 이미지 링크 발송 (Design Spec)

**Date:** 2026-09-03
**Status:** Design approved in chat — pending spec review
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

`ReceiptLinkService.issueAndSend({ branchId, clientId, source, actorId? })` 하나로 통합한다. 단계와 실패 시 스킵 사유:

| 단계 | 동작 | 실패 시 사유 코드 |
|---|---|---|
| 1 | 산모 로드, `voucherClient` 확인 | `not_voucher_client` |
| 2 | `birthday` 6자리 존재·형식 확인 | `missing_birthday` |
| 3 | 계약 문서 선택: `client.eDocId`로 조회 → 없으면 `findByClientId` 중 `createdDate` 최신 | `no_contract_document` |
| 4 | 미러 PDF 로드, 없으면 `syncMissingDocumentFile` 재동기화 | `pdf_unavailable` |
| 5 | `PdfPageRasterizer.renderPage(pdf, 7)` → PNG | `render_failed` |
| 6 | Storage 업로드 `receipts/{branchId}/{documentId}/{tokenId}.png` | `upload_failed` |
| 7 | 같은 문서의 활성 토큰 `active=false, revokedAt=now`, 새 `receipt_link_token` 생성 | — |
| 8 | 변수 `{ name, receiptUrl }`로 템플릿 렌더 → 기존 SMS 발송 경로 → `message_log` | 기존 발송 실패 처리 |

스킵은 **재시도하지 않는 종결 처리**다(비용 안내 `missing_price_data` 선례). 자동 경로는 잡을 done으로 닫고 사유를 로그 `variables`에 남긴다. 수동 경로는 사유 코드를 400으로 돌려준다.

토큰 URL: `${MOBILE_RECEIPT_BASE_URL ?? MOBILE_SERVICE_RECORD_BASE_URL}/receipt/${linkToken}`.

### 4.2 산모 열람 흐름 (m.admin public)

1. `GET /receipt/{token}` 페이지 진입 → BFF `GET /api/receipt/{token}/status` → 백엔드 `GET /receipt-links/:token/status` → `{ state: "active" | "expired" | "locked" | "revoked" | "not_found", verified: boolean }`.
2. 생년월일 6자리 입력 → BFF `POST /api/receipt/{token}/verify { birthday }` → 백엔드 검증 → 성공 시 `accessToken` 발급, BFF가 HttpOnly 쿠키에 저장.
3. `<img src="/api/receipt/{token}/image">` → BFF가 쿠키의 accessToken을 헤더로 붙여 백엔드 `GET /receipt-links/:token/image` 호출 → `image/png`, `Content-Disposition: inline`, `Cache-Control: private, no-store`.
4. "이미지 저장" 버튼 = 같은 URL에 `?download=1` → `Content-Disposition: attachment; filename="{산모명}_본인부담금영수증.png"`. iOS Safari는 길게 눌러 저장 안내 문구 병기.

### 4.3 컴포넌트 배치

| 계층 | 신규 | 수정 |
|---|---|---|
| shared | `SERVICE_END_NOTICE` 키, 스킵 사유 코드·라벨 맵 | `alimtalk.ts` 트리거 키 union, `SMS_TRIGGER_TEMPLATE_KEYS`, `SMS_TRIGGER_TO_SYSTEM_TEMPLATE` |
| backend | `PdfPageRasterizer`, `ReceiptLinkTokenService`, `ReceiptLinkService`, `ReceiptLinkController`(공개 3개 + 수동 발송 1개), Prisma 모델, 스윕 크론 | 시스템 템플릿 레지스트리, 트리거 카탈로그, `SMS_TEMPLATE_DELIVERY`, `sms-trigger-delivery`의 변수 빌더, `DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG`, `env.tpl` |
| mobile | `(public)/receipt/[token]` 페이지, `api/receipt/[token]/{status,verify,image}` BFF | `middleware.ts` PUBLIC_ROUTES, `(shell)/contracts/page.tsx` 액션, `services/api.ts` |
| frontend | 확인 다이얼로그 컴포넌트 | 문서 미리보기 푸터, `services/api.ts`, 트리거 규칙 폼의 라벨 맵 3종 |
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
| link_token_hash | varchar unique | sha256(`efr_` + 32바이트 base64url 평문). 평문은 URL에만 존재(제공기록지 `linkTokenHash`와 동일 정책) |
| expected_birthday_hash | varchar | sha256(`RECEIPT_LINK_HASH_SALT` + YYMMDD) |
| access_token_hash | varchar null | sha256(accessToken) |
| verified_at | timestamptz null | |
| failed_attempts | int default 0 | |
| locked_at | timestamptz null | |
| expires_at | timestamptz | 발급 + 30일 |
| active | boolean default true | |
| revoked_at | timestamptz null | 재발급으로 무효화된 시각 |
| storage_path | varchar | |
| content_sha256 | varchar | |
| byte_size | int | |
| source | varchar | `auto_trigger` \| `manual` |
| created_by | uuid null | 수동 발송 직원 |
| created_at | timestamptz | |

인덱스: `(eformsign_doc_id, active)`, `(expires_at)`. 마이그레이션은 additive만, database-patches 워크플로의 하드코딩 SQL로 적용한다.

### 5.3 렌더러 — `PdfPageRasterizer`

- 의존성: `pdfjs-dist`(legacy Node 빌드) + `@napi-rs/canvas`(prebuilt, apt 불필요). `backend/package.json`에만 추가.
- 입력: PDF Buffer, 페이지 번호(1-base). 출력: PNG Buffer, `{ width, height }`.
- 스케일: 페이지 폭이 약 1240px이 되도록(A4 150dpi 상당). 상한 4MB, 초과 시 스케일 0.75로 재시도.
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
- 검증 실패 → `failed_attempts++`; 5회 도달 시 `locked_at = now`, 30분 잠금(제공기록지 상수 재사용). 잠금 중엔 `locked` 상태 반환.
- 성공 → `accessToken`(32바이트 랜덤) 발급, 해시 저장, `verified_at` 기록. accessToken 유효기간은 링크 만료와 동일.
- 만료·비활성 토큰은 status에서 `expired`/`revoked`로 구분해 산모에게 "새 링크를 요청해 주세요" 안내.
- 속도 제한: 공개 엔드포인트 3개 모두 제공기록지 컨트롤러와 같은 IP 기반 throttle.

### 5.5 백엔드 API

| 메서드 | 경로 | 가드 | 응답 |
|---|---|---|---|
| POST | `/receipt-links/send` | Jwt + Tenant + 발신 승인(`ensureApproved`) | `{ tokenId, expiresAt, messageLogId }` 또는 400 `{ code: <스킵 사유> }` |
| GET | `/receipt-links/:token/status` | 공개, throttle | `{ state, verified, expiresAt }` |
| POST | `/receipt-links/:token/verify` | 공개, throttle | `{ accessToken, expiresAt }` / 401 / 423(locked) / 410(expired) |
| GET | `/receipt-links/:token/image?download=0\|1` | 공개 + `X-Receipt-Access-Token` | PNG 스트림 / 401 / 410 |

수동 발송 요청 본문은 `{ documentId }`. 백엔드가 문서의 `clientId`로 산모를 찾는다(문서에 산모가 연결되지 않았으면 `no_contract_document` 대신 `document_not_linked`).

### 5.6 m.admin — 산모 공개 페이지

- 라우트 `mobile/src/app/(public)/receipt/[token]/page.tsx`, BFF `mobile/src/app/api/receipt/[token]/{status,verify,image}/route.ts`.
- `middleware.ts` PUBLIC_ROUTES에 `/receipt`, `/api/receipt` 추가.
- 화면 상태: `loading` → `verify`(생년월일 입력, 잘못된 입력 횟수 표시) → `image`(이미지 + "이미지 저장") → `expired` / `locked` / `not_found`.
- 쿠키: `receipt_access_{tokenId}` HttpOnly, SameSite=Lax, 만료는 링크 만료와 동일.
- **화면 목업(사용자 수정본, 2026-09-03 확정):** https://claude.ai/code/artifact/b8525136-d170-4aae-a635-be51a0f83770 — 제공기록지 공개 페이지와 같은 비주얼(파랑 `#004aad` 상단바 + 진행 막대, 12px 라운드 입력, 굵은 파랑 버튼, 시스템 고딕). 목업에서 확정된 카피·구성:
  - 상단바: 제목 "본인부담금 영수증", 지점명, 단계 크럼("1단계 · 본인 확인" / "2단계 · 영수증 저장"), 진행 막대 50% → 100%.
  - `verify`: 제목 "산모님 본인 확인", 설명 "본인부담금 영수증은 산모님 본인만 열람하실 수 있습니다. 계약 시 등록하신 생년월일을 입력해 주세요.", 라벨 "산모 생년월일", placeholder "예) 940315", 보조문구 "주민등록번호 앞 6자리", 버튼 "확인하기", 안내 박스 "입력하신 생년월일은 본인 확인에만 사용되며 저장되지 않습니다. 확인 후 영수증 이미지를 바로 내려받으실 수 있습니다." **확인 전에는 산모 이름을 노출하지 않는다.**
  - 불일치: 입력 테두리 오류색, 메시지 "생년월일이 일치하지 않습니다. 남은 횟수 N회", 버튼 "다시 확인하기", 경고 박스 "5회 연속 틀리면 30분 동안 확인이 잠깁니다. 계약서에 적힌 산모님 생년월일과 같은지 확인해 주세요."
  - `image`: 제목 "{산모명} 산모님 영수증" + "확인 완료" 칩, 영수증 PNG, 버튼 "이미지 저장"(다운로드 아이콘). 별도 저장 방법 안내 문단은 두지 않는다.
  - `expired`: 시계 아이콘, 제목 "링크 유효기간이 지났습니다", 설명 "영수증 링크는 문자 발송일로부터 30일간 열어보실 수 있습니다. 영수증이 다시 필요하시면 인천 아이미래로에 연락 주세요." 전화 버튼·전화번호는 두지 않는다.
  - 모든 화면 하단 공통 문구 "이 링크는 발송일로부터 30일간 유효합니다." **연락처(전화번호)는 어느 화면에도 표시하지 않는다.**

### 5.7 관리자 UI — 데스크톱 + 모바일 동일 적용

공통 계약: 같은 API, 같은 확인 흐름(수신 번호·메시지 미리보기 → 발송 → 결과 토스트), 같은 사유 라벨 맵(`packages/shared`).

- **frontend**: `shared-document-preview-dialog.tsx` 푸터의 "영수증" 버튼 옆에 "영수증 링크 보내기". `ContractDocumentPreviewModal`이 `onSendReceiptLink` 콜백을 넘긴다. 노출 조건은 문서에 `clientId`가 있을 때(완료 여부 무관). 기존 "영수증" 다운로드 버튼의 완료 게이트는 유지.
- **mobile shell**: `(shell)/contracts/page.tsx`의 영수증 다운로드·공유 액션 옆에 같은 액션. 확인은 바텀시트 스타일.
- 확인 다이얼로그 내용: 수신 산모 이름·번호, 렌더링된 메시지 미리보기(URL 자리는 "발송 시 생성됨" 표시), 발송 버튼. 성공 시 만료일 토스트. 400 사유는 라벨 맵으로 안내(예: "바우처 산모가 아닙니다", "산모 생년월일이 등록되지 않았습니다").
- 트리거 규칙 폼: `TRIGGER_TEMPLATE_MESSAGE_FALLBACKS`, `TEMPLATE_LABELS` ×2에 새 키 추가(exhaustive Record). 드롭다운·미리보기는 데이터 드리븐이라 자동 노출.

### 5.8 자동 완료 유예일 7일

- `DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.graceDays: 0 → 7`.
- 정책 테스트 경계: 종료일+6일 미대상, +7일 대상.
- 일회성 SQL 패치: 설정은 `system_setting(key, value)`에 키 `branch:{branchId}:contract_automation:auto_finalize`, 값은 JSON 문자열로 저장된다(`system-setting.service.ts:46`). 패치 SQL(database-patches 워크플로, 하드코딩):
  ```sql
  UPDATE system_setting
  SET value = jsonb_set(value::jsonb, '{graceDays}', '7', true)::text,
      updated_at = now()
  WHERE key LIKE 'branch:%:contract_automation:auto_finalize';
  ```
- UI 기본값 표시도 7로 맞춘다.
- 기준일은 현재처럼 계약서 문서의 종료일. 메시지 `SERVICE_END`의 `client.endDate`와는 별개 기준을 유지한다(둘 다 기존 기준).

### 5.9 정리 스윕

매일 1회 크론: `expires_at < now - 7일`인 토큰의 Storage 객체 삭제 후 행은 유지(감사용, `storage_path = null`). 재발급으로 revoke된 토큰의 PNG도 같은 스윕에서 정리.

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

**e2e(mobile Playwright).** 공개 페이지 입력 → 이미지 표시 → 저장 버튼 응답 헤더 → 만료·잠금 화면. shell 계약 페이지 발송 액션 → 확인 시트 → 성공 토스트.

**프론트.** 미리보기 푸터 버튼 노출 조건, 확인 다이얼로그, 사유 라벨. 트리거 규칙 폼에 새 템플릿 노출·미리보기.

**배포.** Lightsail Dockerfile 빌드에서 `@napi-rs/canvas` prebuilt가 node:20-bookworm-slim에서 로드되는지 확인. `env-check` 통과.

## 8. Non-goals

알림톡 버전, MMS 이미지 첨부, PDF 다운로드 옵션, 산모 앱 로그인 연동, 제공기록지 토큰 테이블과의 통합, 영수증 페이지 번호의 템플릿별 설정(현재 7 고정 유지), `SERVICE_END` 기준일 통일.
