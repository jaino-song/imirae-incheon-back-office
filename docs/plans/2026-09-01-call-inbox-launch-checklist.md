# 통화 인박스 런칭 체크리스트 (2026-09-01)

운영자용. Phase 1–4 코드는 `call-inbox-productionization` 통합 브랜치에 완료 — 이 문서는 남은 운영 절차 전부다. 순서대로 진행한다.

**Spec:** `docs/superpowers/specs/2026-09-01-call-inbox-productionization-design.md` · **Linear:** BJJ-231 (프로젝트 `통화 인박스`)
**주의:** BJJ-231 본문의 PR #272·Railway 언급은 6월 기준으로 낡았다 — 이 체크리스트가 우선한다 (프로덕션 백엔드는 현재 Lightsail).

## 0. 코드 반영 (개발자 확인 필요)

- [x] `call-inbox-productionization` → `dev` 머지 (머지 전 `git merge dev`로 최신 dev 반영·체크 재실행) — 2026-09-02 PR #597 `6269b89a6`
- [ ] CI green 확인 — 특히 **auth-e2e enforce leg** (`.github/workflows/backend-ci.yml:128-142`). 로컬에 docker가 없어 transitive-tenant-isolation 스펙의 런타임 실행은 CI가 유일한 검증 지점이다.
  - 2026-09-02 결과 (PR #597): 첫 실행(`15bdc5177`)에서 `enforce` leg가 이 브랜치와 무관한 **AI 에이전트 런타임**의 기존 결함(BJJ-301: e2e 가드 mock의 `setBranchId` 누락 + `agent_session`/`agent_action` 미고정 쓰기 5곳)을 잡아냈고, 같은 PR의 `b892c3aab`에서 수정 → **observe·enforce 두 leg 모두 green**. 통화 인박스·tenant 격리 스펙은 두 실행 모두 통과.
- [ ] **GitHub branch protection required check에 auth-e2e leg 추가 검토**: auth-e2e job이 matrix로 바뀌어 표시 이름이 `auth e2e · observe · …` / `auth e2e · enforce · …` 두 개가 됐다. 2026-09-02 확인 결과 dev의 required check는 `backend · type-check · lint · test`, `frontend · type-check · lint · test · build`, `type-check · lint · test · build` 세 개뿐이라 옛 auth-e2e 이름은 걸려 있지 않다(머지 막힘 없음). 두 leg가 이제 green이므로 required에 추가할지 결정할 것.
- [ ] 새 `backend call-inbox e2e · local stubs` job도 required check에 추가 검토 (`.github/workflows/backend-full-flow-ci.yml`)
- [x] release train으로 `preview` → `main` 승격 — 2026-09-02 후속 트레인: #600(main→dev 역병합) → #592(dev→preview `0d75fd287`, preview DB 패치가 `20260831185406_add_call_record_raw_transcript` 적용) → #606(preview→main `aa7ad0294`).
  - 중간에 발견·수정한 결함: `12fd60a38`(8/27) 이후 모든 릴리스의 `/health/ready`가 **항상 503**이었다 — `HealthController`의 prisma 파라미터가 `PrismaService | undefined` 유니언이라 DI 메타데이터가 `Object`로 지워지고 `@Optional()`이 `undefined`를 주입. #591 배포(`b51f63c75`)가 이 때문에 LightNode에서 롤백됐고, #602(main)·#603(dev)로 `@Inject(PrismaService)` 명시 + DI 회귀 테스트 추가. CI에는 `/health/ready`를 호출하는 잡이 없어 잡히지 않았다.
- [x] 프로덕션 배포 완료 확인 — 2026-09-02 `aa7ad0294` LightNode 폴백 호스트에 replace 성공(`deploy LightNode fallback backend` green), `https://api.babyjamjam.com/health/ready` 200. (프로덕션은 현재 Lightsail이 아니라 LightNode 폴백이 서빙; 이미지는 하나이고 리졸버가 대상을 고른다.)
  - 남은 운영자 항목: `database-patches.yml`의 `apply production database patches`는 GitHub `Production` 환경 승인 대기(`aa7ad0294` 실행, 적용 대상은 위 마이그레이션 1개). preview push의 `deploy Lightsail backend`가 AWS OIDC `AssumeRoleWithWebIdentity` 미승인으로 실패한다 — IAM 신뢰 정책이 `preview` ref를 허용하지 않는 것으로 보이며 릴리스 코드와 무관.

## 1. 환경변수

- [ ] `GEMINI_EXTRACTION_MODEL` — 선택값. 미설정 시 `gemini-2.5-flash`(기본값)로 refine·extract 둘 다 동작. 프로덕션에서 다른 모델을 쓰려면 이 키를 설정.
- [ ] `env.tpl`에 키가 추가되었으므로 로컬 `.env` 정리 후 **`env-backup backend/.env` 실행** (1Password 백업 동기화).
- [ ] `TENANT_ISOLATION_MODE`는 아직 `observe` 유지 — 전환은 §4의 번인 후.

## 2. n8n 활성화 (인천점)

- [ ] `docs/n8n/call-transcription-branch-template.json` import
- [ ] placeholder 4개 교체:
  | placeholder | 값 |
  |---|---|
  | `REPLACE_DRIVE_FOLDER_ID` | `1zh0dx1urgq9FOIwvj8YAsarmfi4CQAOD` (인천점 녹음 폴더) |
  | `REPLACE_DRIVE_CREDENTIAL_ID` | 기존 Drive 자격증명 |
  | `REPLACE_GEMINI_CREDENTIAL_ID` | 기존 Gemini 자격증명 |
  | `REPLACE_CALL_INGEST_TOKEN` | 인천점 토큰 평문 (발급 완료, row `053bf54c…`, 평문은 별도 보관 — BJJ-231) |
- [ ] 토큰 평문을 분실했다면: 설정 → 통화 수집 토큰 화면(신규 owner UI)에서 새 토큰 발급(평문 1회 노출) 후 기존 row 폐기. 백엔드 재배포 불필요.
- [ ] 워크플로 이름 「Call Transcription — 인천점」으로 변경 후 활성화. 기존 구버전(v1) 워크플로는 비활성 유지.

## 3. ⚠️ 첫 실행에서 반드시 확인 — gemini-3.5-transcribe 실 API 응답

템플릿의 **Build Webhook Payload 노드에 `TODO(BJJ-231)`로 표시된 파싱 경계**가 있다. Interactions API의 실제 응답 스키마를 레포에서 확정하지 못해, 노드는 후보 형태(`interaction.output_text` / `output_text` / `segments[]`)를 방어적으로 파싱하고 **모르는 형태면 조용히 지어내지 않고 throw**하도록 되어 있다. 오디오 요청 봉투도 `input.audio.file_uri`로 가정한 상태다.

- [ ] 테스트 녹음 1건으로 첫 실행 → n8n 실행 로그에서 Transcribe 노드의 **실제 응답 JSON** 확인
- [ ] 응답이 가정과 다르면: Build Webhook Payload 노드의 파싱 분기와 Build Transcribe Request의 봉투 키를 실제 스키마에 맞게 수정 (수정 후 `docs/n8n/` 템플릿에도 반영)
- [ ] 30분 초과 녹음의 화자분리 폴백(재시도 경로, `diarized:false`)도 한 번 통과 확인 가능하면 확인
- [ ] **`isExecuted` 지원 여부 확인 (첫 실행에서 같이 볼 것)**: Build Webhook Payload 노드는 `isExecuted`가 boolean이 아니면 조용히 `diarized:true`로 넘어가는 대신 **throw** 하도록 되어 있다(고의). 대신 이 n8n 버전이 `isExecuted`를 제공하지 않거나 노드 이름이 바뀌면 **모든 유입이 실패**한다. 첫 실행 로그에서 이 분기가 정상 동작하는지 반드시 확인할 것 — 템플릿은 아직 실제 n8n에서 한 번도 돌아간 적이 없다
- [ ] **폴백 조건 좁히기**: 현재 non-diarized 재시도는 primary 오류 종류를 구분하지 않고 발동한다 (일시적 429/503 포함 — README 트러블슈팅 표 참고). 실 API에서 >30분 diarization 한도 초과 오류의 형태(status/message)를 확인한 뒤, error 출력과 재시도 노드 사이에 IF 노드를 넣어 그 오류만 폴백하고 나머지는 빨간 실행으로 실패하게 좁힐 것 (수정 후 템플릿 JSON에도 반영)

## 4. 스모크 테스트 (인천점)

- [ ] 테스트 녹음 1건 투하 → **~2분 내** m.staff 통화요약 검토 대기에 표시
- [ ] 요약 품질 확인: 용어(산후도우미·조리원 등) 교정, 화자 역할(아이미래로/고객 등) 정확, 구조화 요약 4키(문의유형·고객정보·핵심내용·처리결과) 채워짐
- [ ] 실제 신규상담 1건 → [고객 등록]까지 통과 → 발송 내역에서 **인사문자 발송 확인** (억제 스위치 껐을 때)
- [ ] 문제 발생 시: `docs/n8n/README.md` 트러블슈팅 표 (401=토큰, 400=payload 형태, 200 duplicate=정상 멱등 재시도)

## 5. Tenancy enforce 전환 (별도 트랙 — 런칭과 독립)

`backend/README.md:390-432` 런북을 따른다. 요약:

> **웹훅 유입(ingestion) 경로는 enforce 안전 확인 완료 (2026-09-01). 단, 아래 ⚠️ 미해결 항목을 먼저 읽을 것.**
> `call_ingest_token`은 tenant 모델이고 웹훅 요청은 branchId가 없는 상태로 guard에 도달하므로, 예전 코드는 enforce에서 **모든 n8n 웹훅이 500**이 됐다. 지금은 `CallIngestGuard`가 토큰 조회를 system scope로 감싸고(TenantGuard와 동일한 패턴) 조회된 branchId를 tenant store에 심는다. 그리고 그렇게 branchId가 심어지면 격리 익스텐션이 `http_no_tenant`에서 멈추는 대신 **쓰기 인자 검사**를 시작하므로, 그 요청에서 도달 가능한 tenant 모델 쓰기는 전부 `where`에 branchId를 못 박아야 한다 — `CallProcessingService`의 claim/refine/finalize/fail 쓰기 4곳이 그래서 branch-pinned로 바뀌었다. 회귀 테스트: `backend/test/infrastructure/auth/call-ingest.guard.enforce.spec.ts` (enforce가 실제로 켜져 있음을 증명하는 CONTROL 케이스 포함 — call-inbox e2e는 `CallInboxModule`로 앱을 구성해 `TenantAlsMiddleware`가 설치되지 않으므로 이 부류의 결함을 **전혀 볼 수 없다**. enforce로 e2e를 돌려 22/22 green이 나와도 그것은 근거가 되지 않는다).
>
> ⚠️ **미해결 — enforce 전환 전 반드시 처리**: 직원용 통화 인박스 서비스(`backend/application/services/call-inbox.service.ts`)의 draft confirm/discard/patch 경로에는 branchId를 못 박지 않은 tenant 모델 쓰기가 **10곳** 남아 있다(`client_draft` 9곳 + `call_record` 1곳). 이들은 `TenantGuard`가 이미 branchId를 심어 둔 상태에서 실행되므로 enforce에서 `unpinned_write`로 던진다 — 이번 작업 이전부터 있던 문제이고, 유입 경로와 달리 아직 수정되지 않았다. 이 상태로 프로덕션을 enforce로 올리면 **직원이 통화 초안을 확정·삭제·수정하는 동작이 전부 실패한다.** §4 번인 이전에 별도 작업으로 처리할 것.
>
> ✅ **AI 에이전트 런타임 (BJJ-301) — PR #597 `b892c3aab`에서 수정 완료**: `prisma-agent-session.repository.ts`(appendMessages 2곳)와 `action-coordinator.service.ts`(supersedeProposedAction·rotateRequestDedupeKey·advanceUncertainAction)의 tenant 모델 쓰기 5곳을 branch-pinned로, `agent-runtime.e2e.spec.ts`의 가드 mock에 `setBranchId` 추가. CI enforce leg가 처음 잡아낸 결함이며 이제 green. 남은 enforce 선결 과제는 위 BJJ-300 하나.

- [ ] preview에서 tenant 위반 로그 번인 (observe 모드 로그 모니터링)
- [ ] staging `TENANT_ISOLATION_MODE=enforce` 전환
- [ ] **7일 무위반** 후 프로덕션 env만 전환 (코드 배포 불필요)

## 6. 마감

- [ ] Linear BJJ-231 체크박스 정리 후 완료 처리
- [ ] Linear 프로젝트 설명을 신규 아키텍처(3.5-transcribe + 백엔드 refine/extract)로 갱신
- [ ] 롤백 필요 시: n8n 워크플로 비활성화만으로 유입 중단 (녹음은 Drive에 남아 재처리 가능). enforce 롤백은 env를 `observe`로 되돌리면 끝.
