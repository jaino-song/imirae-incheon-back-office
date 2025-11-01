# API Receipt

Overview of public HTTP endpoints exposed by the Imirae Incheon back-office backend. All routes are mounted on the NestJS server (default port `3000`). Unless otherwise noted, endpoints expect and return JSON and require appropriate authentication/authorization middleware.

## Users (`/users`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/users` | Create a new Kakao-based user. Body: `{ kakaoId: string, name?: string, email?: string, profileImage?: string }`. Returns created user. |
| `GET` | `/users/:id` | Fetch user by internal UUID. |
| `GET` | `/users/kakao/:kakaoId` | Fetch user by Kakao identifier. |
| `PATCH` | `/users/:id` | Update profile fields and/or `role`. Body: `{ name?, email?, profileImage?, role? }`. Returns updated user. |
| `DELETE` | `/users/:id` | Remove a user permanently. |

## Bank Account Info (`/bank-account-infos`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/bank-account-infos` | Create bank account info for an administrative area. Body: `{ area: string, bankName: string, accNum: string }`. |
| `GET` | `/bank-account-infos/:area` | Retrieve bank account info by area code/name. |
| `PATCH` | `/bank-account-infos/:area` | Update bank name and/or account number: `{ bankName?, accNum? }`. |
| `DELETE` | `/bank-account-infos/:area` | Delete the entry for the area. |

## Messages (`/messages`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/messages` | Create a notice board message. Body: `{ title: string, text: string }`. |
| `GET` | `/messages/:id` | Retrieve message by id. |
| `PATCH` | `/messages/:id` | Update message title/text (marks `editedAt`). Body: `{ title: string, text: string }`. |
| `DELETE` | `/messages/:id` | Delete message. |

## Employees (`/employees`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/employees` | Create employee. Body: `{ name, workArea, phone, grade, openToNextWork, registeredDate }`. |
| `GET` | `/employees` | List all employees. |
| `GET` | `/employees/:id` | Fetch employee by id. |
| `PATCH` | `/employees/:id` | Update profile fields / availability. Body accepts partial `{ name?, workArea?, phone?, grade?, openToNextWork? }`. |
| `DELETE` | `/employees/:id` | Delete employee. |
| `GET` | `/employees/work-area/:workArea` | Filter by work area. |
| `GET` | `/employees/grade/:grade` | Filter by grade. |
| `GET` | `/employees/open-status` | Filter by availability. Query: `openToNextWork=true|false` (default `true`). |
| `GET` | `/employees/registered-date/:date` | Employees registered on specific date (`YYYY-MM-DD`). |
| `GET` | `/employees/registered-range` | Employees registered between dates. Query: `startDate`, `endDate` (`YYYY-MM-DD`). |
| `PATCH` | `/employees/:id/open-status` | Toggle availability. Body: `{ openToNextWork: boolean }`. Returns updated employee. |
| `GET` | `/employees/open-to-next-work` | Convenience list of employees open to next work. |

## Voucher Price Info (`/voucher-price-infos`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/voucher-price-infos` | Create voucher pricing entry. Body: `{ type: string, duration: string (numeric), fullPrice, grant, actualPrice }`. Duration is parsed to bigint. |
| `GET` | `/voucher-price-infos` | List all voucher price entries. |
| `GET` | `/voucher-price-infos/:id` | Retrieve voucher by id. |
| `GET` | `/voucher-price-infos/search/by-type` | Find voucher by type via `?type=<value>`. |
| `PATCH` | `/voucher-price-infos/:id` | Partial update. Body fields optional; `duration` string is converted to bigint when provided. |
| `DELETE` | `/voucher-price-infos/:id` | Delete voucher entry. |

## Auth & Eformsign (existing)

| Method(s) | Path(s) | Notes |
| --------- | ------- | ----- |
| `POST`, etc. | `/auth/*` | Kakao OAuth flow, JWT issuance (see controller for specifics). |
| Various | `/eformsign/*` | Eformsign integrations exposed by existing controller. |

## Validation & Error Handling

- DTOs leverage `class-validator` annotations; invalid payloads return `400 Bad Request` with validation details.
- Repository and usecase layers surface `NotFoundException` when records do not exist (mapped to `404`).
- Additional guards/interceptors can be added per module as needed (e.g., `@UseGuards(AuthGuard("jwt"))`).

## Common Response Shapes

- **Entities** are returned as serialized domain objects (e.g., `UserEntity`, `EmployeeEntity`).
- **Deletion** endpoints return `204 No Content` by default (per Nest convention) if controller method resolves to `void`.

## Notes

- All route paths assume the Nest app is mounted at root (`/`). Adjust if a global prefix is configured (e.g., `app.setGlobalPrefix('api')`).
- Ensure appropriate auth/role guards wrap mutating routes in production. The current receipt documents functionality, not authorization policies.

