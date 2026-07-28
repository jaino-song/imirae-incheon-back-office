# 아이미래로 인천 백오피스 디자인 시스템

> ⚠️ **부분 노후 문서.** 색상 토큰·타이포·애니메이션 표(§2–§3, §5–§6)는 여전히 참고 가능하지만,
> §4 컴포넌트 아키텍처의 디렉토리 구조는 Vite 시절 설명으로 현재 코드와 다르다.
> 현재 canonical은 [`docs/design-system/`](../design-system/AGENT_UI_RULES.md)
> (작업 규칙 + [component-manifest.json](../design-system/component-manifest.json))과
> [`frontend/docs/design-system/README.md`](../../frontend/docs/design-system/README.md)(설계 원칙)다.

## 1. 개요 (Overview)

### 프로젝트 정보
- **프로젝트명:** 아이미래로 인천 백오피스
- **디자인 철학:** 전문적이고 신뢰감 있는 기업 스타일
- **기술 스택:** React, Vite, Tailwind CSS, TypeScript, shadcn/ui

### 핵심 원칙
- 일관된 시각적 언어
- 접근성 우선 설계
- 다크 모드 완벽 지원
- 한국어 타이포그래피 최적화

---

## 2. 색상 시스템 (Color System)

모든 색상은 HSL 형식으로 정의됩니다.

### 2.1 기본 색상

| 토큰 | 라이트 모드 | 다크 모드 | 용도 |
|------|-------------|-----------|------|
| `--background` | `210 20% 98%` | `220 20% 10%` | 페이지 배경 |
| `--foreground` | `220 20% 10%` | `210 40% 98%` | 기본 텍스트 |
| `--card` | `0 0% 100%` | `220 20% 14%` | 카드 배경 |
| `--card-foreground` | `220 20% 10%` | `210 40% 98%` | 카드 텍스트 |
| `--popover` | `0 0% 100%` | `220 20% 14%` | 팝오버 배경 |
| `--popover-foreground` | `220 20% 10%` | `210 40% 98%` | 팝오버 텍스트 |

### 2.2 시맨틱 색상

| 토큰 | 라이트 모드 | 다크 모드 | 용도 |
|------|-------------|-----------|------|
| `--primary` | `217 71% 24%` | `217 91% 60%` | 주요 브랜드 색상 (네이비) |
| `--primary-foreground` | `210 40% 98%` | `220 20% 10%` | Primary 위 텍스트 |
| `--secondary` | `210 40% 96%` | `217 32% 18%` | 보조 요소 |
| `--secondary-foreground` | `217 71% 24%` | `210 40% 98%` | Secondary 위 텍스트 |
| `--muted` | `210 20% 96%` | `217 32% 18%` | 비활성/흐린 요소 |
| `--muted-foreground` | `215 16% 47%` | `215 20% 65%` | 흐린 텍스트 |
| `--accent` | `217 91% 60%` | `217 71% 24%` | 강조 색상 (블루) |
| `--accent-foreground` | `0 0% 100%` | `210 40% 98%` | Accent 위 텍스트 |

