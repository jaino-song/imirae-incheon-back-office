# Desktop UI Rules — 섹션·매니저 화면 조립 규칙

> 대상: `frontend/` 데스크톱 관리자 앱의 모든 화면 작업 (사람·에이전트 공통).
> 상위 문서는 [`docs/design-system/AGENT_UI_RULES.md`](./design-system/AGENT_UI_RULES.md)이다.
> 그 문서가 "무엇을 금지하는가"를 ESLint 기준으로 정의한다면, 이 문서는 **"그래서 화면을 어떻게 조립하는가"**를
> 실제 기준 구현(`TriggerRulesManager`)에 맞춰 단계별로 못 박는다. 두 문서가 충돌하면 상위 문서와 ESLint가 이긴다.

**기준 구현 (canonical reference):**

| 역할 | 파일 |
|---|---|
| 섹션 페이지 골격 | `frontend/src/app/(protected)/messages/page.tsx` (`SectionNav` + 섹션별 organism 마운트) |
| 목록+상세 매니저 organism | `frontend/src/components/app/messages/TriggerRulesManager.tsx` |
| 계약서 페이지 적용 예 | `frontend/src/app/(protected)/contracts/page.tsx` + `frontend/src/components/app/contracts/ContractAutomationsManager.tsx` |
| 디자인 시스템 배럴 | `frontend/src/components/app/v3/index.ts` |
| 폼 분자(molecule) | `frontend/src/components/ui/title-select-molecule.tsx`, `title-text-input-molecule.tsx`, `title-textarea-molecule.tsx`, `switch.tsx` |
| 토큰 | `frontend/src/app/globals.css` (`--v3-*`, `--status-*`, `--glint-ui-scale`) |
| DOM 주석 규약 | `frontend/DATA-COMPONENT-CONVENTION.md` |

---

## 0. 한 줄 요약

**page.tsx는 조립만 하고, 화면 하나는 organism 하나이며, organism은 v3 컴포넌트와 폼 분자만으로 만든다.**
`InfoCard`에 텍스트를 나열해 "정보 카드"를 만드는 것은 목록 화면이 아니다. 목록은 `AnimatedSlotList` 행이고, 설정은 `DetailPanel` 안의 폼이다.

---

## 1. 페이지 골격 (page.tsx)

### 1.1 책임 범위

`page.tsx`에 허용되는 것은 다음 네 가지뿐이다.

1. 라우팅·쿼리스트링·딥링크 상태 (`useSearchParams`, `useRouter`)
2. 섹션 정의와 활성 섹션 상태 (`NAV_SECTIONS`, `activeSection`)
3. 섹션별 organism 마운트 (`<TriggerRulesManager dataComponent=… />`)
4. layout 클래스 소량 (`flex`, `flex-1`, `min-h-0`, `gap-*`, `w-*`)

다음은 금지이며 ESLint(`ui-architecture/*`)가 잡는다.

- page 내부 컴포넌트 정의, Tailwind 문자열 상수, raw `<button>/<input>/<select>`
- 시각 Tailwind (`bg-*`, `text-*`, `border-*`, `rounded-*`, `shadow-*`)
- 데이터 배열을 page 상수로 두고 `InfoCard`/`InfoRow`로 직접 렌더링하는 "임시 화면"

### 1.2 섹션 정의

```tsx
const NAV_SECTIONS = [
  { id: "maternity", label: "산모 계약서", icon: FileSignature },
  { id: "service-records", label: "제공기록지", icon: ClipboardList },
  { id: "caregiver", label: "제공인력 계약서", icon: Briefcase, disabled: true },
  { id: "automations", label: "자동화", icon: Workflow },
] as const;
type SectionId = (typeof NAV_SECTIONS)[number]["id"];
```

- `id`는 kebab-case 영문, `label`은 한글 2~6자, `icon`은 lucide-react.
- 아직 만들지 않은 섹션은 `disabled: true`로 두고 **placeholder 화면을 만들지 않는다.**
  `ListPanel`/`DetailPanel`에 "준비중입니다"를 넣는 것까지만 허용한다.
- 섹션 전환 시 다른 섹션의 선택 상태(딥링크 문서 id 등)는 반드시 초기화한다.

### 1.3 섹션 마운트

