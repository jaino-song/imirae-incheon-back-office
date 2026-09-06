# 통화 인박스 — 지점별 n8n 워크플로 온보딩

이 폴더는 통화 녹취 → 전사(gemini-3.5-transcribe) → 백엔드 ingest 파이프라인의 **지점별 템플릿**을 담고 있습니다. n8n은 순수 plumbing만 담당합니다 — 용어 교정, 화자→역할 매핑, 통화 요약은 백엔드 refine → extract 단계에서 처리됩니다.
신규 지점을 연결할 때마다 템플릿을 1회 복제하고 4개의 placeholder만 채우면 됩니다.

- 템플릿: [`call-transcription-branch-template.json`](./call-transcription-branch-template.json)
- 설계 근거: [`../superpowers/specs/2026-09-01-call-inbox-productionization-design.md`](../superpowers/specs/2026-09-01-call-inbox-productionization-design.md) §4.1 (신규 n8n 브랜치 템플릿 — thin plumbing)
- API 계약: [`../api/call-inbox-api.md`](../api/call-inbox-api.md) (§4 Operator-side `POST /webhooks/call-transcripts`)

## 파이프라인 개요

```
Google Drive Trigger (지점 폴더 1/min 감시)
  → Download file
  → Get Vocabulary               (Download file와 병렬; GET .../webhooks/call-transcripts/vocabulary → {version, phrases})
  → Initialize Upload Session    (Gemini resumable upload)
  → Merge Upload URL + Binary
  → Upload File to Gemini
  → Build Transcribe Request     (gemini-3.5-transcribe 요청 빌드: ko-KR, diarization_mode=speaker, custom_vocabulary=Get Vocabulary의 phrases)
  → Gemini Transcribe Audio      (POST /v1beta/interactions — 실패 시 아래 폴백 참고)
  → Build Webhook Payload        (driveFileId/fileName/recordedAt?/sttModel/diarized/vocabularyVersion/transcriptRaw)
  → Send to Backend              (POST api.babyjamjam.com/webhooks/call-transcripts, retry 10s)
```

전사는 **1회 호출**입니다. `Get Vocabulary`가 Download file 직후 병렬로 실행되어 백엔드 어휘 사전을 버전과 함께 미리 받아두고, `Gemini Transcribe Audio`가 diarization(화자분리) 활성 상태로 gemini-3.5-transcribe를 1회 호출합니다. **이 호출이 어떤 이유로든 실패하면** — 설계상 의도된 사유는 diarization 한도(30분) 초과지만, 현재 폴백은 오류 종류를 구분하지 않으므로 일시적 429/503도 포함됩니다 — n8n이 diarization 없이 **정확히 1회만** 재시도합니다: `Build Non-Diarized Retry Request → Gemini Transcribe Audio (Non-Diarized Retry)`. 이때 웹훅 payload는 `diarized: false`로 표시됩니다. 짧은 통화가 `diarized: false`로 도착했다면 30분 한도가 아니라 일시 오류가 원인이므로, n8n 실행 로그에서 primary 노드의 오류를 확인하세요(실 API 오류 형태 확인 후 IF 노드로 diarization-한도 오류만 폴백하도록 좁히는 것이 launch checklist 항목입니다). 두 경로 모두 `Build Webhook Payload`로 수렴해 raw diarized transcript(`transcriptRaw`, 역할 매핑 없음)를 만듭니다 — 용어 교정과 화자→역할 매핑, 통화 요약은 이제 백엔드 refine → extract 단계에서 처리합니다(n8n은 순수 plumbing). 마지막 노드가 idempotent webhook(`driveFileId` = 멱등 키)으로 백엔드에 보냅니다.

## n8n 인스턴스 (셀프호스트)

n8n은 클라우드가 아니라 **`covenantlabsserver`에 docker compose로 셀프호스트**되어 있습니다 (2026-09-03 구축, n8n `2.37.7`). 인바운드가 필요한 노드가 없으므로(Drive 트리거는 폴링, 나머지는 아웃바운드 호출) 공개 노출 없이 **Tailscale 안에서만** 접근합니다.