### 2.3 상태 색상

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--destructive` | `0 84% 60%` | 삭제/위험 액션 (빨강) |
| `--success` | `142 76% 36%` | 성공 상태 (초록) |
| `--warning` | `38 92% 50%` | 경고 상태 (노랑) |
| `--info` | `217 91% 60%` | 정보 상태 (파랑) |

### 2.4 UI 요소 색상

| 토큰 | 라이트 모드 | 다크 모드 | 용도 |
|------|-------------|-----------|------|
| `--border` | `214 32% 91%` | `217 32% 18%` | 테두리 |
| `--input` | `214 32% 91%` | `217 32% 18%` | 입력 필드 테두리 |
| `--ring` | `217 71% 24%` | `217 91% 60%` | 포커스 링 |
| `--radius` | `0.5rem` | `0.5rem` | 기본 border-radius |

### 2.5 사이드바 색상

| 토큰 | 라이트 모드 | 다크 모드 | 용도 |
|------|-------------|-----------|------|
| `--sidebar-background` | `217 71% 18%` | `220 20% 8%` | 사이드바 배경 |
| `--sidebar-foreground` | `210 40% 98%` | `210 40% 98%` | 사이드바 텍스트 |
| `--sidebar-primary` | `217 91% 60%` | `217 91% 60%` | 사이드바 강조 |
| `--sidebar-accent` | `217 71% 24%` | `217 32% 18%` | 사이드바 액센트 |
| `--sidebar-border` | `217 71% 24%` | `217 32% 18%` | 사이드바 테두리 |

### 2.6 차트 색상

| 토큰 | 값 | 시각적 색상 |
|------|-----|-------------|
| `--chart-1` | `217 91% 60%` | 파랑 (Primary) |
| `--chart-2` | `142 76% 36%` | 초록 (Success) |
| `--chart-3` | `38 92% 50%` | 노랑 (Warning) |
| `--chart-4` | `280 65% 60%` | 보라 |
| `--chart-5` | `0 84% 60%` | 빨강 (Destructive) |

### 2.7 Tailwind 사용법

```tsx
// ✅ 올바른 사용법 - 시맨틱 토큰
<div className="bg-background text-foreground" />
<button className="bg-primary text-primary-foreground" />
<span className="text-muted-foreground" />
<div className="border-border" />
<span className="text-success" />

// ❌ 잘못된 사용법 - 직접 색상 사용 금지
<div className="bg-white text-black" />
<button className="bg-blue-600" />
```

---

## 3. 타이포그래피 (Typography)

### 3.1 폰트 패밀리

```css
font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, 
             system-ui, Roboto, "Helvetica Neue", "Segoe UI", 
             "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", 
             "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif;
```

### 3.2 한국어 최적화
- **Pretendard Variable**: 한글에 최적화된 가변 폰트
- 다양한 굵기(100-900) 지원
- 영문/한글 조화로운 글자폭

### 3.3 크기 스케일 (Tailwind 기본)

| 클래스 | 크기 | 용도 |
|--------|------|------|
| `text-xs` | 0.75rem (12px) | 캡션, 라벨 |
| `text-sm` | 0.875rem (14px) | 본문 작은 텍스트 |
| `text-base` | 1rem (16px) | 기본 본문 |
| `text-lg` | 1.125rem (18px) | 카드 제목 |
| `text-xl` | 1.25rem (20px) | 섹션 제목 |
| `text-2xl` | 1.5rem (24px) | 페이지 제목 |
| `text-3xl` | 1.875rem (30px) | 대형 숫자/통계 |

### 3.4 굵기

| 클래스 | 굵기 | 용도 |
|--------|------|------|
| `font-normal` | 400 | 본문 |
| `font-medium` | 500 | 라벨, 강조 |
| `font-semibold` | 600 | 소제목 |
| `font-bold` | 700 | 제목, 통계 |

---

## 4. 컴포넌트 아키텍처 (Component Architecture)

### 4.1 디렉토리 구조

```
src/components/
├── ui/                    # 기본 UI 컴포넌트 (shadcn/ui)
│   ├── button.tsx
│   ├── card.tsx
│   ├── input.tsx
│   ├── table.tsx
│   └── ...
├── dashboard/             # 대시보드 전용 컴포넌트
│   ├── StatCard.tsx
│   ├── MonthlyContractsChart.tsx
│   ├── ServiceDistributionChart.tsx
│   ├── TodayScheduleList.tsx
│   ├── PendingClientsTable.tsx
│   ├── RecentClientsTable.tsx
│   ├── QuickActions.tsx
│   ├── DashboardHero.tsx
│   ├── PendingReservationsCard.tsx
│   └── index.ts
└── layout/                # 레이아웃 컴포넌트
    ├── AppSidebar.tsx
    ├── DashboardHeader.tsx
    ├── DashboardLayout.tsx
    └── index.ts
```

### 4.2 컴포넌트 레벨

1. **UI 컴포넌트** (`ui/`): 재사용 가능한 기본 요소 (shadcn/ui 기반)
2. **Feature 컴포넌트** (`dashboard/`): 특정 기능에 특화된 컴포넌트
3. **Layout 컴포넌트** (`layout/`): 페이지 구조를 정의하는 컴포넌트

### 4.3 사용 예시

```tsx
// UI 컴포넌트 import
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// 대시보드 컴포넌트 import
import { StatCard, MonthlyContractsChart } from "@/components/dashboard";