```tsx
<div data-component="desktop_contracts_sections" className="flex flex-1 min-h-0 flex-col gap-[calc(16px*var(--glint-ui-scale,1))] lg:flex-row">
  <SectionNav data-component="desktop_contracts_sections_section-nav" items={NAV_SECTIONS} activeId={activeSection} onSelect={…} />
  <div data-component="desktop_contracts_sections_section-content" className="flex-1 min-w-0 min-h-0 flex flex-col">
    {activeSection === "automations" ? (
      <section data-component="desktop_contracts_sections_section-content_automations-section" className="flex flex-1 min-h-0 flex-col">
        <ContractAutomationsManager dataComponent="desktop_contracts_sections_section-content_automations-section_manager" />
      </section>
    ) : null}
  </div>
</div>
```

- 섹션 하나 = `<section>` 하나 = organism 하나. `SplitLayout`을 page에서 직접 조립하지 않는다.
- organism에는 완성된 `dataComponent` base를 넘긴다. organism은 그 값에 `_child`를 이어 붙인다.

---

## 2. 매니저 organism (목록 + 상세)

"규칙/설정/항목 목록을 보고 하나를 골라 편집한다"는 화면은 전부 이 패턴이다. 예: 자동 전송 루틴, 계약 자동화, 템플릿, 담당자.

### 2.1 뼈대

```
SplitLayout hasSelection={selectedId !== null}
├─ ListPanel  title / subtitle / tabs? / headerActions? / disabled+disabledOverlay?
│   └─ AnimatedSlotList<Item> isLoading loadingCount render={AnimatedSlotListItemContent}
│       (비었으면 ListEmptyState)
└─ DetailPanel title / subtitle / tabs={DetailTabs} / footer
    ├─ 선택 없음 → ListEmptyState(icon, "왼쪽 목록에서 …를 선택하세요")
    ├─ 로딩 → Skeleton / DetailSkeleton
    └─ DetailTabPanels panels=[{ key, children }]
```

기준 구현: `TriggerRulesManager.tsx` 635–716행(목록), 718–995행(상세).

### 2.2 Props와 DOM 주석

```tsx
interface Props { dataComponent: string; /* + 도메인 파라미터 */ }
const component = (suffix: string) => `${dataComponent}_${suffix}`;
```

- 모든 v3 컴포넌트에 `data-component={component("…")}`를 넘긴다. 규칙은 `frontend/DATA-COMPONENT-CONVENTION.md`.
- `_`는 논리 세그먼트, `-`는 세그먼트 내부. `_div`·`_wrapper` 같은 기계적 이름은 붙이지 않는다.

### 2.3 ListPanel 규칙

| 항목 | 규칙 |
|---|---|
| `title` | 섹션 이름 그대로. 예: "자동 전송 루틴", "자동화" |
| `subtitle` | 이 목록이 무엇인지 한 문장. 개수 표기("N건")는 subtitle이 아니라 탭/필터의 몫 |
| `tabs` | 상태 필터가 있을 때만 (`활성화`/`비활성화`). 항목이 시스템 정의 1~2개면 생략 |
| `headerActions` | 사용자가 항목을 만들 수 있을 때만 `HeaderActionButton icon={Plus} label="새 규칙"`. 시스템 정의 항목이면 생략 |
| `disabled` + `disabledOverlay` | 권한/승인 게이트가 있을 때 (`MessageApprovalRequiredNotice` 참고) |
| `avatar` | 매니저 화면에서는 쓰지 않는다. 아이콘은 행(row)에 둔다 |

### 2.4 행(row) 규칙 — `AnimatedSlotListItemContent`

```tsx
<AnimatedSlotList<RuleListItem>
  items={listItems}
  isLoading={isLoading}
  loadingCount={5}
  getSlotState={({ item, slotLoading }) => ({ isActive: !slotLoading && item?.id === selectedId })}
  render={({ item }) => (
    <AnimatedSlotListItemContent
      dataComponent={component("rule")}
      icon={item.icon}
      title={item.title}
      subtitle={item.subtitle}
      status={<Switch checked={item.active} onCheckedChange={(v) => handleToggle(item, v)} />}
      onClick={() => setSelectedId(item.id)}
    />
  )}
/>
```

- `icon`: 항목 유형을 나타내는 lucide 아이콘 (이벤트/규칙 종류별 매핑 함수 `getRuleIcon`처럼).
- `title`: 항목 이름. `subtitle`: **요약 문자열** — 핵심 속성을 ` · `로 이어 붙인다.
  예: `"서비스 시작 · 시작 7일 전 · 고객"`, `"검토 필요 → 계약 완료 · 종료일 당일 · 매일 17:00"`.
