# DevOps & Deployment Rules — 브랜치·CI·DB 패치·배포·롤백 규칙

> 대상: 이 저장소의 코드를 어떤 환경에든 내보내는 모든 작업 (사람·에이전트 공통).
> 각 규칙에는 그 규칙을 만든 사고(incident)나 실측 날짜가 붙어 있다. 사고가 없는 규칙은 선호이지 규칙이 아니므로 여기 두지 않는다.
> 저장소 밖(GitHub 브랜치 보호, Vercel 프로젝트 설정, Railway/Lightsail 환경 변수)에서만 확인 가능한 사실은 **[외부]**로 표시했다. 그 값은 코드만 봐서는 알 수 없으니 바꾸기 전에 반드시 실측한다.

**기준 문서 (canonical reference):**

| 주제 | 파일 |
|---|---|
| 릴리스 흐름 개요 | `README.md` → "Deployment and release flow" |
| 백엔드 CI·이미지 빌드·Lightsail 배포 잡 | `.github/workflows/backend-ci.yml` |
| Lightsail 운영 계약 (OIDC, SSM, 롤백) | `backend/deploy/lightsail/CI_AUTOMATION.md`, `backend/deploy/lightsail/README.md` |
| 수동 Lightsail 운영 | `.github/workflows/lightsail-operations.yml`, `backend/deploy/lightsail/lightsail-cli.sh` |
| DB 패치 | `.github/workflows/database-patches.yml`, `backend/prisma/migrations/`, `backend/prisma/scripts/` |
| 테넌트 격리 롤아웃 | `backend/README.md` → "TENANT_ISOLATION_MODE" |
| 런치 체크리스트 예시 | `docs/plans/2026-09-01-call-inbox-launch-checklist.md` |
| env 매니페스트 | `backend/env.tpl`, `frontend/env.local.tpl`, `~/.agents/bin/env-check` |

---

## 0. 한 줄 요약

**dev 병합이 곧 릴리스일 수 있다고 가정하고, 스키마는 코드보다 먼저, 플래그는 코드보다 나중에 내보낸다.**

---

## 1. 브랜치와 환경

| 브랜치 | 역할 | 프론트(Vercel) | 백엔드 | DB 패치 잡 |
|---|---|---|---|---|
| `dev` | 통합 대상. 모든 feature/fix PR의 목적지 | 빌드 안 함 (2026-08-06부터, [외부] Ignored Build Step) | 배포 없음. 로컬 `localhost:3001`로 테스트 | `apply-dev` (prisma 경로 push 시) |
| `preview` | 릴리스 후보 검증 | preview 빌드 | Lightsail `preview` 컨테이너 (`preview.api.babyjamjam.com`), push 시 자동 | `apply-preview` |
| `main` | 프로덕션 | production 빌드 (`admin.babyjamjam.com`, `m.admin.babyjamjam.com`) | **AWS Lightsail** `production` 컨테이너 (`api.babyjamjam.com`), push 시 자동(같은 커밋의 `apply-production` 패치 성공 뒤). 장애 시 **LightNode VPS Fallback Server**(API-only warm standby) | `apply-production` |

규칙:

1. **`main`에 직접 커밋 금지.** 승격은 `dev → preview → main` PR로만. (`README.md`)
2. **preview/main 룰셋은 linear history + Vercel deploy 체크 필수** [외부]. squash 승격은 다음 승격에서 대량 add/add 충돌을 만든다 (2026-07 실측, 79건). 승격 PR은 merge commit으로.
3. **dev 호스팅은 없다.** dev Railway는 2026-07-16 삭제, dev Vercel 빌드는 2026-08-06 제거. `*-dev.up.railway.app`, `dev.m.admin.*` 같은 URL을 전제로 한 설정·안내는 전부 오류다.
4. **preview 백엔드는 프로덕션과 같은 Supabase DB를 본다** (2026-07-17 Railway env 실측: NODE_ENV 외 53개 값 동일). preview 승격 = prod 데이터에 적용이라고 전제한다. 진짜 격리가 필요하면 preview 전용 DB 분리가 선행 과제다.
5. **프로덕션 백엔드 = AWS Lightsail (2026-09-02 사용자 확인).** Railway는 더 이상 프로덕션 런타임이 아니다. 백업은 **LightNode VPS의 Fallback Server**(`backend/deploy/fallback-server/`): API-only warm standby로, 프로덕션 DB만 바라보며 스케줄러·자동완료·eformsign 잡·Aligo가 Compose에서 하드 비활성화돼 있다. 트래픽 전환은 Sentry Uptime 알림 → 컨트롤러 → Vercel DNS `api`/`A` 레코드 한 건의 **AWS → Fallback 일방향** 변경이며, 자동 failback은 없다. 상태와 절차는 `backend/deploy/fallback-server/README.md`, `CONTROLLER_OPERATIONS.md`, `LIGHTNODE_TEMPORARY_FALLBACK.md`, `VERCEL_DNS_FAILOVER.md`가 기준이다. **어떤 시점에도 `SCHEDULERS_ENABLED=true`인 런타임은 하나여야 한다** (중복 발송 위험, §5 참고).