| 항목 | 값 |
|---|---|
| 에디터 URL | `https://covenantlabsserver.taila61e66.ts.net` (tailnet 전용, `tailscale serve` → `127.0.0.1:5678`) |
| Google OAuth 리디렉션 URI | `https://covenantlabsserver.taila61e66.ts.net/rest/oauth2-credential/callback` (Google Cloud 콘솔의 OAuth 클라이언트에 등록) |
| 서버 경로 | `/opt/n8n/compose.yml` — 이 레포의 [`self-host/compose.yml`](./self-host/compose.yml)과 동일하게 유지 |
| 비밀 | `/opt/n8n/.env` = `N8N_ENCRYPTION_KEY` 하나 (chmod 600). 자격증명 복호화 키이므로 볼륨과 함께 백업 |
| 데이터 | docker volume `n8n_data` — SQLite(WAL), 오디오 바이너리는 디스크, 실행 이력 14일 보관 |

운영 명령 (`ssh covenant`):

```bash
cd /opt/n8n
docker compose ps / logs -f          # 상태·로그
docker compose pull && docker compose up -d   # compose.yml의 이미지 태그를 올린 뒤 업그레이드
docker compose down                  # 중지 (볼륨은 유지)
```

CLI로 템플릿을 넣을 때는 JSON에 `id`가 있어야 합니다(레포 템플릿에는 없음 → 서버 측 사본에 16자 영숫자 id를 추가):

```bash
docker cp wf.json n8n:/tmp/wf.json
docker exec -u node n8n n8n import:workflow --input=/tmp/wf.json
```

## 지점 연결 절차

### ① 템플릿 import

n8n → **Workflows** → **Import from File** → `call-transcription-branch-template.json` 선택.
import 직후 워크플로는 비활성(`active: false`) 상태이고, 아래 placeholder들이 채워지기 전에는 동작하지 않습니다.

### ② placeholder 4종 교체

| placeholder | 위치 | 채울 값 |
|---|---|---|
| `REPLACE_DRIVE_FOLDER_ID` | Google Drive Trigger → *Folder* | 이 지점 전용 녹음 폴더의 Drive 폴더 ID. 운영 계정에 공유되어 있어야 함 (아래 메모 참고). `Call Recordings — BRANCH_NAME` 표시명도 지점명으로 변경 |
| `REPLACE_DRIVE_CREDENTIAL_ID` | Google Drive Trigger + Download file 두 노드의 *Credential* | 운영자의 **단일** Google Drive OAuth 자격증명. 공유 폴더는 이 한 계정으로 폴더 ID만 알면 감시 가능 — 지점마다 새 OAuth 불필요 |
| `REPLACE_GEMINI_CREDENTIAL_ID` | Initialize Upload Session · Gemini Transcribe Audio · Gemini Transcribe Audio (Non-Diarized Retry) 세 노드의 *Header Auth* (`Gemini API KEY`) | Gemini API 키 header-auth 자격증명 |
| `REPLACE_CALL_INGEST_TOKEN` | Get Vocabulary · Send to Backend 두 노드의 *Header Parameters* → `Authorization: Bearer …` | 이 지점의 ingest 토큰 (`cit_…`). 아래에서 발급 |

**ingest 토큰 발급 (백엔드, admin 권한):**

```
POST /branches/:branchId/call-ingest-tokens
Body: { "label": "인천본점 n8n" }
→ { "token": "cit_…" }          ← 평문은 이때 한 번만 노출됨. 즉시 복사
```

토큰은 해시로만 저장되므로 분실 시 재발급(새 토큰 발급 + 기존 토큰 revoke)해야 합니다.
백엔드의 모든 하위 레코드는 토큰에 묶인 `branchId`를 상속합니다 — **payload에 지점 식별자를 싣지 않습니다.**

> **Drive 폴더 공유 메모.** 지점 전용 폴더(예: `Call Recordings — 인천본점`)는 두 가지 중 하나로 준비합니다: (a) 운영자가 만들어 지점에 공유, 또는 (b) 지점이 만들어 **운영자의 Google 계정**(n8n Drive 자격증명이 속한 그 단일 계정)에 공유. 어느 쪽이든 폴더 ID로 감시됩니다. 지점 전화기의 통화 자동 동기화 앱이 이 폴더로 녹음을 업로드합니다.

### ③ 워크플로 이름 변경