- `status` 슬롯: 켜고 끄는 항목이면 `Switch`, 상태만 보이면 `StatusBadge`. 둘 다 아니면 비운다.
- 행 클릭 = 선택. `Switch` 클릭은 선택을 바꾸지 않는다(이벤트 전파 차단은 컴포넌트가 처리).
- 행 안에 `InfoRow`/`InfoCard`/버튼 묶음을 넣지 않는다. 상세는 오른쪽 패널의 일이다.

### 2.5 DetailPanel 규칙

| 항목 | 규칙 |
|---|---|
| `title` | 선택 항목 이름. 신규면 "새 발송 규칙"처럼 "새 …" |
| `subtitle` | 이 상세에서 무엇을 할 수 있는지 한 문장 |
| `tabs` | 내용이 두 종류 이상이면 `DetailTabs` (`규칙 설정` / `미리보기`, `규칙 설정` / `동작 설명`). 한 종류면 생략 |
| `footer` | 저장·삭제·되돌리기 버튼. `Button` 컴포넌트만 사용. 위치·간격은 `TriggerRulesManager` footer를 그대로 복제 |
| 본문 | `DetailTabPanels`의 `children`에 `SteppedWizardPanelContent`(또는 동일한 패널 컨텐츠 래퍼) → 폼 분자 순서대로 |

### 2.6 폼 규칙

- 입력은 폼 분자만: `TitleTextInputMolecule`, `TitleSelectMolecule`, `TitleTextareaMolecule`, `Switch`(+라벨 행).
  raw `<input>`, `<select>`, 커스텀 라벨+인풋 조합은 만들지 않는다.
- 선택형 값(일수, 횟수, 유형)은 **자유 입력이 아니라 `TitleSelectMolecule` 옵션**으로 제한한다.
  예: 실행 시점 = 종료일 당일 / 1일 후 / 3일 후 / 7일 후 / 14일 후 / 30일 후.
- 폼 아래 고정 정보(필수 변수, 실행 조건 등)는 `InfoCard` 하나로 묶는다. 값이 열거형이면 `Badge`.
- 상태 관리:

```tsx
const [formState, setFormState] = useState<FormState>(toFormState(selected));
const hasChanges = useMemo(
  () => JSON.stringify(normalize(formState)) !== JSON.stringify(normalize(toFormState(selected))),
  [formState, selected],
);
```

  - 선택이 바뀌면 draft를 새 항목으로 리셋한다.
  - 저장 버튼은 `!hasChanges || isSaving`이면 disabled.
  - 되돌리기는 draft를 서버 값으로 리셋한다.
  - 행의 `Switch`(즉시 저장)와 상세 폼(draft)은 **서로 독립**이다. 토글이 끝난 뒤 draft가 dirty가 아닐 때만 서버 값으로 동기화한다.

### 2.7 데이터 연결

- 조회: `useQuery({ queryKey: ["settings", "<resource>"], queryFn: settingsApi.get… })`
  키는 `["<domain>", "<resource>"]` 2단이 기본이며, 같은 리소스를 쓰는 화면끼리 키를 공유한다.
- 변경: `useMutation` → 성공 시 해당 키 `invalidateQueries`, 토스트.
- API 함수는 `frontend/src/services/api.ts`의 도메인 객체(`settingsApi`, …)에 추가한다. 컴포넌트에서 `api.get`을 직접 부르지 않는다.
- 403(권한 없음)은 토스트로 알리고 폼을 비활성화하지 않는다. 비활성화는 `ListPanel.disabled` 게이트로만 한다.

### 2.8 피드백·빈 상태·로딩

| 상황 | 컴포넌트 |
|---|---|
| 목록 비어 있음 | `ListEmptyState message="… 규칙이 없습니다."` |
| 선택 없음 | `ListEmptyState icon={…} message="왼쪽 목록에서 …를 선택하세요"` (상세 패널 안) |
| 목록 로딩 | `AnimatedSlotList isLoading loadingCount={n}` |
| 상세 로딩 | `Skeleton` (클래스는 `TriggerRulesManager`의 것을 그대로) 또는 `DetailSkeleton sections=[…]` |
| 성공 | `toast({ variant: "success", description: "…했어요" })` |
| 실패 | `toast({ variant: "destructive", description: "…하지 못했어요" })` |

`window.alert`, 인라인 빨간 텍스트, 커스텀 배너는 쓰지 않는다.

---

## 3. 스타일·토큰

- **시각 스타일은 컴포넌트 안에만.** organism 파일에서도 새로운 `bg-*`/`text-*`/`border-*` 조합을 만들지 않는다.
  같은 목적의 클래스 문자열이 `TriggerRulesManager`에 이미 있으면 그대로 복사한다. 없으면 v3 컴포넌트를 추가·확장하고 manifest에 등록한다.
