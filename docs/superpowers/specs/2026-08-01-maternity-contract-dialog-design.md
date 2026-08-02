# 산모 계약서 생성 다이얼로그 — 설계 스펙

- **날짜**: 2026-08-01
- **상태**: 사용자 승인 완료 (브레인스토밍 세션)
- **배경**: 안현주처럼 계약서 생성이 누락된 특수 케이스 고객은 정보가 이미 고객 레코드에 거의 다 있음에도 contracts 페이지에서 산모 계약서 폼을 처음부터 작성해야 한다. 고객 상세 패널에서 버튼 한 번으로 계약서 생성을 시작할 수 있게 한다.

## 요구사항 (확정)

1. 고객 상세 패널 드롭다운 메뉴(수정 아래)에 **산모 계약서 생성** 항목 추가.
2. 항목은 **계약서가 없는 고객에게만 노출** ("계약서 필요" 배지와 동일 판정: `documentStatus`/`eDocId` 기반).
3. 클릭 시 모달이 열리고, **기존 5단계 계약서 작성 위저드**(이용자 정보 → 제공인력 정보 → 바우처 정보 → 계약 정보 → 전자문서 생성)를 그대로 재사용. 고객 데이터로 전부 프리필된 상태에서 유저가 단계를 넘기며 값을 확인/수정한다.
4. **본인부담금 수령일(paymentDate)은 프리필하지 않는다** — 시작일과 다르므로 유저가 직접 입력해야 함. 기존 4단계 필수값 검증(`isStep4Valid`)이 입력을 강제한다.
5. **출산일(실제 분만일)** 필드를 풀스택으로 추가하고 위저드 1단계에서 **선택 입력**으로 받는다. 고객 레코드에 저장하며, eformsign 문서에는 넣지 않는다.
6. 모달 컨테이너는 `ClientFormDialog`와 동일한 Dialog 셸/스타일 (사용자 지정: `desktop_clients_autocomplete_client-form-dialog` 계열 컨테이너).

## 설계

### 1. 진입점 — 고객 드롭다운 메뉴

`frontend/src/app/(protected)/clients/page.tsx:827-870`의 드롭다운에 항목 추가:

- 위치: 수정 바로 아래.
- 아이콘: `FileSignature` (lucide).
- 노출 조건: 해당 고객에게 계약 문서가 없을 때만. "계약서 필요" 배지와 동일한 판정 로직 재사용 (`getClientDocumentStatusFallback` / `documentStatus`·`eDocId` 기준). 중복 발송 사고를 원천 차단한다.
- 클릭 핸들러: 선택된 고객을 state에 담아 새 다이얼로그를 연다.

### 2. 모달 — `MaternityContractDialog` (신규)

- 위치: `frontend/src/components/app/clients/MaternityContractDialog.tsx`.
- `ClientFormDialog.tsx`와 동일한 Dialog 셸/스타일 컨벤션 사용.
- 헤더: 타이틀("산모 계약서 생성") + 기존 5단계 스테퍼(`CONTRACT_CREATION_STEPPER_STEPS`) — contracts 페이지가 패널 헤더에 스테퍼를 렌더하는 방식과 동일하게 controlled `activeStep`으로 렌더.
- 본문: `ContractCreationForm`을 `renderLayout` prop으로 임베드 (`ContractCreationFormLayoutParts` = content/footer/footerClassName). contracts 페이지(`contracts/page.tsx:813-818`)의 기존 임베드 패턴을 그대로 따른다.
- `data-component` 네이밍: 호출 컨텍스트 기준 `desktop_clients_maternity-contract-dialog` 계열 (data-component-naming 컨벤션 준수).
- 닫기: 위저드의 기존 `onClose`/세션 상태와 연동. 생성 진행 중 닫기 방지는 위저드 기존 동작을 따른다.

### 3. 프리필 — `initialClient` prop

`ContractCreationForm`에 `initialClient?: Client` prop 추가:

- 마운트 시 기존 `handleClientSelect(client.id, client)` 로직 실행 → 이름·연락처·생년월일·주소·출산예정일·바우처 유형/기간·금액 3종·시작/종료일·담당 관리사(1·2)까지 전부 프리필.
- **단, 프리필 직후 `paymentDate`를 비운다.** 현재 코드(`ContractCreationForm.tsx:597`)는 `paymentDate`를 시작일로 자동 세팅하는데, `initialClient` 모드에서는 이 자동 세팅을 건너뛴다. contracts 페이지의 기존 동작(자동 세팅)은 변경하지 않는다.
- `initialClient` 모드에서는 1단계의 산모님 성함 선택기(autocomplete)를 해당 고객으로 **고정**(읽기 전용) — 다른 고객으로 전환 불가.

### 4. 출산일(birthDate) — 풀스택 추가

- **DB**: `client` 테이블에 `birth_date DATE NULL` 컬럼. database-patches 운영 방식(하드코딩 SQL 패치)으로 추가. `migrate deploy` 금지. 승격 시 프로덕션 수동 적용 필요.
- **Prisma**: `backend/prisma/schema.prisma`의 `client` 모델(line 78~)에 `birthDate DateTime? @map("birth_date") @db.Date` 추가 (`dueDate` 패턴과 동일).
- **백엔드**: `backend/interface/dto/client.dto.ts`의 조회/생성/수정 DTO에 `birthDate?: string | null` 추가, 서비스·리포지토리 매핑 반영 (`dueDate` 처리 경로를 그대로 따른다).
- **프론트**: `frontend/src/features/clients/types/index.ts`의 `Client`에 `birthDate: string | null` 추가. 위저드 1단계(이용자 정보)에 출산일 입력(YYMMDD, 출산 예정일 옆) — **선택 입력**. 계약 생성 시 기존 고객 업데이트 경로(`ContractCreationForm.tsx:739-759`)와 자동 등록 경로에 포함해 저장.
- eformsign `ContractDataDto`에는 **넣지 않는다** (템플릿에 해당 필드 없음).
- 참고: `client-birth-date` 워크트리(커밋 없음)의 예정 작업과 겹치면 그쪽이 이 필드를 재사용.

### 5. 완료 흐름 & 에러 처리

- 5단계 전자문서 생성은 기존 headless 디스패치(`eformsignApi.dispatchHeadless`), 진행 표시(SSE), 중복 발송 가드를 그대로 사용. 신규 로직 없음.
- 성공 시: 기존 `onSuccess` → 고객 목록 refetch → `documentStatus` 갱신으로 메뉴 항목 자동 소멸 → 다이얼로그 닫힘.
- 실패 시: 위저드 기존 에러 표시를 그대로 사용.

### 6. 검증

- **컴포넌트 테스트**: `initialClient` 프리필 동작 (전 필드 채워짐 + `paymentDate` 비어 있음 + 선택기 고정).
- **백엔드 테스트**: `birthDate` 영속화 (생성/수정 경로).
- `npm run type-check` / lint 통과.
- 수동 확인: 계약서 없는 고객 → 메뉴 노출 → 프리필 확인 → 수령일·출산일 입력 → 전자문서 생성까지 (dev 환경, localhost).

## 비범위 (Non-goals)

- contracts 페이지의 기존 플로우 동작 변경 (paymentDate 자동 세팅 포함).
- eformsign 템플릿/문서 필드 추가.
- 계약서가 이미 있는 고객의 재발송 플로우 (기존 contracts 페이지 사용).
- `ClientFormDialog` 자체 수정.
