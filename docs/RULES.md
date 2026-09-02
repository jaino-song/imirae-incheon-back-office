# Rules Index

프로젝트 규칙 문서의 단일 색인. 새 규칙 문서를 만들면 여기에 한 줄 추가한다. 규칙 문서는 도메인 폴더(`frontend/`, `backend/`)가 아니라 이 `docs/`에 둔다.

각 문서는 같은 뼈대를 따른다: 범위 → 기준 구현 파일 → 규칙(표) → 복사용 스캐폴드(있으면) → 반려 체크리스트 → 실제 사고 사례 → 갱신 시점.

| 문서 | 범위 | 강제 수단 |
|---|---|---|
| [design-system/AGENT_UI_RULES.md](./design-system/AGENT_UI_RULES.md) | page.tsx 금지 목록, UI 작업 시작·완료 프로토콜, 컴포넌트 manifest | ESLint `ui-architecture/*`, `data-component/*`, `lint:ui-architecture` baseline |
| [ui-rules.md](./ui-rules.md) | 데스크톱 섹션 페이지와 목록+상세(SplitLayout) 매니저 화면 조립, 토큰, 카피, 테스트, 스캐폴드 | 리뷰 반려 목록 (§8.4) |
| [devops-deployment-rules.md](./devops-deployment-rules.md) | 브랜치·CI·DB 패치·Lightsail/Vercel 배포·플래그·env·릴리스 체크리스트 | CI 게이트, 리뷰 반려 목록 (§10) |

예정 (아직 없음): 폼·다이얼로그 레시피, 문서 상세 화면, 데이터 테이블, 상태 어휘, 피드백 표면(토스트·확인 모달), 모바일 UI, 프론트 데이터 레이어, 백엔드 설정·스케줄러 패턴, 테넌시, 테스트 규약.