- 색은 `--v3-*` 토큰(`bg-v3-primary-light`, `text-v3-text-muted`, `bg-v3-dim-white`)과 `--status-*` 3종 세트만 쓴다. 헥스 코드·임의 hsl 금지.
- 크기·간격은 `--glint-ui-scale` 기준: `calc(16px*var(--glint-ui-scale,1))`. 고정 px는 스케일이 필요 없는 1px 보더 정도만.
- 아이콘은 lucide-react. 크기는 `h-[calc(20px*var(--glint-ui-scale,1))]` 관용구를 따른다.
- 모서리는 v3 라디우스(`rounded-[18px]`, `rounded-[16px]`)를 컴포넌트가 이미 갖고 있다. 새로 지정하지 않는다.

---

## 4. 카피 톤 (한국어)

- 제목·라벨: 명사형, 2~6자. "규칙 설정", "실행 시점", "최대 시도 횟수".
- 부제: 한 문장, 존댓말 서술형. "메시지 발송 시점, 수신자, 템플릿을 설정해서 자동으로 보냅니다."
- 토스트: 해요체 과거형. 성공 "저장했어요", 실패 "저장하지 못했어요".
- 빈 상태: "…이 없습니다." / "왼쪽 목록에서 …를 선택하세요".
- 상태 용어는 `@babyjamjam/shared`의 상태 라벨을 그대로 쓴다. "검토 필요", "계약 완료"를 임의로 바꾸지 않는다.
- 영문 시스템 이름(eformsign 등)은 원문 그대로, 따옴표는 작은따옴표.

---

## 5. 테스트

새 organism에는 `__tests__/<Name>.test.tsx`를 같이 만든다. 최소 3가지:

1. 모킹된 쿼리 데이터로 행이 렌더링된다.
2. 행의 `Switch` 토글이 올바른 payload로 mutation을 호출한다.
3. 폼 값 변경 → 저장 버튼 활성화 → 저장 시 올바른 payload로 API 호출.

모킹 방식은 같은 폴더의 기존 테스트(`ContractDocumentJobsPopover.test.tsx`)를 따른다.

---

## 6. 시작·완료 체크리스트

작업 전 (`AGENT_UI_RULES.md`의 프로토콜을 이 화면 유형에 맞춘 것):

```text
UI 작업 전 확인:
1. 화면 유형: 섹션 placeholder / 목록+상세 매니저 / 폼 / 표
2. 기준 구현으로 삼을 파일: (예: TriggerRulesManager.tsx)
3. 사용할 v3 컴포넌트: SplitLayout, ListPanel, AnimatedSlotList(+ItemContent), DetailPanel, DetailTabs/Panels, …
4. 사용할 폼 분자: TitleSelectMolecule, Switch, …
5. 데이터: queryKey / api 함수 / mutation
6. page.tsx에 남길 책임: NAV_SECTIONS 항목 + organism 마운트
7. 부족한 컴포넌트가 있으면 여기서 멈추고 제안
```

완료 보고:

```text
사용한 design-system components: …
새로 만든 custom UI: 없음 (있다면 레이어 + manifest 등록 여부)
page-local component: 없음
raw Tailwind visual styling: 없음
테스트: <파일> (통과)
type-check / eslint: 통과
```

---

## 7. 안티패턴 → 올바른 형태 (실제 사례)

**2026-09-02 계약서 `자동화` 섹션 1차 구현이 반려된 이유와 수정.**

| 반려된 형태 | 문제 | 수정된 형태 |
|---|---|---|
| page.tsx에 `AUTOMATIONS` 상수 배열 | 데이터·화면이 page에 있음 | organism(`ContractAutomationsManager`)이 서버 설정을 `useQuery`로 조회 |
| `ListPanel` 안에 `InfoCard` + `InfoRow` 4줄 나열 | "정보 카드"이지 목록이 아님. 선택·토글 불가 | `AnimatedSlotList` 행 1개: 아이콘 + 제목 + 요약 subtitle + `Switch` |
| `DetailPanel`에 `DetailEmptyState`만 | 상세가 비어 있음 | `DetailTabs`(규칙 설정 / 동작 설명) + `TitleSelectMolecule` 폼 + 저장/되돌리기 footer + `InfoCard`(실행 조건) |
| `ListPanel avatar`에 아이콘 박스 + 시각 클래스 | 매니저 화면에서 쓰지 않는 슬롯, page에 시각 Tailwind | 아이콘은 행으로 이동, 시각 클래스 제거 |
| 설정값이 문자열로 하드코딩 | 설정 불가 | 백엔드 `GET/PUT /settings/contract-automation-policies` 연결, 행 토글은 즉시 저장, 폼은 draft 저장 |

