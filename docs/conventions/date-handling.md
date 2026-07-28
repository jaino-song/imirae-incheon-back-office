# Date Handling Conventions

This document fixes two conventions around date/time storage and formatting in the backend
(NestJS + Prisma), and records one accepted design trade-off in the 제공기록지(service record)
link/token flow. It exists so future changes to Prisma schema fields, mappers, or scheduling
logic don't silently break the assumptions the code already depends on.

## 1. `@db.Date` columns are calendar days, stored and read back as UTC midnight

Prisma fields marked `@db.Date` (as opposed to `@db.Timestamp`/`@db.Timestamptz`) represent a
pure calendar day with no time-of-day component — e.g. `employee_schedule.startDate` /
`endDate`, `client.dueDate`, `client.companyRegisteredDate`, `schedule_change.fromDate` /
`toDate` (see `backend/prisma/schema.prisma`).

**Contract:** a `@db.Date` value round-trips through Prisma/PostgreSQL as a JS `Date` whose
UTC time-of-day is exactly midnight (`T00:00:00.000Z`). `date.toISOString().slice(0, 10)` on
such a value always yields the correct calendar day.

**Rule:** treat `@db.Date` values purely as calendar days. Do not apply timezone conversion to
them (no `Intl.DateTimeFormat(..., { timeZone: "Asia/Seoul" })`, no manual offset arithmetic).
Any timezone-aware conversion of a `@db.Date` value is a bug: it can only ever intentionally
represent "this calendar day," and converting it through a timezone reinterprets the same
instant as belonging to a different calendar day depending on the offset.

Concretely, `backend/domain/constants/service-record-link-message.ts:9-13`'s `atKstHour`
depends on exactly this contract:

```ts
const KST_OFFSET = "+09:00";

export function atKstHour(date: Date, hour: number): Date {
    const ymd = date.toISOString().slice(0, 10);
    const hh = String(hour).padStart(2, "0");
    return new Date(`${ymd}T${hh}:00:00${KST_OFFSET}`);
}
```

`atKstHour` is only correct when `date` is a UTC-midnight `@db.Date` value (e.g.
`employee_schedule.startDate`/`endDate`). If it is ever fed a raw `TIMESTAMPTZ` value, or a
`Date` constructed as KST-local midnight (`new Date("YYYY-MM-DDT00:00:00+09:00")`) instead of
UTC midnight, the extracted calendar day can be off by one — see the regression-guard tests in
`backend/test/domain/service-record-link-message.spec.ts` for both failure modes reproduced
deterministically (no DB access required).

This backend has no disposable-DB integration harness that could round-trip a real `@db.Date`
column through Prisma to verify this contract end-to-end: `backend/test/integration/*` mock
the service layer (see `employee-schedule.controller.integration.spec.ts`), and
`backend/test/e2e/*` needs a live DB/env and is excluded from the default `jest` run via
`testPathIgnorePatterns` in `backend/jest.config.ts`. The contract is therefore pinned at the
unit level, against `atKstHour` / `getServiceRecordLinkScheduledFor` /
`getServiceRecordTokenExpiresAt` directly, rather than via a live repository round trip.

## 2. `TIMESTAMPTZ` values must go through a KST formatter — never manual arithmetic

Fields that carry an instant in time (not a calendar day) are `TIMESTAMPTZ`/`DateTime` without
`@db.Date` — e.g. `message_log`/`message_trigger_job` timestamps, `created_at`/`updated_at`
columns. These must be presented to users or matched against KST business rules only through a
proper timezone-aware formatter, never through manual millisecond/hour arithmetic on the raw
`Date`.

- **Frontend/mobile:** use the shared formatting utilities in `@babyjamjam/shared`
  (`packages/shared`) rather than re-implementing KST conversion per call site.
- **Backend:** the established idiom in this codebase is
  `new Intl.DateTimeFormat(locale, { timeZone: "Asia/Seoul" })` (see
  `backend/domain/utils/business-days.ts`, `backend/application/services/client-due-date-scheduler.service.ts`,
  `backend/application/services/message-trigger.service.ts`) or NestJS's `@Cron(..., { timeZone: "Asia/Seoul" })`
  for scheduled jobs. The backend does not currently depend on `@babyjamjam/shared` (it is a
  frontend/mobile package); if a shared KST formatter is introduced for the backend, all
  ad hoc `Intl.DateTimeFormat(..., { timeZone: "Asia/Seoul" })` call sites should migrate to it
  rather than growing in parallel.
- Never do `date.getTime() + 9 * 60 * 60 * 1000` or similar manual offset math to "convert to
  KST" — it silently breaks across DST-free-but-still-error-prone edge cases (e.g. leap
  seconds/year boundaries) and, more importantly, produces a `Date` whose *fields* look KST-shifted
  but whose `.toISOString()` is still UTC, which is exactly how `@db.Date` vs `TIMESTAMPTZ`
  values get confused with each other in the first place (see §1).

## 3. Accepted trade-off: 제공기록지 link token is stored plaintext (P2-10)

`backend/application/services/service-record-token.service.ts` issues two secrets per
no-login service-record access token row (BJJ-247):

- **link token** (`efl_...`, carried in the SMS URL): stored **plaintext** in the database, by
  design, so the issued form URL can be recovered/re-sent from admin tooling when needed. It
  only grants access to the phone-verification challenge, not to service-record data itself.
- **access token** (minted only after a correct phone number match): stored as a **sha256
  hash**, same as the expected phone number. This is the token that actually grants the
  service-record endpoints, until `expiresAt` (= schedule `endDate` + grace buffer via
  `getServiceRecordTokenExpiresAt`).

This is an **accepted design trade-off**, not an oversight: the phone-number check is the
second, independent factor of defense. Possessing the plaintext link token alone (e.g. via a
database leak or a forwarded SMS) is insufficient to reach a client's service record — the
requester must also know the phone number on file for that assignment, which is checked
against a hash and is not derivable from the link token. `linkTokenHash` retains its legacy
Prisma/database column name even though newly issued link-token values are plaintext; see the
docstring at the top of `service-record-token.service.ts` for the authoritative description of
this scheme.

## Related

- [Backend Conventions](./backend-conventions.md) — general Clean Architecture / DDD layering.
- `backend/domain/constants/service-record-link-message.ts` — `atKstHour` and its callers.
- `backend/application/services/service-record-token.service.ts` — link/access token issuance.
- `backend/test/domain/service-record-link-message.spec.ts` — contract regression tests for §1.
