# Agent UI Rules — BabyJamJam Design System

> **모든 에이전트(그리고 사람)는 frontend/mobile UI 작업을 시작하기 전에 이 문서와
> [`component-manifest.json`](./component-manifest.json)을 먼저 읽는다.**
> 이 규칙은 ESLint(`ui-architecture/*` rule 4종 + `data-component/require-data-component`)와
> `lint:ui-architecture` baseline 게이트로 CI에서 강제된다. 프롬프트를 잘 써서 지키는 것이 아니라, 어기면 CI가 실패한다.

## 핵심 원칙

**UI를 새로 만들지 말고, 있는 것을 조합한다.**

1. UI 작업 전 `docs/design-system/component-manifest.json`에서 사용할 컴포넌트를 먼저 고른다.
2. 기존 컴포넌트가 있으면 반드시 import해서 사용한다. `replaces` 필드가 "이 컴포넌트가 대체하는 손코딩 패턴"이다 — 그 패턴을 손으로 다시 만들면 위반이다.
3. 없으면 **page에 직접 만들지 않는다.** 새 UI가 필요하면 먼저 디자인 시스템 레이어(`components/ui`, `components/app/ui`, `components/app/v3`)에 컴포넌트 추가를 제안하고, 승인 후 그 레이어에 만든 다음 manifest에 등록한다.
4. `page.tsx`는 template/organism 조립만 한다. 데이터 페칭 훅 호출 + 컴포넌트 조립 + layout 클래스 소량이 전부다.
5. 새 컴포넌트의 설계는 [`frontend/docs/design-system/README.md`](../../frontend/docs/design-system/README.md)의 semantic atomic design 원칙(base/variant/size/layout 분리, intent 중심 variant 네이밍)을 따른다.
6. `data-component` 속성은 `{platform}_{page}_{organism}_{component}[_{sub}…]` 형식을 사용한다.
   `_`는 논리 세그먼트, `-`는 세그먼트 내부 kebab-case에만 사용한다. 기존 kebab-case 값은
   점진적 마이그레이션 동안만 호환하며, 새 코드에는 사용하지 않는다.
   모든 자식은 route/page root부터 직계 owner까지의 전체 경로를 유지하고 부모 값에
   `_child`를 추가한다. depth 제한이나 namespace restart는 없다. 재사용 composite는
   caller가 완성된 base를 전달하며 `info-card-title` 같은 context-free fallback을 두지 않는다.
   단순 layout wrapper에는 `_div`/`_span` 같은 기계적 이름을 추가하지 않는다.

## 금지 목록 (page.tsx 기준, ESLint로 강제)

| 금지 | rule | 대신 |
|---|---|---|
| page 안 local 컴포넌트 정의 (`function Foo()`, `const Foo = () =>`) | `ui-architecture/no-page-local-components` | 디자인 시스템 레이어로 추출 후 import |
| Tailwind 문자열 상수 (`INPUT_CLS`, `CARD_CLASS`, `*_CLASS_NAME`) | `ui-architecture/no-page-style-constants` | 해당 스타일을 캡슐화한 컴포넌트 사용 |
| raw `<button>` `<input>` `<select>` `<textarea>` `<dialog>` | `ui-architecture/no-raw-ui-in-pages` | `Button`/`Input`/`Select`/`Textarea`/`FormDialogShell` 등 |
| 시각 Tailwind (`bg-*`, `text-*`, `border-*`, `rounded-*`, `shadow-*`) | `ui-architecture/no-visual-tailwind-in-pages` | 시각 스타일은 컴포넌트 내부로; page는 layout 클래스(`flex`, `grid`, `gap-*`, `w-*` 등)만 |
| custom div card / modal / sheet / toast / status badge | 위 rule들의 조합 | `InfoCard`, `FormDialogShell`, `ConfirmActionModal`, `Toaster`, `StatusBadge` |
| `tokens` 레이어 상수(`APP_DIALOG_*`, `V3_INPUT_*` 등)를 page에서 직접 import | `no-page-style-constants` 정신 | 그 상수를 소비하는 컴포넌트를 사용 |

기존 위반은 `docs/design-system/ui-debt-baseline.json`에 동결되어 있다. **baseline은 늘어날 수 없다** — 새 위반은 CI 실패, 파일을 정리하면 baseline에서 제거한다.

## UI 작업 시작 프로토콜

작업을 시작하기 전에 다음 형식으로 확인하고 선언한다:

```text
UI 작업 전 확인:
1. 사용 가능한 design-system component:
2. 새로 만들면 안 되는 custom UI:
3. 사용할 template/organism:
4. 부족한 component가 있다면 먼저 제안:
5. page.tsx에 남길 책임:
```

## 완료 보고 프로토콜

작업 완료 시 다음 형식으로 보고한다:

```text
사용한 design-system components:
- (예: FormSection, FormField, SteppedWizard, ActionFooter)

새로 만든 custom UI:
- 없음  (있다면: 어느 레이어에 추가했고 manifest에 등록했는지)

page-local component:
- 없음

raw Tailwind visual styling:
- 없음
```

## 자주 쓰는 조합 (빠른 참조)

- **폼 페이지 (frontend):** `SteppedWizard`/`PageHeader` + `FormSection` + `FormGrid` + `FormField`(+`FormTextInput`/`FormNativeSelect`) + `FormSwitchRow` — `@/components/app/ui/form-section`
- **폼 다이얼로그 (frontend):** `FormDialogShell` + form 패밀리
- **목록+상세 페이지:** `SplitLayout` + `ListPanel` + `DetailPanel` + `SearchFilterBar` + `EmptyState`/`DetailSkeleton` — `@/components/app/v3`
- **상태 표시:** `StatusBadge` (`@/components/app/ui/status-badge`; 상태→tone 매핑은 `@babyjamjam/shared` ui-contracts)
- **표 데이터:** `DataTable` + `DataTableToolbar` + `DataTablePagination` — `@/components/app/ui/datatable`
- **모바일 폼:** `FormSection` + `InputField` + `SteppedWizard` — `@/components/app/v3`, `@/components/app/ui`
- **모바일 확인 모달:** `ConfirmActionModal` — `@/components/app/ui/ConfirmActionModal`

## 이 문서가 강제되는 경로

- ESLint rule 구현: `packages/shared/eslint-plugin/ui-architecture/`
- baseline 게이트: `pnpm lint:ui-architecture` (CI의 frontend/mobile verify job에서 실행)
- 에이전트 진입점: repo 루트 `AGENTS.md` → 이 문서