---

## 8. 레시피 — 새 섹션 + 목록/상세(SplitLayout) 화면 만들기

아래 순서를 **그대로** 따른다. 순서를 건너뛰거나 "일단 InfoCard로 보여주고 나중에" 식의 임시 화면을 만들면 반려된다.
검증된 실물은 `frontend/src/components/app/contracts/ContractAutomationsManager.tsx`(단일 항목, 186줄)와
`frontend/src/components/app/messages/TriggerRulesManager.tsx`(CRUD 항목)이다. 새 화면은 둘 중 가까운 쪽을 복제해서 시작한다.

### 8.1 절차

| 단계 | 할 일 | 산출물 |
|---|---|---|
| 1 | 화면 유형 판정: 항목이 시스템 정의(토글·설정만)인가, 사용자가 만들고 지우는가 | 복제 원본 결정 (`ContractAutomationsManager` / `TriggerRulesManager`) |
| 2 | API 계약 확정: 조회 응답 shape, 변경 endpoint, 권한(403 여부) | `frontend/src/services/api.ts`에 함수·타입 추가 |
| 3 | organism 파일 생성 `frontend/src/components/app/<domain>/<Name>Manager.tsx` | §8.2 스캐폴드 |
| 4 | page.tsx에 `NAV_SECTIONS` 항목 + `<section>` + organism 마운트 (§1.3) | page diff는 10줄 이내 |
| 5 | 테스트 `__tests__/<Name>Manager.test.tsx` (§5 최소 3건) | 통과 |
| 6 | `npm run type-check`, `npx eslint <organism> <page>`, `npx jest <folder>` | 모두 통과, 새 경고 0 |
| 7 | 완료 보고 (§6 형식) | — |

### 8.2 스캐폴드 (그대로 복사해서 이름만 바꾼다)

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";                 // 항목 유형 아이콘
import {
  AnimatedSlotList, AnimatedSlotListItemContent,
  DetailEmptyState, DetailPanel, DetailTabPanels, DetailTabs,
  InfoCard, ListPanel, SplitLayout, SteppedWizardPanelContent,
} from "@/components/app/v3";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TitleSelectMolecule } from "@/components/ui/title-select-molecule";
import { useToast } from "@/hooks/use-toast";
import { settingsApi, type FooConfig } from "@/services/api";

const QUERY_KEY = ["settings", "foo-policies"] as const;
const DETAIL_TABS = [
  { key: "settings", label: "규칙 설정" },
  { key: "description", label: "동작 설명" },
] as const;

export interface FooManagerProps { dataComponent: string }