---

## 2. PR 게이트 (CI)

PR을 `dev`에 열면 아래 워크플로가 돌고, 필수 체크는 GitHub 브랜치 보호에 있다 [외부].

| 워크플로 | 잡 | 무엇을 막나 |
|---|---|---|
| `backend-ci.yml` | `verify` | type-check, lint, **migrations drift guard** (`prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code`), 단위 테스트, 배포 자동화 계약 테스트 (`backend/deploy/**/*.test.sh`) |
| `backend-ci.yml` | `auth-e2e` (matrix `tenant_isolation_mode: observe, enforce`) | 인증 e2e. `enforce` leg는 테넌트 격리 위반을 실패로 만든다 |
| `backend-full-flow-ci.yml` | `full-flow`, `call-inbox` | 전체 흐름 e2e, 워크플로 계약 |
| `frontend-ci.yml` / `mobile-ci.yml` | `verify` | type-check, lint, `lint:ui-architecture` **baseline 게이트**, e2e 문자열 drift, build |
| `shared-contracts-ci.yml` | `shared-contracts` | `@babyjamjam/shared` type-check·테스트 |
| `security.yml` | `osv` | lockfile 취약점 (fail-on-vuln) |
| `playwright.yml` | `test` | 수동/PR: 실제 백엔드 대상 인증 라이프사이클 e2e |

규칙:

1. **로컬 최소 검증은 README의 목록 그대로.** `pnpm lint`, `pnpm lint:ui-architecture`, 앱별 `type-check`, `pnpm test`, `pnpm build`. CI가 잡아줄 것을 기다리지 않는다.
2. **`lint:ui-architecture` baseline은 늘어날 수 없다.** 새 위반은 실패. 파일을 정리했으면 `docs/design-system/ui-debt-baseline.json`에서 제거한다.
3. **preview push의 `deploy Lightsail backend` 잡이 빨간 것은 코드 문제가 아닐 수 있다.** 2026-08-30부터 AWS OIDC trust policy 오류(`Not authorized to perform sts:AssumeRoleWithWebIdentity`, PreviewDeployRole)로 실패 중. `gh run list --workflow=backend-ci.yml --branch=preview`로 `pull_request` 런과 `push` 런을 나눠 보고, `pull_request`가 green이면 PR은 정상이다. 수리는 IAM 쪽 별도 작업.
4. **CI 상태 조회에 `gh run list --commit <sha>`를 쓰지 않는다.** 실행이 있어도 빈 결과를 돌려준다 (2026-08-06 오보 사고). 다음을 쓴다:
   ```
   gh run list --branch <branch> --limit 6 --json headSha,name,status,conclusion \
     --jq '.[] | select(.headSha|startswith("<sha>")) | "\(.status)/\(.conclusion // "-") \(.name)"'
   ```
   잡이 `runner_name: ""`·`steps: 0`이면 러너 미배정(플랫폼 장애)이지 테스트 실패가 아니다.
5. **테넌트 격리 `enforce` leg가 red인 PR은 병합하지 않는다.** BJJ-301(2026-09-01)에서 에이전트 런타임이 enforce에서 깨지는 것을 이 leg가 잡았다.

---

## 3. 데이터베이스 변경

### 3.1 원칙

