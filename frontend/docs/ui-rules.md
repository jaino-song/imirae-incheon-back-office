# Desktop UI Rules — 섹션·매니저 화면 조립 규칙

> 대상: `frontend/` 데스크톱 관리자 앱의 모든 화면 작업 (사람·에이전트 공통).
> 상위 문서는 [`docs/design-system/AGENT_UI_RULES.md`](../../docs/design-system/AGENT_UI_RULES.md)이다.
> 그 문서가 "무엇을 금지하는가"를 ESLint 기준으로 정의한다면, 이 문서는 **"그래서 화면을 어떻게 조립하는가"**를
> 실제 기준 구현(`TriggerRulesManager`)에 맞춰 단계별로 못 박는다. 두 문서가 충돌하면 상위 문서와 ESLint가 이긴다.

**기준 구현 (canonical reference):**

| 역할 | 파일 |
|---|---|
| 섹션 페이지 골격 | `src/app/(protected)/messages/page.tsx` (`SectionNav` + 섹션별 organism 마운트) |
| 목록+상세 매니저 organism | `src/components/app/messages/TriggerRulesManager.tsx` |
| 계약서 페이지 적용 예 | `src/app/(protected)/contracts/page.tsx` + `src/components/app/contracts/ContractAutomationsManager.tsx` |
| 디자인 시스템 배럴 | `src/components/app/v3/index.ts` |
| 폼 분자(molecule) | `src/components/ui/title-select-molecule.tsx`, `title-text-input-molecule.tsx`, `title-textarea-molecule.tsx`, `switch.tsx` |
| 토큰 | `src/app/globals.css` (`--v3-*`, `--status-*`, `--glint-ui-scale`) |
| DOM 주석 규약 | `DATA-COMPONENT-CONVENTION.md` |

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

- 모든 v3 컴포넌트에 `data-component={component("…")}`를 넘긴다. 규칙은 `DATA-COMPONENT-CONVENTION.md`.
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
- API 함수는 `src/services/api.ts`의 도메인 객체(`settingsApi`, …)에 추가한다. 컴포넌트에서 `api.get`을 직접 부르지 않는다.
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

## 8. 이 문서를 바꿔야 할 때

- `TriggerRulesManager`의 패턴이 바뀌면 이 문서 §2를 같은 커밋에서 갱신한다.
- 새 v3 컴포넌트가 이 화면 유형에 들어오면 §2.1 뼈대와 §6 체크리스트에 추가한다.
- ESLint 규칙이 추가되면 §1.1 금지 목록에 rule id를 적는다.
