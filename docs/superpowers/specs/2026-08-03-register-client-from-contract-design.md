# 계약서 상세 more-menu → 고객 등록 (Register Client from Contract)

- **날짜**: 2026-08-03
- **상태**: 설계 승인됨 (사용자 확인)
- **브랜치**: `register-client-from-contract` (off `dev`)

## 배경 / 문제

고객 목록에는 "계약서 없는 고객 → 계약서 생성" 드롭다운 액션이 이미 있다
(`frontend/src/app/(protected)/clients/page.tsx:839-858` → `MaternityContractDialog`).
반대 방향이 없다: 계약서는 존재하지만 고객 DB에 고객이 없는 경우, 계약서 상세
패널에서 곧바로 고객을 등록할 수단이 없다.

백엔드에는 이미 완결된 자동 메커니즘이 있다:

- **자동 연결/자동 등록**: `LinkMirroredEformsignDocByPhoneUsecase`
  (`backend/application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase.ts`)
  는 완료 상태 계약서에 대해 전화번호 기준으로 기존 고객 연결 또는 (지점 설정
  `clientAutoRegistrationEnabled` 활성 시) 고객 자동 생성까지 수행한다.
- **고객 생성 시 역방향 연결**: `client.service.ts`의 `create()`가 생성 직후
  `linkContractDocumentsByPhone()`을 호출해 동일 전화번호의 계약서를
  `eformsign_doc.clientId` ↔ `client.eDocId` 양방향으로 연결한다.

따라서 미연결 계약서가 남는 경우는 갭 케이스다: 자동등록 꺼짐, 미완료 상태,
후보 추출 실패, 동일 전화번호 모호(ambiguous), 지점 미확정 등. 이 기능은 그
갭을 직원이 수동으로 메우는 UI다.

**불변식(사용자 확인)**: 어느 쪽이 먼저 등록되든 전화번호 조회로 즉시 연결된다.
연결된 계약서에서는 이 메뉴 항목 자체가 보이지 않아야 한다.

## 결정 사항 (사용자 답변)

1. **폼 방식**: 기존 `ClientFormDialog`(4단계) 재사용, 계약서에서 프리필.
2. **중복 처리**: 별도 UI 없음 — 동일 전화 고객이 있으면 계약서는 이미 연결돼
   있어야 하므로(불변식) 버튼이 표시되지 않는다.
3. **프리필 범위**: 계약 상세(detail payload)에서 최대한 추출.
4. **접근 방식**: A안 — 백엔드 후보 추출 엔드포인트 + `ClientFormDialog`
   prefill prop (추출 로직 단일 출처 유지).

## 설계

### UX 흐름

1. 산모 계약서 상세 패널 more-menu(현재 "재요청"/"삭제",
   `frontend/src/app/(protected)/contracts/page.tsx:1805-1843`)에
   **"고객 등록"** 항목 추가.
2. 표시 조건: `documentClientSummary?.clientId == null`
   (`EformsignDocClientSummary`, 요약이 로드된 상태에서 미연결일 때만).
3. 클릭 → 후보 조회(`GET .../client-candidate`) → `ClientFormDialog`가
   생성 모드 + 프리필 상태로 오픈.
4. 등록 성공 → 백엔드가 전화번호로 계약서 자동 연결 → 프론트는 문서
   클라이언트 요약·문서 목록/상세 쿼리 무효화 → 메뉴 항목이 사라지고
   상세 패널에 고객명이 표시된다.

### 백엔드 (신규 1개, 기존 변경 없음)

- **신규 엔드포인트**: `GET /eformsign/documents/:documentId/client-candidate`
  - 저장된 `eformsign_doc.detailPayload`에
    `extractEformsignContractClientCandidate()`
    (`backend/application/utils/eformsign-contract-client-candidate.ts:404`)를
    실행해 후보를 반환한다. 날짜(Date)는 ISO 문자열로 직렬화.
  - **폴백**: 추출 실패(payload 없음/파싱 불가) 시 문서 컬럼의
    `customerPhone`만 담은 최소 후보를 반환한다(`extracted: false`) — 폼은 항상
    열린다. 이름은 폴백하지 않는다: `customerName` 컬럼은 목록 표시용 일반
    성명 필드라 관리사/직원 이름일 수 있음 (리뷰 반영, 자동 등록 추출기의
    동일 경고 주석 근거).
  - 지점 스코프 가드·404 처리는 기존 문서 상세 엔드포인트와 동일한 권한 규칙.
- **연결 로직 변경 없음**: 고객 생성 경로의 기존 phone-link가 연결을 담당한다.
  별도 연결 API를 만들지 않는다. `eDocId`를 생성 DTO로 직접 밀어넣지 않는다
  (문서 `clientId`와 무관하게 한쪽 포인터만 생기는 비정합 상태 방지 —
  phone-link 경로가 양방향을 정합성 있게 세팅한다).

### 프론트엔드

- **more-menu 항목**: "고객 등록" DropdownMenuItem — 기존 항목과 동일 패턴,
  data-component 네이밍 컨벤션 준수.
- **후보 조회 훅**: `useContractClientCandidate(documentId)` — useQuery,
  다이얼로그 오픈 요청 시에만 `enabled`.
- **`ClientFormDialog` 변경**: 새 prop `prefill?: Partial<ClientFormData>`.
  기존 `client` prop은 수정 모드를 트리거하므로 재사용하지 않는다. `prefill`은
  `client == null`(생성 모드)일 때만 초기값으로 사용. 후보 → 폼 필드 매핑 시
  날짜 포맷 정규화(`formatDateForInput` 등 기존 헬퍼) 적용.
- **성공 후**: 문서 클라이언트 요약 쿼리 + 문서 목록/상세 쿼리 무효화.
- **안내 문구 1줄**: "전화번호를 변경하면 이 계약서와 자동 연결되지 않을 수
  있습니다" (연결이 전화번호 기반임을 명시).

### 엣지 케이스

| 상황 | 처리 |
| --- | --- |
| 후보 추출 실패 | 이름/전화 폴백만 프리필된 폼 오픈 (기능 차단 없음) |
| 동일 전화 고객이 이미 존재 | 불변식상 계약서가 이미 연결됨 → 버튼 미표시, 별도 처리 없음 |
| 등록 후 전화번호 불일치로 연결 실패 | 쿼리 무효화 후에도 버튼이 남아 미연결 상태를 즉시 인지 가능 |
| 서비스 제공기록지 문서 | 대상 아님 — 이 메뉴는 산모 계약서 섹션에만 존재 |

### 테스트

- **백엔드**: 후보 엔드포인트 유닛 테스트 — 정상 추출 / 폴백 / 404 / 지점
  스코프.
- **프론트**: 타입체크 + 기존 계약서 페이지 테스트 패턴에 맞춘 메뉴 표시
  조건·프리필 매핑 검증.

## 비범위 (Non-goals)

- 추출 유틸의 `packages/shared` 이동 (C안 — 별도 리팩토링으로 미룸).
- 기존 고객에 계약서를 수동 연결하는 UI (불변식상 불필요).
- 자동 등록 정책(`clientAutoRegistrationEnabled`) 변경.
- 직원(caretaker) ID 자동 매칭, `areaId` 추출 — 계약서에 구조화된 데이터 없음.