// 레이아웃 import
import { DashboardLayout } from "@/components/layout";
```

---

## 5. 애니메이션 시스템 (Animation System)

### 5.1 Keyframes 정의

| 이름 | 효과 | 용도 |
|------|------|------|
| `fade-in` | 페이드인 + 위로 슬라이드 (10px) | 컴포넌트 진입 |
| `fade-in-up` | 페이드인 + 위로 슬라이드 (20px) | 강조된 진입 |
| `scale-in` | 페이드인 + 스케일 (0.95 → 1) | 모달, 카드 |
| `slide-in-left` | 왼쪽에서 슬라이드 | 사이드바 항목 |
| `slide-in-right` | 오른쪽에서 슬라이드 | 알림 |
| `bounce-subtle` | 위아래 미세한 바운스 | 알림 뱃지 |
| `pulse-subtle` | 투명도 변화 | 로딩 상태 |
| `shimmer` | 배경 위치 이동 | 스켈레톤 로딩 |
| `icon-bounce` | 아이콘 바운스 | 아이콘 호버 |
| `glow` | 박스 쉐도우 애니메이션 | 강조 효과 |

### 5.2 Animation 클래스

| 클래스 | 지속 시간 | 이징 |
|--------|-----------|------|
| `animate-fade-in` | 0.4s | ease-out |
| `animate-fade-in-up` | 0.5s | ease-out |
| `animate-scale-in` | 0.3s | ease-out |
| `animate-slide-in-left` | 0.3s | ease-out |
| `animate-slide-in-right` | 0.3s | ease-out |
| `animate-bounce-subtle` | 1s | ease-in-out, infinite |
| `animate-pulse-subtle` | 2s | ease-in-out, infinite |
| `animate-shimmer` | 2s | linear, infinite |
| `animate-icon-bounce` | 0.3s | ease-out |
| `animate-glow` | 2s | ease-in-out, infinite |

### 5.3 Stagger 딜레이 클래스

순차적인 애니메이션 진입을 위한 딜레이:

| 클래스 | 딜레이 |
|--------|--------|
| `.animate-stagger-1` | 0ms |
| `.animate-stagger-2` | 75ms |
| `.animate-stagger-3` | 150ms |
| `.animate-stagger-4` | 225ms |
| `.animate-stagger-5` | 300ms |
| `.animate-stagger-6` | 375ms |

### 5.4 사용 예시

```tsx
// 기본 페이드인
<Card className="opacity-0 animate-fade-in" />

// 딜레이와 함께 사용
<Card className="opacity-0 animate-fade-in" style={{ animationDelay: "100ms" }} />

// Stagger 클래스 사용
<Card className="opacity-0 animate-fade-in animate-stagger-2" />
```

---

## 6. 인터랙션 패턴 (Interaction Patterns)

### 6.1 호버 효과 유틸리티 클래스

| 클래스 | 효과 | 용도 |
|--------|------|------|
| `.hover-lift` | 위로 살짝 올라감 + 그림자 증가 | 카드, 버튼 |
| `.hover-glow` | Primary 색상 글로우 | 중요 요소 강조 |
| `.hover-border` | 테두리 색상 변화 | 카드, 입력 필드 |
| `.icon-hover-bounce` | 아이콘 바운스 | 아이콘 버튼 |
| `.icon-hover-scale` | 아이콘 1.1배 확대 | 아이콘 버튼 |
| `.row-hover` | 행 배경색 변화 | 테이블 행 |
| `.schedule-item-hover` | 배경색 + 왼쪽 테두리 | 일정 항목 |
| `.menu-item-slide` | 오른쪽으로 살짝 이동 | 메뉴 항목 |

### 6.2 클릭/프레스 효과

| 클래스 | 효과 | 용도 |
|--------|------|------|
| `.btn-press` | 클릭 시 0.95배 축소 | 버튼 |

### 6.3 포커스 효과

| 클래스 | 효과 | 용도 |
|--------|------|------|
| `.search-expand` | 포커스 시 너비 확장 | 검색 입력 |
| `.active-indicator` | 왼쪽 primary 세로 바 | 활성 메뉴 항목 |

### 6.4 사용 예시

```tsx
// 카드 호버 리프트
<Card className="hover-lift">...</Card>

