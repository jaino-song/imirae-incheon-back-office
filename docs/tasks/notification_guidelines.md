# Notification Guidelines

## Daily Summary Notifications (PWA Push)

매일 오전 9시(KST)에 각 활성 branch의 owner와 member에게 branch별 일일 digest를 전송합니다.
해당 조건을 만족하는 클라이언트가 있을 때만 알림이 전송됩니다.
사용자별 branch digest는 DB 알림 row 1개, PWA 푸시 1개, digest 이메일 1개로 구성됩니다.
푸시와 DB 알림 제목은 `오늘 확인할 알림이 {section_count}건 있습니다`이며, 본문은
`[{branch_name}] {section_summary} 지금 확인해 보세요.` 형식입니다.
이메일 제목은 `[아가잼잼] 오늘 확인할 알림이 {section_count}건 있습니다`로 유지하고,
branch 이름을 HTML 및 일반 텍스트 인사말에 포함합니다.

### 1. 서비스 시작 예정 섹션
- **조건**: 일주일 내 시작 예정인 서비스가 1건 이상
- **내용**: 일주일 내로 시작되는 서비스 {count}건
- **링크**: /clients/filtered?filter=starting-soon

### 2. 서비스 종료 예정 섹션
- **조건**: 일주일 내 종료 예정인 서비스가 1건 이상
- **내용**: 일주일 내로 종료되는 서비스 {count}건
- **링크**: /clients/filtered?filter=ending-soon

### 3. 계약서 미완료 섹션
- **조건**: 일주일 내 시작 예정 + 계약서 발송됨 + eformsign 상태가 완료(050)가 아닌 클라이언트가 1건 이상
- **내용**: 서비스 시작 예정이지만 계약서가 미완료된 클라이언트 {count}건
- **링크**: /clients/filtered?filter=incomplete-contracts

### 4. 계약서 미발송 섹션
- **조건**: 일주일 내 시작 예정 + 계약서가 발송되지 않은(eDocId가 null) 클라이언트
- **내용**: 아직 계약서가 발송되지 않은 고객 {count}명
- **링크**: /clients/filtered?filter=no-contract
- **특이사항**: 조건에 해당하는 클라이언트 이름은 이메일 섹션에 포함될 수 있으며, 모든 조건을 branch별 하나의 digest로 묶어 사용자별 DB 알림 row 1개, PWA 푸시 1개, 이메일 1개를 발송

링크는 섹션이 1개이면 해당 섹션 링크를 사용하고, 여러 섹션을 함께 보내면 `/`를 사용합니다.

---

## Notification Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{count}` | 해당 조건의 클라이언트 수 | 3 |
| `{section_count}` | digest에 포함된 섹션 수 | 2 |
| `{branch_name}` | digest를 생성한 branch 이름 | 인천점 |

## Digest Recipients

| Branch Scope | Receives Notifications |
|--------------|------------------------|
| Branch owner | Yes |
| Branch member | Yes |

수신자는 전역 역할 목록이 아니라 `findNotificationRecipientsByBranchId`로 branch별 owner와 member를 조회합니다.

## Technical Implementation

- **Scheduler**: `PwaNotificationSchedulerService`
- **Cron**: `0 9 * * *` (매일 오전 9시 KST)
- **Method**: `notificationService.sendDailyDigestToBranchUsers(branchId, branchName, sections, emailTemplateContext)`
- **Delivery**: 사용자별 branch마다 DB 알림 row 1개, PWA 푸시 1개, digest 이메일 1개
- **Event notifications**: eformsign review와 consultation inquiry 이벤트 알림은 기존 방식대로 유지

### Related Files
- `backend/application/services/pwa-notification-scheduler.service.ts`
- `backend/application/services/notification.service.ts`
- `backend/domain/repositories/client.repository.interface.ts`