- **`prisma migrate deploy`는 어떤 원격 DB에도 돌리지 않는다.** 원격 `_prisma_migrations` 히스토리가 로컬 `prisma/migrations`(0_init 재베이스라인)와 diverged라 이미 적용된 변경을 재실행하려 든다 (2026-07-08 확인). CI의 `db:migrate:deploy`는 **일회용 CI DB**에만 쓴다.
- 원격 적용 경로는 두 가지뿐: (a) `database-patches.yml`의 하드코딩 스텝, (b) 수동 `psql`/`prisma db execute --url` + `prisma migrate resolve --applied`.
- 마이그레이션 SQL은 **재실행 안전(idempotent)** 해야 한다. 워크플로가 push마다 전 스텝을 다시 돌린다. `IF NOT EXISTS`, `DO $$ … pg_constraint 조회 … $$` 가드 필수. `RENAME CONSTRAINT`에는 `IF EXISTS`가 없으니 DO 블록으로 감싼다.
- 테이블 RENAME 시 PK·모든 FK·unique index 제약 이름까지 `<newtable>_<col>_fkey` 형태로 같이 RENAME해야 drift guard를 통과한다 (2026-07-16).

### 3.2 새 마이그레이션 PR 체크리스트

1. `backend/prisma/migrations/<ts>_<name>/migration.sql` 추가 + 검증 SQL(`prisma/scripts/verify-*.sql`)이 있으면 함께.
2. **`database-patches.yml`의 세 잡(`apply-dev`, `apply-preview`, `apply-production`) 전부에 스텝 배선.** preview 잡만 `./scripts/run-prisma-db-execute.sh` 래퍼를 쓴다.
   — 사고: PR #503(2026-08-08)이 migrations만 추가하고 배선을 빠뜨린 채 dev에 병합됨. 그대로 승격됐으면 새 Prisma 스키마가 없는 컬럼을 읽어 런타임 파손.
   — 검사: `git log`상 신규 migrations 디렉터리 ↔ `grep migrations/ .github/workflows/database-patches.yml` 대조. 승격 PR을 열기 전 필수.
3. 로컬에서 drift guard 재현: 빈 shadow DB(localhost:5432 `postgres`)에 `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code`.
4. 브랜치 스코프 모델을 건드렸으면 `pnpm run tenant:models:generate` 후 생성 파일 커밋 (`tenant-models.drift.spec.ts`가 실패한다).
5. 롤백 SQL을 `backend/prisma/scripts/`에 둔다 (예: `rollback-message-rename.sql`).

### 3.3 적용 순서 — 스키마가 코드보다 먼저

- **마이그레이션이 있는 변경은 dev 병합 전에 preview/production DB를 먼저 패치한다.**
  ```
  gh workflow run database-patches.yml --ref dev -f target=production
  gh workflow run database-patches.yml --ref dev -f target=preview
  ```
  `--ref dev`가 핵심이다. preview/main의 워크플로 사본에는 새 스텝이 없다. `apply-production`은 `if: always()`라 skip된 preview 잡에 막히지 않는다.