워크플로 이름 `Call Transcription — BRANCH_NAME`을 실제 지점명으로 변경합니다 (예: `Call Transcription — 인천본점`). 운영 콘솔에서 어느 워크플로가 어느 지점인지 식별하는 유일한 단서입니다 (지점↔폴더 매핑은 어느 워크플로가 어느 토큰을 쥐고 있는가로만 암묵 결정됨).

### ④ 활성화

워크플로 우상단 토글을 **Active**로 전환합니다.

### ⑤ 스모크 테스트

1. 지점 녹음 폴더에 샘플 오디오 파일 1개를 업로드합니다.
2. 약 1~2분 내(폴더 폴링 1/min + Gemini 전사 1회 호출)에 해당 지점의 **통화요약** 인박스에 통화가 1건 나타나는지 확인합니다.
3. **다른 지점에는 나타나지 않아야** 합니다 — 나타난다면 토큰/폴더 매핑이 잘못 연결된 것입니다.

오프보딩/로테이션: 토큰을 revoke(`POST /call-ingest-tokens/:id/revoke`)하면 정확히 그 소스 하나만 끊깁니다. 그 후 워크플로를 비활성화합니다.

## 문제 해결

| 증상 | 원인 | 조치 |
|---|---|---|
| Get Vocabulary 또는 Send to Backend **401** | ingest 토큰이 revoke되었거나 잘못된 지점의 토큰 | `Authorization` 헤더의 `cit_…` 값을 재확인 (두 노드 모두 같은 토큰을 씀). 필요 시 새 토큰 발급 후 교체 |
| Send to Backend **400** — 스키마 불일치 | payload 필드 누락 (필수: `driveFileId`, `fileName`, `sttModel`, `diarized`, `vocabularyVersion`, `transcriptRaw`) 또는 cap 초과 — `transcriptRaw` 최대 500 turn, `speaker` 최대 50자, `text` 최대 2,000자 (`backend/interface/dto/call-inbox.dto.ts:60,:64,:261`, 문서화: `docs/api/call-inbox-api.md:259-260`) | Build Webhook Payload 노드의 출력을 실행 로그에서 확인 — Gemini 응답 파싱이 정상인지, cap을 넘는 통화인지 점검 |
| Send to Backend **400** — body 크기 초과 | webhook body가 **1MB** 제한을 초과 (매우 긴 통화의 `transcriptRaw`) | 매우 긴 통화. diarization 폴백(§ 아래)이 이미 발동했는지, 캡 정책을 조정해야 하는지 확인 |
| 같은 파일이 **중복** 인박스 진입 우려 | — | `driveFileId`가 멱등 키. 동일 `driveFileId` 재전송 시 백엔드는 **200 no-op**으로 응답함 (n8n retry 상황에서 정상). 중복 레코드는 생기지 않음 |
| 통화 화자가 모두 `화자`로만 표시됨 (역할명 없음) | n8n의 **diarization 폴백**이 발동 — primary 전사 호출이 실패해 diarization 없이 재시도됨. 의도된 사유는 >30분 한도 초과지만, 현재 폴백은 오류 종류를 구분하지 않으므로 일시적 429/503도 여기에 해당됨 | n8n 실행 로그에서 primary `Gemini Transcribe Audio` 노드의 **오류 내용**을 확인하세요. 30분 한도 초과면 정상 동작(백엔드가 화자 귀속 없이 정제, 모바일은 중립 라벨 `화자` 표시). 짧은 통화인데 폴백이 발동했다면 일시 오류가 원인 — 원본 녹음이 Drive에 남아 있으므로 파일을 복제 업로드(새 `driveFileId`)하면 재처리됩니다 |
| 통화가 영영 안 나타남 | 폴더 ID/자격증명 오설정, 또는 워크플로 비활성 | Drive Trigger 노드의 폴더 ID·자격증명, 워크플로 Active 상태, 그리고 폴더에 실제로 파일이 올라왔는지 순서대로 확인 |

## Phase 3 메모

이 절차의 ①+③(워크플로 복제 + 토큰 주입)은 n8n REST API로 자동화할 수 있습니다(프로비저닝 플로). ②의 Drive 폴더 공유는 테넌트 측 Drive 액션으로 남습니다. 셀프서브 지점 설정 UI도 Phase 3 범위입니다.
