@~/.agents/playbook/AGENTS.md

## Repo-local: UI 작업 규칙 (BabyJamJam Design System)

frontend/mobile의 UI를 만들거나 고치기 전에 **반드시** 다음 두 파일을 먼저 읽는다:

1. `docs/design-system/AGENT_UI_RULES.md` — 작업/보고 프로토콜과 금지 목록
2. `docs/design-system/component-manifest.json` — 사용 가능한 컴포넌트 전체 목록 (import 경로·대체 패턴 포함)

금지 요약 (ESLint `ui-architecture/*` rule + `lint:ui-architecture` baseline 게이트로 CI 강제):

- `page.tsx` 안에 local 컴포넌트를 정의하지 않는다 — 디자인 시스템 레이어로 추출 후 import.
- `INPUT_CLS` 같은 Tailwind 문자열 상수를 page에 두지 않는다.
- page에서 raw `<button>`/`<input>`/`<select>`/`<textarea>`/`<dialog>`를 쓰지 않는다.
- page의 className에는 layout 클래스만 — 시각 스타일(`bg-*`, `text-*`, `border-*`, `rounded-*`, `shadow-*`)은 컴포넌트 내부로.
- 필요한 컴포넌트가 없으면 page에 만들지 말고, 디자인 시스템에 추가를 먼저 제안한다.