- `paths: backend/prisma/**` push 트리거만 믿지 않는다. 그 트리거는 해당 브랜치 환경만 패치한다.
- 사고: `eformsign_doc` 컬럼(PR #407, 2026-07-28). 앱은 배포됐는데 프로덕션 DB에 컬럼이 없던 하루 동안 호환 SELECT가 `templateId`를 null로 채워 **10분 중복 발송 가드가 조용히 무력화**됐다. 2026-07-29 11:52 수동 dispatch로 복구.
- 같은 유형: PR #616(2026-09-03). `backend-ci`가 `database-patches.yml`의 production 승인 대기와 무관하게 ~20분 만에 배포를 끝냈고, 새 코드가 아직 없던 `employee_schedule.terminated_at`/`scheduler_lease`를 조회해 데스크톱 목록이 500으로 빈 상태가 됐다.
- 승격 후 확인: `git show origin/main:.github/workflows/database-patches.yml | grep -c '<패치 이름>'`.
- **이 사고 이후 `backend-ci`는 `preview`/`main` push에서 같은 커밋의 `Database Patches` 런이 성공할 때까지 기다린다** (잡 `wait for database patches`, `backend/deploy/ci/wait-database-patches.sh`). `resolve-backend-deploy-target`(따라서 `deploy-lightsail`/`deploy-lightnode`도)이 이 잡 뒤에 걸린다. 2026-09-03 오너 결정으로 GitHub `Production` environment의 필수 리뷰어를 제거해 **production 패치도 preview와 같이 main push에서 자동 적용**된다. 따라서 정상 경로는 push → 패치 자동 적용 → (수 분 뒤) 배포 자동 이어짐이고, 패치가 실패하면 배포는 실행되지 않는다. 대기는 최대 150분이며(패치 런이 비정상적으로 오래 걸리는 경우), 초과 시 잡이 타임아웃으로 실패하고 패치를 고친 뒤 "failed jobs 재실행"으로 재개한다. 이 자동화의 전제는 §3.1의 멱등 SQL 원칙과 dev → preview → main 승격 열차에서 같은 패치가 먼저 두 번 실행된다는 점이다. `backend/prisma/**` 변경이 없는 push는 지연 없이 통과한다(패치 런이 없어도 됨을 diff로 판별).

### 3.4 프로덕션 수동 적용 함정 (2026-07-16 실측)

1. `DATABASE_URL="<prod>" pnpm exec prisma db execute --file …`는 **`backend/.env`의 DATABASE_URL(dev)에 덮여 dev에 적용된다.** 성공 메시지가 떠도 prod 미적용. 반드시 `--url "<prod>"` 또는 psql로 명시.
2. prod pooler(6543, transaction mode)로 DDL을 실행하면 hang/timeout. DDL은 **DIRECT_URL(5432, session mode)**로:
   ```
   { printf "SET lock_timeout='20s';\n"; cat migration.sql; } | psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -q
   ```
3. prod 조회 검증은 PrismaClient에 URL 명시 + 4~6회 retry (pooler 간헐 끊김).
4. prod DB URL은 `backend/.env.orig-prod-shared`에 있다. 로컬 `backend/.env`는 2026-07-28부터 dev Supabase(`ebiughoiebblasxwgxbe`)를 가리킨다. 프로젝트 id를 눈으로 확인하고 실행한다.
5. dev/production db-patches 잡은 GitHub 시크릿 부재로 "Check database secrets"에서 실패할 수 있다 [외부]. 그 경우 수동 적용만 가능하며, 적용 후 `prisma migrate resolve --applied <name>`으로 기록한다.

---

## 4. 백엔드 배포 (Lightsail)

`preview`/`main` push → `backend-ci.yml`이 `backend/Dockerfile.lightsail`로 **불변 커밋 이미지**(`ghcr.io/jaino-song/babyjamjam-admin-backend:<sha>`)를 빌드 → OIDC로 브랜치 스코프 역할을 얻어 **고정 SSM 문서**로 호스트에 그 이미지를 활성화. 호스트는 이미지를 빌드하지 않는다.

| 항목 | 규칙 |
|---|---|
| 승인 | 수동 승인 없음(2026-09-03). `main`/`preview` 모두 CI 통과 후 자동이며, 같은 커밋의 `Database Patches` 런이 성공한 뒤에만 배포 잡이 실행된다(§3.3). 과거 문서의 `approve-lightsail-production` 잡은 존재하지 않는다 |
| 자격 | OIDC trust policy가 preview↔`refs/heads/preview`, production↔`refs/heads/main`으로 고정. feature 브랜치는 환경을 참조해도 권한이 없다 |
| 검증 | 배포 잡은 SSM 결과의 `environment`/`current_tag`/`current_digest`가 요청과 정확히 일치해야 성공 처리 |
| 수동 운영 | `lightsail-operations.yml` (`status` / `deploy` / `operator-upgrade`, environment 선택) 또는 `backend/deploy/lightsail/lightsail-cli.sh` (gh CLI 인증 사용, 로컬 AWS 자격 불필요) |
| 롤백 | 호스트의 설치된 CI operator가 `previous-image-tag`로 되돌린다. 저장소의 `rollback.sh`는 **retired** — 직접 실행하면 거부한다. 롤백도 `lightsail-operations.yml`을 통해서만 |
| 헬스 | `GET /health`(liveness, 항상 200), `GET /health/ready`(DB `SELECT 1` + revocation 플래그, 실패 시 503). 배포 후 두 엔드포인트를 확인한다 |
| preview 스케줄러 | `backend.env`에 `SCHEDULERS_ENABLED=false`, `SERVICE_RECORD_AUTO_FINALIZE_ENABLED=false` 필수. deploy/rollback 스크립트가 fail-closed로 거부한다 |
| 시크릿 | 호스트 `/opt/babyjamjam/environments/<env>/backend.env`는 root 0600. 커밋 금지, 터미널에 전문 출력 금지 |

### 4.1 Fallback Server (LightNode VPS)

| 항목 | 규칙 |
|---|---|
| 역할 | API-only warm standby. 프론트 배포 아님. 호스트명 `api.babyjamjam.com`은 그대로 두고 DNS 소유권만 바뀐다 |
| 바인딩 | Fallback API `127.0.0.1:3101`, 컨트롤러 `127.0.0.1:3102` (`POST /sentry/uptime-alert`, `GET /health`만) |
| DB | 프로덕션 DB만. 활성화 전 **Production DB identity hash 게이트**(`approved-production-db-ref.sha256`) 통과 필수 |
| 비활성 기능 | 스케줄러, 자동완료, eformsign 문서 잡 intake/worker, unlocked reconcile, Aligo — Compose에서 하드 비활성화. 켜지 않는다 |
| 전환 | Sentry Uptime → Internal Integration webhook → 컨트롤러가 `VERIFYING` → `DNS_COMMITTING` 단계로 Vercel DNS `api`/`A` 레코드 1건을 AWS → Fallback 일방향 PATCH. 모호한 응답은 수동 reconcile |
| 복귀 | **자동 failback 없음.** AWS 복구 후 DNS 되돌리기는 수동 절차 (`VERCEL_DNS_FAILOVER.md`) |
| 사전 점검 | `lightnode-preflight.sh`, `NETWORK_PREFLIGHT.md`. 컨트롤러 arm/disarm은 `CONTROLLER_OPERATIONS.md` |
| 현재 상태 | README 기준: 컨트롤러 런타임·설치기·systemd·CLI 구현됨, **컨트롤러 미설치·미arm, 프로덕션 트래픽 미서빙**. 바뀌면 README와 이 표를 같이 갱신 |

Railway 관련 (역사·잔존 — 프로덕션 런타임 아님):

- Railway 배포 브랜치는 `DeploymentTrigger` GraphQL로만 바꿀 수 있다 (CLI·MCP에 필드 없음). 2026-07-29까지 **네 환경 모두 `dev`에서 배포**되던 것을 main/preview/dev로 교정했다. 변경은 다음 push부터 적용된다.
- Railpack 빌더는 빌드/런타임 이미지가 분리된다. 런타임 apt 패키지(Chromium 라이브러리 등)는 `RAILPACK_DEPLOY_APT_PACKAGES` 변수로, 변수 변경만으로는 리빌드되지 않으니 빈 커밋으로 트리거.
- `backend/railway.json`은 아직 커밋돼 있고 README 본문도 "Railway for the API"라고 적혀 있다. 둘 다 stale이다 — 정리 시 이 문서 §1-5와 같은 커밋에서 갱신한다. Lightsail `backend.env` 값의 출처가 Railway 환경 변수였다는 점만 역사로 남긴다.

---

## 5. 스케줄러·기능 플래그 (플래그는 코드보다 나중에)

플래그가 필요한 기능은 **코드 배포 → DB 패치 → 플래그 ON** 순서로 내보낸다. 플래그가 먼저 켜지면 없는 컬럼을 읽는다.

| 플래그 | 위치 | 규칙 |
|---|---|---|
| `SCHEDULERS_ENABLED` | Lightsail `backend.env` | production 런타임 **하나**만 true. preview는 항상 false |
| `CONTRACT_AUTO_FINALIZE_ENABLED`, `CONTRACT_AUTO_FINALIZE_SINCE` | 백엔드 env | 계약서 자동 검토완료 스케줄러(매일 17:00 KST). SINCE(YYYY-MM-DD)는 배포일 = 백로그 울타리, 없으면 에러 로그 후 no-op. 켜기 전 `eformsign_doc` 자동완료 컬럼 3개 패치(20260808000000) 선적용. 브랜치별 세부 설정은 DB(`system_setting`, `branch:<id>:contract_automation:auto_finalize`)이며 UI 계약서 → 자동화에서 편집 |
| `EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED` | 백엔드 env | 문서 잡 큐 수락. 위 스케줄러의 전제 |
| `SERVICE_RECORD_AUTO_FINALIZE_ENABLED` | 백엔드 env | 제공기록지 자동 완료. 로컬 실기기 테스트에도 필요 |
| `TENANT_ISOLATION_MODE` | 백엔드 env (`off`/`observe`/`enforce`, 기본 observe) | `observe` → 7일 무위반 → staging `enforce` + auth-e2e/full-flow → production `enforce`. 전환·롤백 모두 env 변경만, 배포 불필요 (`backend/README.md`) |
| `VALKEY_URL` | 백엔드 env | 미설정이면 6시간 eformsign 리컨사일 스윕이 **조용히 스킵**된다 (2026-08-01까지 그랬음). Railway 내부망은 `?family=0` 필요 |
| `MOBILE_SERVICE_RECORD_BASE_URL` | 백엔드 env | 미설정 시 프로덕션 URL. 로컬은 `start:dev` 래퍼가 LAN IP를 주입 |

플래그를 켠 뒤에는 **첫 실행 로그를 본다.** 예: `[Contract Auto Finalize]` 첫 17:00 실행, `[eformsign reconcile]` 스윕 `fetched=` 로그.

---

## 6. 프론트·모바일 배포 (Vercel)

- 저장소에 `vercel.json`이 없다. 어떤 브랜치가 빌드되는지는 **Vercel 프로젝트의 Ignored Build Step** [외부]이 유일한 통제점:
  ```sh
  case "$VERCEL_GIT_COMMIT_REF" in preview|main|legacy-production) exit 1 ;; *) exit 0 ;; esac
  ```
  **`exit 1` = 빌드 진행, `exit 0` = 스킵** (직관과 반대).
- git-linked 프로젝트가 **3개**(`babyjamjam-admin` frontend, `babyjamjam-admin-mobile` mobile, `babyjamjam-admin-legacy`)이고 같은 문자열을 공유한다. 브랜치를 켜고 끌 때 **셋 다** 고친다. API: `PATCH /v9/projects/{name}?teamId=…`의 `commandForIgnoringBuildStep`.
- dev 스코프 preview env var(frontend 19개, mobile 15개)는 **지우지 않는다.** dev 빌드를 되살릴 때 그대로 쓴다.
- `main` 병합 = 프로덕션 자동 배포 (`target: "production"`, 2026-07-28 실측). "수동 promote 필요"는 틀린 기록이었다. 프로덕션이 뒤처져 보이면 배포 방식보다 **`git log origin/main..origin/preview`로 승격 지연부터** 본다.
- Vercel preview URL은 SSO 보호라 직원이 열 수 없다. 외부 공개 페이지는 프로덕션 배포가 유일한 경로.
- 공개돼야 할 페이지·정적 파일은 `mobile/src/middleware.ts`의 `PUBLIC_ROUTES`에 있어야 한다. 누락 시 307로 튕기며 인증 쿠키까지 지운다 (2026-07-28 `/pdf.worker.min.mjs`).
- 반영 확인: Vercel `list_deployments`의 production 타깃 `githubCommitSha`, 또는 `curl -sI https://m.admin.babyjamjam.com/<경로>`.

---

## 7. 환경 변수와 시크릿

- 소스 오브 트루스는 각 체크아웃의 git-ignored `.env*`. 커밋되는 것은 키 매니페스트 `env.tpl` / `env.local.tpl`(시크릿은 `KEY=` 빈 값).
- **변수를 추가·이름 변경·삭제하면 `.env`와 `env.tpl`을 같이 고치고** 사용자에게 `env-backup <file>` 실행을 요청한다. 작업 종료 전 `~/.agents/bin/env-check`가 0으로 끝나야 한다.
- 새 워크트리의 env는 `env-bootstrap`이 형제 워크트리에서 복사한다(1Password 접근 없음). 볼트 읽기는 fresh clone의 `env-restore --all` 한 번뿐.
- 값을 출력·로그·비교하지 않는다. 비교는 `shasum -a 256 | cut -c1-12`.
- 원격 env 조회(`railway variables --kv` 등)는 키와 `NODE_ENV`만 보고 나머지는 redact.
- 프로덕션 백엔드 필수 확인: `NODE_ENV=production`, `JWT_SECRET` SET, `ALLOW_DEV_JWT_SECRET` UNSET, `EFORMSIGN_WEBHOOK_SECRET` SET (2026-07-17 admin 서비스 54개 전부 SET 실측).

---

## 8. 승격(릴리스) 체크리스트

`dev → preview`, `preview → main` PR을 열기 전에 순서대로:

1. `dev` CI 전부 green (`enforce` leg 포함). 조회는 §2-4 방식으로.
2. 신규 migrations ↔ `database-patches.yml` 세 잡 배선 대조 (§3.2-2).
3. 마이그레이션이 있으면 **먼저** `gh workflow run database-patches.yml --ref dev -f target=<preview|production>` 실행·성공 확인 (§3.3).
4. 새 env 키가 있으면 `env.tpl` 갱신 + 원격 환경(Lightsail `backend.env`, Vercel env)에 값 추가. 플래그는 아직 OFF.
5. 승격 PR은 merge commit (linear history 룰셋).
6. 배포 완료 확인: 백엔드 `/health/ready` 200 + `deploy Lightsail backend` 잡의 tag/digest 일치, 프론트 production 배포 sha.
7. 플래그 ON → 첫 실행 로그 확인 (§5).
8. Sentry release/source map 확인 (프로덕션 아티팩트가 바뀐 경우). 백엔드 Sentry는 **service-records 이벤트만** 통과시키므로 다른 도메인 오류는 로그로 본다.
9. 런치 체크리스트가 있는 기능은 그 문서(예: `docs/plans/2026-09-01-call-inbox-launch-checklist.md`)의 §0~§5를 닫는다.

핫픽스는 `main`에서 분기한 전용 워크트리에서 만들고 `main`으로 PR, 이후 `dev`로 back-merge. `cs` 런처(dev 기준)를 핫픽스에 쓰지 않는다.

---

## 9. 로컬 개발 환경

- 백엔드 `pnpm start:dev` = `backend/scripts/start-dev-lan.mjs` 래퍼. LAN IP를 감지해 `MOBILE_SERVICE_RECORD_BASE_URL`을 주입하고 `nest start --watch`. 포트 3001.
- 프론트 3000, 모바일 3002. 모바일은 무설정(backendBaseUrl 기본 localhost:3001).
- dev Supabase는 `ebiughoiebblasxwgxbe`. eformsign 계정은 환경 공용이라 **로컬 finalize도 실문서를 만든다.**
- 워크트리: 세션은 `dev` 형제 디렉터리의 태스크 워크트리에서 작업한다 (`cs <slug>`). 환경 브랜치(`main`/`preview`/`dev`) 체크아웃에서 직접 편집하지 않는다.

---

## 10. 자주 나는 실수 (리뷰 반려 기준)

1. migrations만 추가하고 `database-patches.yml` 세 잡 배선을 빠뜨림.
2. 코드 먼저 배포하고 DB 패치를 나중에 → 호환 폴백이 가드를 무력화하는 창이 열림.
3. `prisma migrate deploy`를 원격에 실행.
4. `DATABASE_URL=… prisma db execute`로 prod에 적용했다고 믿음 (실제로는 dev에 적용됨).
5. preview를 "격리된 스테이징"으로 전제 (prod DB 공유).
6. dev 호스팅 URL을 전제로 한 설정.
7. Vercel 빌드 브랜치를 프로젝트 하나에서만 변경.
8. `gh run list --commit`으로 "CI 대기중"이라고 보고.
9. preview push의 OIDC 배포 실패를 코드 문제로 재조사.
10. 플래그를 컬럼 패치 전에 ON.
11. 두 런타임(Lightsail/Fallback, 또는 잔존 Railway)에 동시에 스케줄러 활성화.
14. Fallback Server에서 스케줄러·잡 워커·Aligo를 켬, 또는 DB identity 게이트를 우회.
15. Fallback 전환 후 자동으로 돌아올 것이라 가정 (failback은 수동).
12. env 키를 추가하고 `env.tpl`·`env-check`를 빠뜨림.
13. 저장소의 `rollback.sh`를 직접 실행 (retired, 거부됨).

---

## 11. 이 문서를 바꿔야 할 때

- 새 사고가 나면 §10에 항목을 추가하고, 해당 절에 날짜·PR/run 번호와 함께 규칙을 적는다.
- Fallback 컨트롤러가 설치·arm되면 §4.1 "현재 상태"를 갱신한다. `railway.json`·README의 Railway 문구를 정리하면 §4 Railway 절을 삭제한다.
- 워크플로 파일 이름·잡 이름이 바뀌면 §2 표를 같은 커밋에서 갱신한다.
