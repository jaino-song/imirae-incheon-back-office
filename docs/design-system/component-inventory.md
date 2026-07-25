# Component Inventory — 2026-07-08 (dev `d1c29d5b` 기준)

BabyJamJam admin의 UI 재료 전수 조사. 기계용 목록은 [`component-manifest.json`](./component-manifest.json)이 canonical이며, 이 문서는 사람용 요약이다. 작업 규칙은 [`AGENT_UI_RULES.md`](./AGENT_UI_RULES.md).

## 레이어 구조

| 레이어 | frontend | mobile | 내용 |
|---|---|---|---|
| atom | `frontend/src/components/ui/` (36 파일) | (mobile은 v3에 흡수) | shadcn 기반: Button, Input, Badge, Card, Dialog, Sheet, Table, Skeleton, Spinner … |
| molecule | `frontend/src/components/app/ui/` (12 파일) | `mobile/src/components/app/ui/` (13 파일) | FormSection/FormField 패밀리, StatusBadge, InfoRow, TagPill, FormDialogShell, DataTable, ConfirmActionModal(모바일), Autocomplete(모바일) |
| organism/template | `frontend/src/components/app/v3/` (47 파일) | `mobile/src/components/app/v3/` (40 파일) | SplitLayout, ListPanel/DetailPanel, SteppedWizard, SearchFilterBar, EmptyState 계열, PageHeader, V3 앱 프레임 |
| domain | `frontend/src/components/app/<domain>/` (19개 도메인, 155 파일) | `mobile/src/components/app/<domain>/` | 도메인 전용 조합 (clients, contracts, messages, alimtalk …) |
| tokens | `ui/app-surface.tsx`, `ui/input.tsx` 등의 `*_CLASS_NAME` 상수, `@babyjamjam/shared` tokens | 동일 | **컴포넌트 구현 전용** — page에서 직접 import 금지 |

주요 재발견: `frontend/src/components/app/ui/form-section.tsx`는 완전한 폼 패밀리(`FormSection`, `FormGrid`, `FormField`, `FormTextInput`, `FormHelperText`, `FormNativeSelect`, `FormChip`, `FormSwitchRow`)를 이미 export한다. 폼 UI를 손으로 만들 이유가 없다.

## 중복 구현 (canonical 지정 — Phase 3.4에서 확정)

| 패턴 | 사본 | canonical (잠정) |
|---|---|---|
| StatusBadge | `app/ui/status-badge.tsx` (variants+StatusPill) vs `v3/StatusBadge.tsx` | `app/ui/status-badge.tsx` |
| InfoRow | `app/ui/info-row.tsx` vs `v3/InfoRow.tsx` | `v3/InfoRow.tsx` |
| Tabs | `ui/tabs.tsx` vs `app/ui/tabs.tsx` | `ui/tabs.tsx` |
| ContractCreationForm | `frontend/.../contracts/ContractCreationForm.tsx` vs `mobile/.../messages/forms/ContractCreationForm.tsx` | 플랫폼별 유지하되 스타일 상수 제거 대상 |

mobile도 같은 StatusBadge/InfoRow 중복을 가진다 (frontend와 동일 처리).

## 위반 현황 (baseline 등록 대상)

### Page-local 컴포넌트 정의 — frontend 19개 페이지

최악 순: `messages/page.tsx` 1,973줄 · `contracts/page.tsx` 1,875줄 · `alimtalk/page.tsx` 1,803줄 · `clients/page.tsx` 1,347줄 · `dashboard/page.tsx` 669줄 · `clients/new/page.tsx` 659줄. 그 외 auth 계열 페이지들의 `*Loading`/`*Content` 로컬 컴포넌트 다수.

### Page-local 컴포넌트 — mobile

`contracts/page.tsx` 2,200줄 · `messages/new/page.tsx` 1,449줄 · `contracts/new/page.tsx` 1,414줄(CSS module 혼용 + local `Field`) · `clients/new/page.tsx` 1,165줄 · `files/page.tsx` 705줄(로컬 함수 6개) · `clients/page.tsx` 644줄.

### 스타일 상수 (`*_CLS`/`*_CLASS`) — 5개 파일

- `frontend/src/app/(protected)/clients/new/page.tsx` — `INPUT_CLS`, `SELECT_CLS`, `LABEL_CLS`, `GRID_CLS` ← **frontend 파일럿**
- `frontend/src/app/(protected)/alimtalk/page.tsx` — `INPUT_CLASS`, `SELECT_CLASS`
- `frontend/src/components/app/contracts/ContractCreationForm.tsx`
- `mobile/src/components/app/messages/forms/ContractCreationForm.tsx`
- `mobile/src/components/app/alimtalk/TriggerRulesManager.tsx`

기타: `frontend/.../stats/errors/page.tsx`(`LEVEL_DOT_CLASS` 등), `frontend/.../messages/page.tsx`(`APP_CONTENT_BODY_CARD_*` tokens 직접 import), mobile 4+ 페이지의 `ALL_FILTER = "전체"` 중복 상수, mobile 여러 페이지의 `document.body.classList` 직접 조작.

## 관련 문서 상태

| 문서 | 상태 |
|---|---|
| `frontend/docs/design-system/README.md` | ✅ 유효 — semantic atomic design 설계 원칙 |
| `mobile/DATA-COMPONENT-CONVENTION.md` + `data-component-mapping.json` | ✅ 유효 — kebab-case data-component 네이밍 |
| `docs/conventions/DESIGN_SYSTEM.md` | ⚠️ 부분 노후 — 토큰/색상 표는 참고 가능, 디렉토리 구조 설명은 Vite 시절 |
| `docs/design-system/*` (이 디렉토리) | canonical 진입점 |