// 아이콘 버튼 호버
<Button variant="ghost" size="icon" className="icon-hover-scale">
  <Settings className="h-5 w-5" />
</Button>

// 테이블 행 호버
<TableRow className="row-hover">...</TableRow>

// 버튼 프레스 효과
<Button className="btn-press">저장</Button>

// 활성 메뉴 표시
<div className="active-indicator">메뉴 항목</div>
```

---

## 7. 레이아웃 시스템 (Layout System)

### 7.1 컨테이너

```ts
// tailwind.config.ts
container: {
  center: true,
  padding: "2rem",
  screens: {
    "2xl": "1400px",
  },
}
```

### 7.2 반응형 그리드 패턴

```tsx
// 4열 통계 카드 그리드
<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
  <StatCard />
  <StatCard />
  <StatCard />
  <StatCard />
</div>

// 2열 차트 그리드
<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
  <Chart />
  <Chart />
</div>

// 3열 콘텐츠 그리드
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <Content />
  <Content />
  <Content />
</div>
```

### 7.3 대시보드 레이아웃 구조

```tsx
<SidebarProvider>
  <div className="flex min-h-screen w-full overflow-hidden">
    <AppSidebar />
    <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
      <DashboardHeader />
      <main className="flex-1 overflow-auto p-4 lg:p-6 min-w-0">
        {children}
      </main>
    </div>
  </div>
</SidebarProvider>
```

### 7.4 간격 (Spacing)

| 클래스 | 값 | 용도 |
|--------|-----|------|
| `gap-2` | 0.5rem (8px) | 타이트한 간격 |
| `gap-4` | 1rem (16px) | 기본 간격 |
| `gap-6` | 1.5rem (24px) | 넓은 간격 |
| `p-4` | 1rem (16px) | 모바일 패딩 |
| `lg:p-6` | 1.5rem (24px) | 데스크톱 패딩 |

### 7.5 Border Radius

| 클래스 | 값 | 계산식 |
|--------|-----|--------|
| `rounded-lg` | 0.5rem (8px) | `var(--radius)` |
| `rounded-md` | 0.375rem (6px) | `calc(var(--radius) - 2px)` |
| `rounded-sm` | 0.25rem (4px) | `calc(var(--radius) - 4px)` |

---

## 8. 다크 모드

### 8.1 구현 방식

- `next-themes` 패키지 사용
- CSS 변수 기반 테마 전환
- `.dark` 클래스로 다크 모드 활성화

### 8.2 색상 전환 원칙

1. **배경**: 밝은 → 어두운
2. **텍스트**: 어두운 → 밝은
3. **Primary**: 어두운 네이비 → 밝은 블루
4. **대비 유지**: 항상 WCAG 기준 충족

### 8.3 개발 시 주의사항

```tsx
// ✅ 자동으로 다크 모드 지원
<div className="bg-background text-foreground" />

// ❌ 다크 모드에서 문제 발생
<div className="bg-white text-gray-900" />
```

---

## 9. 빠른 참조

### 자주 사용하는 조합

```tsx
// 기본 카드
<Card className="hover-lift opacity-0 animate-fade-in">

// 통계 카드
<Card className="hover-lift hover-glow opacity-0 animate-fade-in">

// 아이콘 버튼
<Button variant="ghost" size="icon" className="icon-hover-scale">

// 테이블 행
<TableRow className="row-hover">

// 클릭 가능한 항목
<div className="cursor-pointer schedule-item-hover">

// 순차 진입 애니메이션 (여러 카드)
{items.map((item, i) => (
  <Card 
    key={item.id}
    className="opacity-0 animate-fade-in"
    style={{ animationDelay: `${i * 75}ms` }}
  />
))}
```

---

*최종 업데이트: 2026-02-01*
