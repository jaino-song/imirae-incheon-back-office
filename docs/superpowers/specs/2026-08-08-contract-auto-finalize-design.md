# 계약서 자동 검토 완료 스케줄러 — 설계

승인일: 2026-08-08 (사용자 승인, 세션 대화)

## 목적

제공기관 검토(070) 단계에 머무는 산모신생아 계약서를 서비스(계약) 종료일 당일
KST 17:00에 자동으로 검토 완료 처리한다. 스케줄러는 durable document job을 등록하고,
관리자는 모달을 기다리지 않고 contracts 페이지의 `전자문서 처리중` StatMini에서 진행
상태를 확인한다.

## 결정 사항 (사용자 확답)

1. **백로그 제외** — 활성화 기준일(`CONTRACT_AUTO_FINALIZE_SINCE`, YYYY-MM-DD) 이전에
   종료된 문서는 영구 제외. 배포 시 그날 날짜를 env에 넣는다.
2. **재시도 총 3회** — 실패 시 다음 17:00 실행에서 재시도, 3회 소진 시 방치하고 브랜치 사용자
   알림(알림벨) 발송. 대시보드에 검토 필요 계약서 목록을 노출한다.
3. **종료일을 읽지 못하는 문서** — 건너뛰고 경고 로그만 남긴다 (수동 처리 대상으로 잔존).

## 구성

### 스케줄러 (backend)

`ContractAutoFinalizeSchedulerService` — `service-record-finalization-scheduler` 패턴.

- `@Cron("0 17 * * *", { timeZone: "Asia/Seoul" })` + `SchedulerExecutionGuard`.
- kill-switch: `CONTRACT_AUTO_FINALIZE_ENABLED === "true"` 일 때만 동작 (기본 꺼짐).
- 큐 접수 gate: `EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED === "true"`일 때만 등록.
- 후보 선정 (로컬 DB만):
  - `documentKind = "contract"`, `statusType = "070"`, `autoFinalizeAttempts < 3`
  - 종료일: 저장된 `detailPayload`에서 기존 `extractEformsignContractEndDate` 헬퍼로 추출
  - 자격: `SINCE <= endDate <= today(KST)` — "9일 종료 → 9일 17:00 처리". 스케줄러 장애로
    당일 실행을 놓친 문서는 다음 실행에서 회수한다.
  - 종료일 추출 실패 → skip + warn
- 실행: 문서당 `EformsignDocumentJobService.enqueueFinalizeDocument(...)`를 순차 호출하고,
  `EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED === "true"`인 worker가 durable job을 claim하여
  `FinalizeDocumentHeadlessUsecase`를 실행한다. provider 작업은 기존 전역 동시성 상한과
  문서별 active-key를 유지하고, 개별 큐 등록 실패는 다음 문서 처리를 막지 않는다.
- 실패 시 `autoFinalizeAttempts += 1`, `autoFinalizeLastError` 기록. 3회째 실패 직후
  `notificationService.sendToBranchUsers(branchId, …, { dedupe: { type: "contract-auto-finalize-failed", documentId } })`.
- 성공 시 카운터 리셋 불필요 — 완료되면 070을 벗어나 쿼리에서 빠진다.

### 데이터 (migration)

`eformsign_doc`에 컬럼 3개 (nullable/default, 무중단):

- `autoFinalizeAttempts Int @default(0)` / `auto_finalize_attempts`
- `autoFinalizeLastAttemptAt DateTime?` / `auto_finalize_last_attempt_at`
- `autoFinalizeLastError String?` / `auto_finalize_last_error`

승격 시 database-patches 워크플로(하드코딩 SQL) 규약을 따른다.

### 대시보드 (backend + frontend)

- `GET /eformsign-docs/review-needed-contracts` — 검토 필요(070) 계약서 전체(SINCE 무관) +
  자동 완료 상태(`attempts`, `lastError`, `lastAttemptAt`, 종료일, 고객명).
- Next proxy route + 대시보드 "검토 필요 계약서" 카드: 고객명·종료일·상태 배지
  (대기 / 재시도 n회 / 자동 완료 실패 — 수동 확인 필요), 클릭 시 `/contracts?documentId=…`.
- contracts 페이지가 `?documentId=`를 읽어 해당 문서를 자동 선택하도록 딥링크 갭을 메운다
  (알림이 이미 이 URL 형식을 쓰고 있으나 프론트 미구현 상태였음).

### 테스트

- 자격 판정 순수 함수: 날짜 경계(종료일 당일 포함·미래 제외), 누락 실행 회수, SINCE 경계, 종료일 누락,
  소진 제외.
- 스케줄러 유닛: env 꺼짐 시 무동작, 실패 카운트 증가, 3회째 알림 정확히 1회(dedupe),
  개별 실패가 배치를 중단하지 않음.

## 운영 체크리스트 (배포 시)

- Lightsail Production `backend.env`에서 `SCHEDULERS_ENABLED=true`의 단일 소유자를 먼저 확인한다.
- Production backend에 `EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED=true`를 먼저 적용해 worker가
  안전하게 drain 가능한지 확인한다.
- 이어서 `EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED=true`,
  `CONTRACT_AUTO_FINALIZE_ENABLED=true`, `CONTRACT_AUTO_FINALIZE_SINCE=<배포일>`을 적용한다.
- Production frontend의 Vercel build 환경에
  `NEXT_PUBLIC_FEATURE_EFORMSIGN_DOCUMENT_JOBS=true`를 설정하고 재배포한다. 이 값은 빌드
  시점에 번들에 포함되므로 환경변수만 추가하고 기존 배포를 그대로 두면 활성화되지 않는다.
- Preview는 `SCHEDULERS_ENABLED=false` 정책 때문에 자동 완료와 queue worker를 활성화하지 않는다.
- DB 패치: 컬럼 3개 SQL 적용 (앱 배포보다 먼저 — eformsign_doc 컬럼 승격 창 메모리 참고).