export function FooManager({ dataComponent }: FooManagerProps) {
  const component = (suffix: string) => `${dataComponent}_${suffix}`;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── 상태: 선택 / 탭 / draft ───────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof DETAIL_TABS)[number]["key"]>("settings");
  const [draft, setDraft] = useState<FooConfig | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // ── 데이터 ────────────────────────────────────────────────
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: settingsApi.getFooPolicies });
  const mutation = useMutation({
    mutationFn: settingsApi.updateFooConfig,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setIsDirty(false);
      toast({ variant: "success", description: "설정을 저장했어요" });
    },
    onError: (e) => toast({ variant: "destructive", description: e instanceof Error ? e.message : "설정을 저장하지 못했어요" }),
  });
  const saved = query.data?.foo;
  useEffect(() => { if (saved && !isDirty) setDraft(saved); }, [saved, isDirty]);
  const current = draft ?? saved;

  const updateDraft = (patch: Partial<FooConfig>) => { if (current) { setDraft({ ...current, ...patch }); setIsDirty(true); } };
  const save = () => { if (draft && isDirty) mutation.mutate(draft); };
  const reset = () => { if (saved) { setDraft(saved); setIsDirty(false); } };
  const toggle = (enabled: boolean) => { if (saved) mutation.mutate({ ...saved, enabled }); };   // 행 토글은 draft와 무관하게 즉시 저장

  const summary = useMemo(() => saved ? `핵심 속성 A · 핵심 속성 B · 주기` : "설정 불러오는 중", [saved]);

  return (
    <section data-component={dataComponent} data-slot="foo-manager" className="flex h-full min-h-0 flex-1 flex-col">
      <SplitLayout data-component={component("split-layout")} hasSelection={selectedId !== null}>

        {/* ── 왼쪽: 목록 ── */}
        <ListPanel data-component={component("list-panel")} title="자동화" subtitle="이 목록이 무엇인지 한 문장">
          <AnimatedSlotList
            data-component={component("list")}
            items={query.isLoading ? undefined : [{ id: "foo-rule" }]}
            isLoading={query.isLoading}
            loadingCount={1}
            getSlotState={({ item, isLoading }) => ({ isActive: !isLoading && item?.id === selectedId, isInteractive: !isLoading && Boolean(item) })}
            onSlotClick={(item) => setSelectedId(item.id)}
            getItemKey={(item) => item.id}
            render={({ item, isLoading }) => {
              if (isLoading) return <Skeleton className="h-16 w-full rounded-[18px] bg-v3-dim-white" />;
              if (!item || !saved) return null;
              return (
                <AnimatedSlotListItemContent
                  dataComponent={component("row")}
                  icon={CalendarCheck}
                  title="항목 이름"
                  subtitle={summary}
                  status={<Switch aria-label="항목 이름 활성화" checked={saved.enabled} disabled={mutation.isPending}
                                  onClick={(e) => e.stopPropagation()} onCheckedChange={toggle} />}
                />
              );
            }}
          />
        </ListPanel>

        {/* ── 오른쪽: 상세 ── */}
        {selectedId === null ? (
          <DetailPanel data-component={component("detail-panel-empty")}
                       overlay={<DetailEmptyState icon={CalendarCheck} message="왼쪽 목록에서 자동화를 선택하세요" />}>
            {null}
          </DetailPanel>
        ) : (
          <DetailPanel
            data-component={component("detail-panel")}
            isLoading={query.isLoading}
            title="항목 이름"
            subtitle="이 상세에서 무엇을 할 수 있는지 한 문장."
            tabs={<DetailTabs tabs={[...DETAIL_TABS]} activeTab={activeTab} onTabChange={(k) => setActiveTab(k as typeof activeTab)} />}
            footer={(
              <>
                <Button type="button" variant="outline"  size="sm" width="sm" onClick={reset} disabled={!isDirty || mutation.isPending}>되돌리기</Button>
                <Button type="button" variant="positive" size="sm" width="sm" onClick={save}  disabled={!isDirty || mutation.isPending}>{mutation.isPending ? "저장 중..." : "저장"}</Button>
              </>
            )}
          >
            <DetailTabPanels
              activeTab={activeTab} dataComponent={component("detail-tabs")}
              className="flex min-h-0 flex-1" trackClassName="min-h-0 flex-1" panelClassName="h-full min-h-0"
              panels={[
                {
                  key: "settings",
                  children: current ? (
                    <SteppedWizardPanelContent dataComponent={component("form")} flattenStepContent className="py-0" stepContentClassName="justify-start gap-4">
                      <TitleSelectMolecule id="foo-option" label="옵션 라벨" value={String(current.option)} options={OPTIONS}
                                           onValueChange={(v) => updateDraft({ option: Number(v) })} dataComponent={component("option")} />
                      <div className="flex items-center justify-between">
                        <span>자동화 사용</span>
                        <Switch aria-label="자동화 사용" checked={current.enabled} onCheckedChange={(enabled) => updateDraft({ enabled })} />
                      </div>
                      <InfoCard title="실행 조건" data-component={component("conditions")}>
                        <div className="space-y-2 text-sm text-v3-text-muted"><p>고정 조건 1</p><p>고정 조건 2</p></div>
                      </InfoCard>
                    </SteppedWizardPanelContent>
                  ) : <Skeleton className="h-32 w-full bg-v3-dim-white" />,
                },
                { key: "description", children: <div className="space-y-3 text-sm leading-relaxed text-v3-text-muted"><p>동작 설명.</p></div> },
              ]}
            />
          </DetailPanel>
        )}
      </SplitLayout>
    </section>
  );
}
```

여러 항목을 사용자가 만들고 지우는 화면이면 위 스캐폴드에 `TriggerRulesManager`의 다음 요소를 더한다:
`ListPanel tabs`(활성화/비활성화 필터), `headerActions={<HeaderActionButton icon={Plus} label="새 규칙" />}`,
선택 값 `"new"`, footer의 삭제 버튼, `hasChanges`를 `JSON.stringify(normalize(form)) !== JSON.stringify(normalize(saved))`로 계산.

### 8.3 컴포넌트별 필수·금지 prop

**`SplitLayout`** (`frontend/src/components/app/v3/SplitLayout.tsx`)

| prop | 규칙 |
|---|---|
| `data-component` | 필수. `component("split-layout")` |
| `hasSelection` | 필수. `selectedId !== null`. 모바일 폭에서 상세 패널 전환의 기준이므로 `false` 고정 금지 |
| `children` | 정확히 `ListPanel` 하나 + `DetailPanel` 하나 (순서 고정). 다른 요소를 끼워 넣지 않는다 |
| `columns`, `activePanel`, `onBack` | 3열 화면(계약서 생성 세션)에서만. 일반 매니저는 쓰지 않는다 |

**`ListPanel`** (`ListPanel.tsx`)

| prop | 규칙 |
|---|---|
| `data-component`, `title` | 필수 |
| `subtitle` | 한 문장 설명. 개수 표기 금지 |
| `tabs`/`activeTab`/`onTabChange` | 상태 필터가 있을 때만. `TabItem = { label, value }` |
| `headerActions` | 생성 가능할 때만 `HeaderActionButton` |
| `searchValue`/`onSearchChange` | 항목 10개 이상일 때만 |
| `emptyState` | `ListEmptyState`. `children`이 비었을 때 자동 표시 |
| `disabled` + `disabledOverlay` | 권한 게이트 전용 |
| `avatar`, `headerPadding`, `className` | 매니저 화면에서 금지 (특수 화면 전용) |
| `children` | `AnimatedSlotList` 하나. `InfoCard`·`div` 나열 금지 |

**`AnimatedSlotList<T>`** (`AnimatedSlotList.tsx`)

| prop | 규칙 |
|---|---|
| `items`, `isLoading` | 필수. 로딩 중엔 `items={undefined}` |
| `loadingCount` | 예상 개수(1~5) |
| `getSlotState` | `{ isActive: 선택됨, isInteractive: 클릭 가능 }` 반환. 선택 하이라이트는 이 경로로만 |
| `onSlotClick` | 선택 setter. 행 내부에 `onClick div`를 따로 두지 않는다 |
| `getItemKey` | 필수 (`item.id`) |
| `render` | `isLoading`이면 `Skeleton`, 아니면 `AnimatedSlotListItemContent` 하나만 반환 |
| `hasMore`/`onLoadMore`/`isFetchingMore` | 무한 스크롤 목록일 때만 |
| `slotClassName`, `itemVariant` | 금지 (시각 변형은 컴포넌트 내부 책임) |

**`AnimatedSlotListItemContent`** (`AnimatedSlotListItemContent.tsx`)

| prop | 규칙 |
|---|---|
| `dataComponent`, `icon`, `title` | 필수. `icon`은 lucide 컴포넌트 참조(`CalendarCheck`), JSX 아님 |
| `subtitle` | ` · ` 구분 요약 문자열 |
| `status` | `Switch` 또는 `StatusBadge` 하나. `Switch`에는 `aria-label` + `onClick={(e) => e.stopPropagation()}` 필수 (행 선택과 분리) |
| `meta` | 날짜·카운트 같은 보조 텍스트 하나 |
| `*ClassName` 계열 | 금지 |

**`DetailPanel`** (`DetailPanel.tsx`)

| prop | 규칙 |
|---|---|
| `data-component` | 필수. 빈 상태와 선택 상태의 값이 달라야 한다 (`detail-panel-empty` / `detail-panel`) |
| `title`, `subtitle` | 선택 시 필수 |
| `isLoading` | 쿼리 로딩 전달 |
| `tabs` | `DetailTabs` 엘리먼트 (2종 이상 내용일 때) |
| `footer` | `Button`만. 순서: 보조(되돌리기/삭제) → 주(저장). `variant`는 `outline`/`positive`/`destructive` |
| `overlay` | 선택 없음일 때 `DetailEmptyState`; 이때 `children`은 `{null}` |
| `emptyState` | `overlay`와 혼용 금지. 하나만 |
| `badges*`, `trailing`, `stepper`, `headerAction`, `backAction` | 문서 상세 화면 전용. 설정 매니저에서 쓰지 않는다 |
| `children` | `DetailTabPanels` 또는 `SteppedWizardPanelContent` 하나 |

**`DetailTabs` / `DetailTabPanels`** (`DetailTabs.tsx`, `DetailTabPanels.tsx`)

| prop | 규칙 |
|---|---|
| `tabs` | `{ key, label }[]`를 `as const` 상수로 선언. 라벨은 "규칙 설정", "미리보기", "동작 설명" 같은 명사형 |
| `activeTab`/`onTabChange` | 두 컴포넌트에 같은 상태를 넘긴다 |
| `panels` | `tabs`와 `key` 1:1 |
| `DetailTabPanels` className 3종 | `className="flex min-h-0 flex-1" trackClassName="min-h-0 flex-1" panelClassName="h-full min-h-0"` 고정 (스크롤 영역 확보) |

**`ListEmptyState` / `DetailEmptyState`**: `message` 필수, `icon`은 행과 같은 아이콘. `className` 금지.

**`SectionNav`** (`SectionNav.tsx`): `items`는 `readonly SectionNavItem[]` (`{ id, label, icon, disabled? }`), `activeId`, `onSelect`. `footer`는 페이지 전역 액션이 있을 때만.

### 8.4 자주 나는 실수 (이 목록에 있으면 리뷰에서 바로 반려)

1. `ListPanel` 안에 `InfoCard`/`InfoRow`를 나열해 "목록"이라고 부른다 → 행은 `AnimatedSlotListItemContent`.
2. `SplitLayout hasSelection={false}` 고정 → 선택 상태를 넘겨야 모바일 폭에서 상세로 전환된다.
3. `DetailPanel`을 `DetailEmptyState`만 넣고 끝낸다 → 선택 시 렌더될 실제 상세를 만든다.
4. 설정값을 상수 배열에 하드코딩 → 서버 조회(`useQuery`) + 저장(`useMutation`).
5. `ListPanel avatar`에 아이콘 박스 → 아이콘은 행의 `icon`.
6. page.tsx에 상수·시각 클래스·컴포넌트 정의 → organism으로 이동.
7. 행의 `Switch`에 `stopPropagation` 누락 → 토글할 때 행이 같이 선택된다.
8. `DetailTabPanels`의 className 3종 누락 → 패널이 스크롤되지 않고 잘린다.
9. 빈 상태·선택 상태 `DetailPanel`의 `data-component`가 같다 → 각각 `detail-panel-empty` / `detail-panel`.
10. 토스트 문구를 "성공적으로 저장되었습니다"처럼 쓴다 → "저장했어요" / "저장하지 못했어요".
11. 자유 입력(`TitleTextInputMolecule`)으로 일수·횟수를 받는다 → 옵션이 정해진 값은 `TitleSelectMolecule`.
12. 테스트 없이 커밋 → §5 최소 3건.

## 8.5 모바일(m.admin) 차이점 — 브라우저 API는 Next 프록시를 거친다

모바일 앱의 `api` 클라이언트는 브라우저에서 `baseURL: "/api"`를 쓴다 (`mobile/src/lib/api/client.ts`). 즉 **백엔드에 엔드포인트가 있어도 `mobile/src/app/api/<path>/route.ts` 핸들러가 없으면 404**다. 데스크톱(`frontend/`)은 백엔드를 직접 호출하므로 같은 화면이 데스크톱에서만 동작하는 사고가 난다.

- 사고 (2026-09-02): 계약서 `자동화` 섹션을 모바일에 이식했을 때 `settingsApi`만 추가하고 `/api/settings/contract-automation-policies` 프록시를 빠뜨려 "자동화 설정을 불러오지 못했습니다"가 떴다. PR #604 → 후속 수정.
- 규칙: 모바일에서 새 `settingsApi`/도메인 API 함수를 추가할 때는 **같은 커밋에** `mobile/src/app/api/<same path>/route.ts`를 추가한다. 형식은 이웃 파일 복제 — GET은 `message-automation-policies/route.ts`, 검증이 있는 PUT은 `message-automation-policies/past-trigger/route.ts` (`zod` 스키마로 백엔드 DTO 범위를 그대로 반복).
- 테스트: `mobile/src/app/api/settings/__tests__/`에 401·400·프록시 성공 케이스를 둔다 (`contract-automation-policies.route.test.ts` 참고).
- 모바일 화면 조립은 §8이 아니라 `MessagesTriggersPage` 패턴(`MobileDetailSheet` + `ListCard` + `ListItemRow` + `MobileDetailPage` 에디터)을 따른다. 데스크톱 `SplitLayout` 계열은 모바일에 없다.

## 9. 이 문서를 바꿔야 할 때

- `TriggerRulesManager`의 패턴이 바뀌면 이 문서 §2를 같은 커밋에서 갱신한다.
- 새 v3 컴포넌트가 이 화면 유형에 들어오면 §2.1 뼈대와 §6 체크리스트에 추가한다.
- ESLint 규칙이 추가되면 §1.1 금지 목록에 rule id를 적는다.
