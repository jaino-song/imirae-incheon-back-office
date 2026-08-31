# 통화 인박스 런칭 체크리스트 (2026-09-01)

운영자용. Phase 1–4 코드는 `call-inbox-productionization` 통합 브랜치에 완료 — 이 문서는 남은 운영 절차 전부다. 순서대로 진행한다.

**Spec:** `docs/superpowers/specs/2026-09-01-call-inbox-productionization-design.md` · **Linear:** BJJ-231 (프로젝트 `통화 인박스`)
**주의:** BJJ-231 본문의 PR #272·Railway 언급은 6월 기준으로 낡았다 — 이 체크리스트가 우선한다 (프로덕션 백엔드는 현재 Lightsail).

## 0. 코드 반영 (개발자 확인 필요)

- [ ] `call-inbox-productionization` → `dev` 머지 (머지 전 `git merge dev`로 최신 dev 반영·체크 재실행)
- [ ] CI green 확인 — 특히 **auth-e2e enforce leg** (`.github/workflows/backend-ci.yml:128-142`). 로컬에 docker가 없어 transitive-tenant-isolation 스펙의 런타임 실행은 CI가 유일한 검증 지점이다.
- [ ] release train으로 `preview` → `main` 승격 (열려 있는 #591 트레인 합류 또는 후속 트레인)
- [ ] Lightsail 배포 완료 확인 (api.babyjamjam.com 헬스체크)

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

## 4. 스모크 테스트 (인천점)

- [ ] 테스트 녹음 1건 투하 → **~2분 내** m.staff 통화요약 검토 대기에 표시
- [ ] 요약 품질 확인: 용어(산후도우미·조리원 등) 교정, 화자 역할(아이미래로/고객 등) 정확, 구조화 요약 4키(문의유형·고객정보·핵심내용·처리결과) 채워짐
- [ ] 실제 신규상담 1건 → [고객 등록]까지 통과 → 발송 내역에서 **인사문자 발송 확인** (억제 스위치 껐을 때)
- [ ] 문제 발생 시: `docs/n8n/README.md` 트러블슈팅 표 (401=토큰, 400=payload 형태, 200 duplicate=정상 멱등 재시도)

## 5. Tenancy enforce 전환 (별도 트랙 — 런칭과 독립)

`backend/README.md:390-432` 런북을 따른다. 요약:

- [ ] preview에서 tenant 위반 로그 번인 (observe 모드 로그 모니터링)
- [ ] staging `TENANT_ISOLATION_MODE=enforce` 전환
- [ ] **7일 무위반** 후 프로덕션 env만 전환 (코드 배포 불필요)

## 6. 마감

- [ ] Linear BJJ-231 체크박스 정리 후 완료 처리
- [ ] Linear 프로젝트 설명을 신규 아키텍처(3.5-transcribe + 백엔드 refine/extract)로 갱신
- [ ] 롤백 필요 시: n8n 워크플로 비활성화만으로 유입 중단 (녹음은 Drive에 남아 재처리 가능). enforce 롤백은 env를 `observe`로 되돌리면 끝.
