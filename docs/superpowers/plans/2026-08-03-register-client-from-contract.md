# 계약서 상세 more-menu → 고객 등록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계약서 상세 패널 more-menu에 "고객 등록" 항목을 추가해, 미연결(clientId 없음) 계약서에서 계약 상세를 프리필한 ClientFormDialog로 고객을 등록할 수 있게 한다.

**Architecture:** 백엔드에 조회 전용 후보 엔드포인트(`GET /api/documents/:documentId/client-candidate`)를 추가하고, 기존 검증된 추출 유틸 `extractEformsignContractClientCandidate()`를 재사용한다. 프론트는 프록시 라우트 + api 메서드 + 훅으로 후보를 받아 `ClientFormDialog`의 새 `prefill` prop(생성 모드 전용)에 넣는다. 등록 후 연결은 기존 전화번호 기반 자동 연결(`client.service.ts` → `linkContractDocumentsByPhone`)이 담당하므로 연결 로직 변경은 없다.

**Tech Stack:** NestJS + Prisma (backend), Next.js App Router + TanStack Query (frontend), Jest (양쪽), pnpm monorepo (`packages/shared` 공유 타입).

**Spec:** `docs/superpowers/specs/2026-08-03-register-client-from-contract-design.md`

## Global Constraints

- 계약서 연결 로직(백엔드 phone-link)은 변경하지 않는다. `eDocId`를 생성 DTO에 직접 넣지 않는다.
- 메뉴 항목은 미연결 계약서(`documentClientSummary?.clientId`가 없음)에서만, 그리고 산모 계약서 섹션에서만 표시한다 (서비스 제공기록지 섹션 제외).
- 후보 추출이 실패해도 폼은 열려야 한다 (customerName/customerPhone 폴백).
- data-component 네이밍 컨벤션 준수 (기존 `${dataComponent}_header_stepper-actions_more-menu_content_*` 패턴 따름).
- 커밋 메시지 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01WWoR7ZzVPvhtHDS6H9n9ga`
- 검증 명령: backend `npm run type-check` + `npx jest test/usecases/eformsign-doc/get-contract-client-candidate.usecase.spec.ts`, frontend `npm run type-check` + `npx jest src/lib/client/__tests__/contract-client-prefill.test.ts` (각 워크스페이스 디렉토리에서 실행).

---

### Task 1: 공유 타입 + 백엔드 후보 usecase + 컨트롤러 엔드포인트

- **Tier**: standard
- **Sandbox**: local
- **Paths**: `packages/shared/src/types/eformsign.ts`, `backend/application/usecases/eformsign-doc/get-contract-client-candidate.usecase.ts`, `backend/application/usecases/eformsign-doc/index.ts`, `backend/module/eformsign-doc.module.ts`, `backend/interface/controllers/eformsign.controller.ts`, `backend/test/usecases/eformsign-doc/get-contract-client-candidate.usecase.spec.ts`
- **Depends**: —

**Files:**
- Modify: `packages/shared/src/types/eformsign.ts` (line 228 뒤, `EformsignDocClientSummary` 다음)
- Create: `backend/application/usecases/eformsign-doc/get-contract-client-candidate.usecase.ts`
- Modify: `backend/application/usecases/eformsign-doc/index.ts` (barrel export 추가)
- Modify: `backend/module/eformsign-doc.module.ts` (providers + exports에 usecase 추가 — `LinkMirroredEformsignDocByPhoneUsecase`가 등록된 위치 참조: providers ~line 94, exports ~line 149)
- Modify: `backend/interface/controllers/eformsign.controller.ts` (constructor ~line 191-200, 신규 라우트는 `getDocumentById` 뒤 ~line 835)
- Test: `backend/test/usecases/eformsign-doc/get-contract-client-candidate.usecase.spec.ts`

**Interfaces:**
- Consumes: `extractEformsignContractClientCandidate(document)`, `formatNormalizedKoreanPhone(phone)` (`backend/application/utils/eformsign-contract-client-candidate.ts:404, 526`), `PrismaService`
- Produces: 공유 타입 `EformsignContractClientCandidateResponse` (Task 2, 3이 import), usecase `GetContractClientCandidateUsecase.execute(documentId: string): Promise<EformsignContractClientCandidateResponse | null>`, HTTP `GET /api/documents/:documentId/client-candidate` (JwtGuard + TenantGuard, 지점 스코프)

- [ ] **Step 1: 공유 응답 타입 추가**

`packages/shared/src/types/eformsign.ts`의 `EformsignDocClientSummary`(lines 222-228) 바로 뒤에 추가:

```typescript
/**
 * 계약서 detail payload에서 추출한 고객 등록 후보.
 * extracted=false면 추출 실패 폴백 — 문서 컬럼의 이름/전화만 담긴다.
 * 날짜는 모두 YYYY-MM-DD, phone은 대시 포함 표기(예: 010-1234-5678).
 */
export interface EformsignContractClientCandidateResponse {
    documentId: string;
    extracted: boolean;
    name: string | null;
    phone: string | null;
    address: string | null;
    birthday: string | null;
    dueDate: string | null;
    startDate: string | null;
    endDate: string | null;
    type: string | null;
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    careCenter: boolean | null;
    voucherClient: boolean;
    breastPump: boolean;
}
```

- [ ] **Step 2: 실패하는 usecase 테스트 작성**

`backend/test/usecases/eformsign-doc/get-contract-client-candidate.usecase.spec.ts` 생성 (기존 패턴 참조: `backend/test/usecases/system-setting/get-setting.usecase.spec.ts`):

```typescript
import { GetContractClientCandidateUsecase } from "application/usecases/eformsign-doc/get-contract-client-candidate.usecase";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("GetContractClientCandidateUsecase", () => {
    const findUnique = jest.fn();
    const prisma = {
        eformsign_doc: { findUnique },
    } as unknown as PrismaService;

    let usecase: GetContractClientCandidateUsecase;

    beforeEach(() => {
        usecase = new GetContractClientCandidateUsecase(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("문서가 없으면 null을 반환한다", async () => {
        findUnique.mockResolvedValue(null);
        await expect(usecase.execute("doc-missing")).resolves.toBeNull();
        expect(findUnique).toHaveBeenCalledWith({
            where: { documentId: "doc-missing" },
            select: {
                documentId: true,
                detailPayload: true,
                customerName: true,
                customerPhone: true,
            },
        });
    });

    it("detail payload에서 후보를 추출해 직렬화한다", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-1",
            customerName: null,
            customerPhone: null,
            detailPayload: {
                id: "doc-1",
                fields: [
                    { id: "이용자 성명", value: "홍길동", type: "text" },
                    { id: "이용자 연락처", value: "010-1234-5678", type: "text" },
                    { id: "이용자 주소", value: "서울시 강남구", type: "text" },
                    { id: "계약 시작일", value: "2026-08-10", type: "text" },
                    { id: "계약 종료일", value: "2026-08-24", type: "text" },
                    { id: "바우처 기간", value: "10일", type: "text" },
                ],
            },
        });

        const result = await usecase.execute("doc-1");

        expect(result).toMatchObject({
            documentId: "doc-1",
            extracted: true,
            name: "홍길동",
            phone: "010-1234-5678",
            address: "서울시 강남구",
            startDate: "2026-08-10",
            endDate: "2026-08-24",
            duration: 10,
        });
    });

    it("payload가 없으면 문서 컬럼 폴백을 반환한다", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-2",
            customerName: "김산모",
            customerPhone: "01098765432",
            detailPayload: null,
        });

        const result = await usecase.execute("doc-2");

        expect(result).toEqual({
            documentId: "doc-2",
            extracted: false,
            name: "김산모",
            phone: "010-9876-5432",
            address: null,
            birthday: null,
            dueDate: null,
            startDate: null,
            endDate: null,
            type: null,
            duration: null,
            fullPrice: null,
            grant: null,
            actualPrice: null,
            careCenter: null,
            voucherClient: false,
            breastPump: false,
        });
    });
});
```

주의: 두 번째 테스트의 payload 필드 별칭이 추출기와 안 맞으면 `backend/test/utils/eformsign-contract-client-candidate.spec.ts`의 기존 픽스처에서 통과하는 필드 구조를 복사해 맞출 것 (추출기 별칭 테이블: `backend/application/utils/eformsign-contract-client-candidate.ts:68-96`). 단언하는 키(name/phone/address/startDate/endDate/duration)는 유지한다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd backend && npx jest test/usecases/eformsign-doc/get-contract-client-candidate.usecase.spec.ts`
Expected: FAIL — "Cannot find module .../get-contract-client-candidate.usecase"

- [ ] **Step 4: usecase 구현**

`backend/application/usecases/eformsign-doc/get-contract-client-candidate.usecase.ts` 생성:

```typescript
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EformsignContractClientCandidateResponse } from "@babyjamjam/shared/types/eformsign";

import {
    extractEformsignContractClientCandidate,
    formatNormalizedKoreanPhone,
} from "application/utils/eformsign-contract-client-candidate";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

/**
 * 미연결 계약서에서 고객 등록 폼 프리필용 후보를 읽어온다.
 * 자동 등록(LinkMirroredEformsignDocByPhoneUsecase)과 동일한 추출 유틸을 사용해
 * 수동 등록과 자동 등록의 추출 결과가 항상 일치하도록 한다.
 */
@Injectable()
export class GetContractClientCandidateUsecase {
    constructor(private readonly prisma: PrismaService) {}

    async execute(
        documentId: string,
    ): Promise<EformsignContractClientCandidateResponse | null> {
        const document = await this.prisma.eformsign_doc.findUnique({
            where: { documentId },
            select: {
                documentId: true,
                detailPayload: true,
                customerName: true,
                customerPhone: true,
            },
        });
        if (!document) return null;

        const detail = toDocumentDetail(document.detailPayload);
        const candidate = detail
            ? extractEformsignContractClientCandidate(detail)
            : null;
        if (!candidate) {
            return {
                documentId: document.documentId,
                extracted: false,
                name: document.customerName,
                phone: document.customerPhone
                    ? formatNormalizedKoreanPhone(document.customerPhone)
                    : null,
                address: null,
                birthday: null,
                dueDate: null,
                startDate: null,
                endDate: null,
                type: null,
                duration: null,
                fullPrice: null,
                grant: null,
                actualPrice: null,
                careCenter: null,
                voucherClient: false,
                breastPump: false,
            };
        }

        return {
            documentId: document.documentId,
            extracted: true,
            name: candidate.name,
            phone: formatNormalizedKoreanPhone(candidate.phone),
            address: candidate.address,
            birthday: candidate.birthday,
            dueDate: toDateOnly(candidate.dueDate),
            startDate: toDateOnly(candidate.startDate),
            endDate: toDateOnly(candidate.endDate),
            type: candidate.type,
            duration: candidate.duration,
            fullPrice: candidate.fullPrice,
            grant: candidate.grant,
            actualPrice: candidate.actualPrice,
            careCenter: candidate.careCenter,
            voucherClient: candidate.voucherClient,
            breastPump: candidate.breastPump,
        };
    }
}

// 추출기가 만드는 Date는 UTC 자정 기준(Date.UTC)이므로 toISOString 절단이 안전하다.
function toDateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

function toDocumentDetail(
    value: Prisma.JsonValue | null,
): EformsignApiDocumentResponse | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as unknown as EformsignApiDocumentResponse)
        : null;
}
```

`@babyjamjam/shared` import가 백엔드 tsconfig에서 해석되지 않으면 (기존 사용례 `backend/domain/utils/eformsign-status-code.ts` 참조) 그 파일이 쓰는 import 형식을 그대로 따른다.

- [ ] **Step 5: barrel export + 모듈 등록**

`backend/application/usecases/eformsign-doc/index.ts`에 export 추가:

```typescript
export * from "./get-contract-client-candidate.usecase";
```

`backend/module/eformsign-doc.module.ts`: barrel import 목록(line 4-25 부근)에 `GetContractClientCandidateUsecase` 추가, providers 배열(LinkMirroredEformsignDocByPhoneUsecase 근처)과 exports 배열에 각각 추가.

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd backend && npx jest test/usecases/eformsign-doc/get-contract-client-candidate.usecase.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: 컨트롤러 라우트 추가**

`backend/interface/controllers/eformsign.controller.ts`:

constructor(lines 191-200)에 주입 추가:

```typescript
private readonly getContractClientCandidateUsecase: GetContractClientCandidateUsecase,
```

import 추가 (기존 usecase import 위치 참조):

```typescript
import { GetContractClientCandidateUsecase } from "application/usecases/eformsign-doc/get-contract-client-candidate.usecase";
```

`getDocumentById`(lines 806-834) 바로 뒤에 라우트 추가 — 지점 스코프 가드는 `getDocumentById`와 동일한 `filterDocumentsByBranch` 패턴:

```typescript
    /**
     * Client-registration candidate extracted from a contract's stored detail.
     * Mirrors the auto-registration extraction so manual and automatic
     * registration always agree on the pre-filled values.
     */
    @Get("documents/:documentId/client-candidate")
    async getDocumentClientCandidate(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("documentId") documentId: string,
    ) {
        try {
            const allowedDocuments = await this.filterDocumentsByBranch(
                tenant.branchId ?? "",
                [{ id: documentId }],
            );
            if (allowedDocuments.length === 0) {
                throw new HttpException(
                    { error: "Document access forbidden" },
                    HttpStatus.FORBIDDEN,
                );
            }

            const candidate =
                await this.getContractClientCandidateUsecase.execute(documentId);
            if (!candidate) {
                throw new HttpException(
                    { error: "Document not found" },
                    HttpStatus.NOT_FOUND,
                );
            }
            return candidate;
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }
```

`EformsignController`는 `app.module.ts:87`에 등록되어 있고 `eformsign-doc.module.ts`의 exports를 통해 usecase가 주입된다 — app.module이 해당 모듈을 import하는지 확인하고, 아니면 `app.module.ts` providers에 `GetContractClientCandidateUsecase`를 직접 추가한다 (`EformsignMirrorListService` 등록 방식과 동일).

- [ ] **Step 8: 백엔드 타입체크 + 커밋**

Run: `cd backend && npm run type-check`
Expected: 에러 없음

```bash
git add packages/shared/src/types/eformsign.ts backend/application/usecases/eformsign-doc/ backend/module/eformsign-doc.module.ts backend/interface/controllers/eformsign.controller.ts backend/app.module.ts backend/test/usecases/eformsign-doc/
git commit -m "feat(eformsign): add contract client-candidate endpoint"
```

---

### Task 2: 프론트 플러밍 — 프록시 라우트 + api 메서드 + 훅

- **Tier**: standard
- **Sandbox**: local
- **Paths**: `frontend/src/app/api/eformsign/documents/[documentId]/client-candidate/route.ts`, `frontend/src/services/api.ts`, `frontend/src/hooks/useEformsignDocuments.ts`
- **Depends**: Task 1

**Files:**
- Create: `frontend/src/app/api/eformsign/documents/[documentId]/client-candidate/route.ts`
- Modify: `frontend/src/services/api.ts` (`getDocument` lines 178-181 근처)
- Modify: `frontend/src/hooks/useEformsignDocuments.ts` (`eformsignQueryKeys` lines 26-30 + 훅 추가)

**Interfaces:**
- Consumes: Task 1의 `EformsignContractClientCandidateResponse` (`@babyjamjam/shared/types/eformsign`), 백엔드 `GET /api/documents/:documentId/client-candidate`
- Produces: `eformsignApi.getDocumentClientCandidate(documentId: string): Promise<EformsignContractClientCandidateResponse>`, `useContractClientCandidate(documentId: string | null)` 훅 (TanStack Query, `enabled: documentId !== null`), query key `["eformsign-documents", "client-candidate", documentId]`

- [ ] **Step 1: 프록시 라우트 생성**

`frontend/src/app/api/eformsign/documents/[documentId]/client-candidate/route.ts` — 기존 `frontend/src/app/api/eformsign/documents/[documentId]/route.ts` 패턴 그대로:

```typescript
import { NextRequest } from "next/server";
import { proxyLocalGetRequest } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { documentId } = await params;

  return proxyLocalGetRequest(
    request,
    `/api/documents/${documentId}/client-candidate`,
    "fetch eformsign contract client candidate"
  );
}
```

- [ ] **Step 2: api 메서드 추가**

`frontend/src/services/api.ts`의 `getDocument`(lines 178-181) 바로 뒤:

```typescript
  getDocumentClientCandidate: async (documentId: string) => {
    const { data } = await api.get(
      `/eformsign/documents/${documentId}/client-candidate`
    );
    return data as EformsignContractClientCandidateResponse;
  },
```

파일 상단 import에 `EformsignContractClientCandidateResponse` 추가 (기존 `@babyjamjam/shared/types/eformsign` import line 24에 합류).

- [ ] **Step 3: 훅 추가**

`frontend/src/hooks/useEformsignDocuments.ts` — `eformsignQueryKeys`(lines 26-30)에 키 추가:

```typescript
  clientCandidate: (documentId: string) =>
    ["eformsign-documents", "client-candidate", documentId] as const,
```

파일 하단에 훅 추가:

```typescript
/** 미연결 계약서의 고객 등록 프리필 후보. documentId가 null이면 조회하지 않는다. */
export function useContractClientCandidate(documentId: string | null) {
  return useQuery({
    queryKey: eformsignQueryKeys.clientCandidate(documentId ?? ""),
    queryFn: () => eformsignApi.getDocumentClientCandidate(documentId!),
    enabled: documentId !== null,
    staleTime: 0,
    retry: 1,
  });
}
```

필요 import(`useQuery`, `eformsignApi`)는 이 파일에 이미 존재 — 없으면 추가.

- [ ] **Step 4: 타입체크 + 커밋**

Run: `cd frontend && npm run type-check`
Expected: 에러 없음

```bash
git add frontend/src/app/api/eformsign/documents/ frontend/src/services/api.ts frontend/src/hooks/useEformsignDocuments.ts
git commit -m "feat(contracts): add client-candidate fetch plumbing"
```

---

### Task 3: ClientFormDialog prefill/notice prop + 후보→프리필 매핑 헬퍼

- **Tier**: standard
- **Sandbox**: local
- **Paths**: `frontend/src/components/app/clients/ClientFormDialog.tsx`, `frontend/src/lib/client/contract-client-prefill.ts`, `frontend/src/lib/client/__tests__/contract-client-prefill.test.ts`
- **Depends**: Task 1 (공유 타입만 — Task 2와 병렬 가능, Paths 비중첩)

**Files:**
- Modify: `frontend/src/components/app/clients/ClientFormDialog.tsx` (props lines 56-63, `ClientFormData` line 72, 초기화 useEffect lines 556-628, 헤더 영역)
- Create: `frontend/src/lib/client/contract-client-prefill.ts`
- Test: `frontend/src/lib/client/__tests__/contract-client-prefill.test.ts`

**Interfaces:**
- Consumes: `EformsignContractClientCandidateResponse` (Task 1), 기존 `ClientFormData`/`CreateClientDto` (`frontend/src/features/clients/types/index.ts:83-107`)
- Produces: `export type ClientFormData` (ClientFormDialog에서 export), `ClientFormDialogProps`에 `prefill?: Partial<ClientFormData>` + `notice?: string` 추가, `contractCandidateToClientPrefill(candidate: EformsignContractClientCandidateResponse): Partial<ClientFormData>` (Task 4가 사용)

- [ ] **Step 1: 실패하는 매핑 헬퍼 테스트 작성**

`frontend/src/lib/client/__tests__/contract-client-prefill.test.ts`:

```typescript
import { contractCandidateToClientPrefill } from "@/lib/client/contract-client-prefill";
import type { EformsignContractClientCandidateResponse } from "@babyjamjam/shared/types/eformsign";

const base: EformsignContractClientCandidateResponse = {
    documentId: "doc-1",
    extracted: true,
    name: "홍길동",
    phone: "010-1234-5678",
    address: "서울시 강남구",
    birthday: "900101",
    dueDate: "2026-09-01",
    startDate: "2026-08-10",
    endDate: "2026-08-24",
    type: "A형",
    duration: 10,
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
    careCenter: true,
    voucherClient: true,
    breastPump: false,
};

describe("contractCandidateToClientPrefill", () => {
    it("후보의 모든 필드를 폼 프리필로 매핑한다", () => {
        expect(contractCandidateToClientPrefill(base)).toEqual({
            name: "홍길동",
            phone: "010-1234-5678",
            address: "서울시 강남구",
            birthday: "900101",
            dueDate: "2026-09-01",
            startDate: "2026-08-10",
            endDate: "2026-08-24",
            type: "A형",
            duration: 10,
            fullPrice: "1000000",
            grant: "800000",
            actualPrice: "200000",
            careCenter: true,
            voucherClient: true,
            breastPump: false,
        });
    });

    it("null 필드는 폼 기본값 형태(빈 문자열/false)로 치환하고 undefined 키를 만들지 않는다", () => {
        const result = contractCandidateToClientPrefill({
            ...base,
            extracted: false,
            name: "김산모",
            phone: null,
            address: null,
            birthday: null,
            dueDate: null,
            startDate: null,
            endDate: null,
            type: null,
            duration: null,
            fullPrice: null,
            grant: null,
            actualPrice: null,
            careCenter: null,
            voucherClient: false,
            breastPump: false,
        });
        expect(result).toEqual({
            name: "김산모",
            phone: "",
            address: "",
            birthday: "",
            dueDate: "",
            startDate: "",
            endDate: "",
            type: "",
            duration: null,
            fullPrice: "",
            grant: "",
            actualPrice: "",
            careCenter: false,
            voucherClient: false,
            breastPump: false,
        });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx jest src/lib/client/__tests__/contract-client-prefill.test.ts`
Expected: FAIL — "Cannot find module '@/lib/client/contract-client-prefill'"

- [ ] **Step 3: 매핑 헬퍼 구현**

`frontend/src/lib/client/contract-client-prefill.ts`:

```typescript
import type { EformsignContractClientCandidateResponse } from "@babyjamjam/shared/types/eformsign";
import type { ClientFormData } from "@/components/app/clients/ClientFormDialog";

/**
 * 계약서 후보 응답을 ClientFormDialog 생성 모드 프리필로 변환한다.
 * 폼 상태는 빈 문자열/false 기본값을 쓰므로 null을 그대로 넘기지 않는다.
 */
export function contractCandidateToClientPrefill(
    candidate: EformsignContractClientCandidateResponse,
): Partial<ClientFormData> {
    return {
        name: candidate.name ?? "",
        phone: candidate.phone ?? "",
        address: candidate.address ?? "",
        birthday: candidate.birthday ?? "",
        dueDate: candidate.dueDate ?? "",
        startDate: candidate.startDate ?? "",
        endDate: candidate.endDate ?? "",
        type: candidate.type ?? "",
        duration: candidate.duration,
        fullPrice: candidate.fullPrice ?? "",
        grant: candidate.grant ?? "",
        actualPrice: candidate.actualPrice ?? "",
        careCenter: candidate.careCenter ?? false,
        voucherClient: candidate.voucherClient,
        breastPump: candidate.breastPump,
    };
}
```

`ClientFormData`가 아직 export되지 않았으므로 Step 4를 먼저 적용해야 컴파일된다 (같은 태스크 안에서 순서만 주의).

- [ ] **Step 4: ClientFormDialog에 prefill/notice prop 추가**

`frontend/src/components/app/clients/ClientFormDialog.tsx`:

(a) line 72의 타입에 `export` 추가:

```typescript
export type ClientFormData = Omit<CreateClientDto, "primaryEmployeeId"> & { primaryEmployeeId: number | null };
```

(b) props 인터페이스(lines 56-63)에 추가:

```typescript
export interface ClientFormDialogProps {
    "data-component"?: string;
    open: boolean;
    onClose: () => void;
    client?: Client | null;
    /** 생성 모드 초기값. client가 있으면(수정 모드) 무시된다. */
    prefill?: Partial<ClientFormData>;
    /** 다이얼로그 상단에 표시할 안내 문구 (예: 계약서 연동 주의사항). */
    notice?: string;
    onSuccess?: (client: Client) => void;
}
```

컴포넌트 시그니처의 구조분해에 `prefill`, `notice` 추가.

(c) 초기화 useEffect(lines 556-628)의 생성 모드 분기(lines 588-612)에서 prefill 적용:

```typescript
            if (!nextFormData) {
                nextFormData = {
                    name: prefillName || "",
                    birthday: "",
                    dueDate: "",
                    birthDate: "",
                    address: "",
                    phone: "",
                    primaryEmployeeId: null,
                    secondaryEmployeeId: null,
                    type: "",
                    duration: null,
                    fullPrice: "",
                    grant: "",
                    actualPrice: "",
                    startDate: "",
                    endDate: "",
                    careCenter: false,
                    voucherClient: false,
                    breastPump: false,
                    serviceStatus: "pre_booking",
                    applyMessageAutomation: true,
                    ...prefill,
                };
                nextPricesManuallyEdited = Boolean(
                    prefill?.fullPrice || prefill?.grant || prefill?.actualPrice,
                );
                clearPrefillName();
            }
```

useEffect 의존성 배열(line 628)에 `prefill` 추가:

```typescript
    }, [clearPrefillName, client, open, prefillName, prefill]);
```

(d) notice 렌더링 — 다이얼로그 헤더/설명 영역(DialogHeader 또는 DialogDescription 근처, 4단계 스테퍼 위)에 추가:

```tsx
{notice && (
    <p className="text-sm text-v3-text-muted" role="note">
        {notice}
    </p>
)}
```

배치는 기존 헤더 구조에 맞춰 조정하되, 모든 스텝에서 보이는 위치(스텝 콘텐츠 밖)에 둘 것.

- [ ] **Step 5: 테스트 통과 + 타입체크 확인**

Run: `cd frontend && npx jest src/lib/client/__tests__/contract-client-prefill.test.ts && npm run type-check`
Expected: PASS (2 tests), 타입 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/app/clients/ClientFormDialog.tsx frontend/src/lib/client/contract-client-prefill.ts frontend/src/lib/client/__tests__/contract-client-prefill.test.ts
git commit -m "feat(clients): support create-mode prefill in ClientFormDialog"
```

---

### Task 4: contracts 페이지 통합 — 메뉴 항목 + 다이얼로그 + 무효화

- **Tier**: standard
- **Sandbox**: local
- **Paths**: `frontend/src/app/(protected)/contracts/page.tsx`
- **Depends**: Task 2, Task 3

**Files:**
- Modify: `frontend/src/app/(protected)/contracts/page.tsx`
  - ContractDetailPanel props (lines 1070-1094)
  - more-menu JSX (lines 1803-1842)
  - 산모 계약서 섹션의 ContractDetailPanel 사용처 (line 853 부근)
  - 페이지 레벨 상태/다이얼로그 (MaternityContractDialog 렌더 위치 참조)

**Interfaces:**
- Consumes: `useContractClientCandidate` (Task 2), `contractCandidateToClientPrefill` + `ClientFormDialog`의 `prefill`/`notice` prop (Task 3), 기존 `documentClientSummary` prop, query keys `["eformsign-client-names"]`, `["eformsign-documents"]`
- Produces: 사용자 가시 기능 — more-menu "고객 등록" 항목 (data-component `${dataComponent}_header_stepper-actions_more-menu_content_register-client`)

- [ ] **Step 1: ContractDetailPanel에 onRegisterClient prop 추가**

ContractDetailPanel의 props(lines 1070-1094)에 추가:

```typescript
  onRegisterClient?: (documentId: string) => void;
```

구조분해에 `onRegisterClient` 추가. 표시 조건 변수를 more-menu JSX 위에 정의:

```typescript
  const canRegisterClient = Boolean(
    onRegisterClient && !documentClientSummary?.clientId,
  );
```

(`documentClientSummary`가 아직 로드 전이면 undefined → 항목이 보였다가 로드 후 사라질 수 있다. 요약 쿼리가 로딩 중인지 패널에서 알 수 없으므로, 미연결 판정은 `!documentClientSummary?.clientId`로 통일한다 — 요약 없음 = 미연결로 취급. 잘못 눌러도 등록 폼이 열릴 뿐 파괴적 동작은 없다.)

- [ ] **Step 2: more-menu에 항목 추가**

more-menu 래핑 조건(line 1803)을 확장하고 항목 추가:

```tsx
{(canReRequest || onDeleteRequest || canRegisterClient) && (
  <DropdownMenu>
    {/* ...기존 트리거 유지... */}
    <DropdownMenuContent
      data-component={`${dataComponent}_header_stepper-actions_more-menu_content`}
      /* ...기존 props 유지... */
    >
      {canRegisterClient && (
        <DropdownMenuItem
          data-component={`${dataComponent}_header_stepper-actions_more-menu_content_register-client`}
          onSelect={() => onRegisterClient?.(doc.id)}
        >
          고객 등록
        </DropdownMenuItem>
      )}
      {canRegisterClient && (canReRequest || onDeleteRequest) && <DropdownMenuSeparator />}
      {/* ...기존 재요청/삭제 항목 유지... */}
    </DropdownMenuContent>
  </DropdownMenu>
)}
```

- [ ] **Step 3: 페이지 레벨 상태 + 다이얼로그 연결**

산모 계약서 섹션을 렌더하는 컴포넌트(ContractDetailPanel을 line 853에서 쓰는 곳)에서:

```typescript
const [registerClientDocumentId, setRegisterClientDocumentId] = useState<string | null>(null);
const registerCandidateQuery = useContractClientCandidate(registerClientDocumentId);
const registerClientPrefill = useMemo(
  () => (registerCandidateQuery.data
    ? contractCandidateToClientPrefill(registerCandidateQuery.data)
    : undefined),
  [registerCandidateQuery.data],
);
const queryClient = useQueryClient(); // 이미 있으면 재사용
```

ContractDetailPanel(line 853 사용처, 산모 계약서 섹션만 — line 939 서비스 제공기록지 사용처에는 넘기지 않는다)에 prop 추가:

```tsx
onRegisterClient={setRegisterClientDocumentId}
```

MaternityContractDialog 렌더 위치 근처에 다이얼로그 추가 — 후보 조회가 끝난 뒤(성공/실패 무관) 열어서, 실패 시에도 빈 폼으로 등록 가능하게 한다:

```tsx
<ClientFormDialog
  data-component="desktop_contracts_register-client-dialog"
  open={registerClientDocumentId !== null && !registerCandidateQuery.isFetching}
  onClose={() => setRegisterClientDocumentId(null)}
  prefill={registerClientPrefill}
  notice="전화번호를 변경하면 이 계약서와 자동 연결되지 않을 수 있습니다."
  onSuccess={() => {
    setRegisterClientDocumentId(null);
    void queryClient.invalidateQueries({ queryKey: ["eformsign-client-names"] });
    void queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
  }}
/>
```

import 추가: `ClientFormDialog`, `useContractClientCandidate`, `contractCandidateToClientPrefill`, 필요 시 `useQueryClient`, `useMemo`.

- [ ] **Step 4: 타입체크 + 기존 프론트 테스트 확인**

Run: `cd frontend && npm run type-check && npx jest src/hooks/__tests__ src/lib/client/__tests__`
Expected: 타입 에러 없음, 테스트 PASS

- [ ] **Step 5: 수동 검증 (로컬 dev)**

로컬 환경(localhost — dev Railway 없음)에서:
1. 미연결 계약서 선택 → more-menu에 "고객 등록" 표시 확인.
2. 클릭 → ClientFormDialog가 계약서 값으로 프리필되어 열리는지 확인.
3. 등록 → 다이얼로그 닫힘, 상세 패널에 고객명 표시 + "고객 등록" 항목 사라짐 확인 (전화번호 기반 자동 연결).
4. 연결된 계약서에서 항목이 안 보이는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add "frontend/src/app/(protected)/contracts/page.tsx"
git commit -m "feat(contracts): register client from contract detail more-menu"
```

---

### Task 5: 최종 검증

- **Tier**: trivial
- **Sandbox**: local
- **Paths**: (읽기 전용 검증 — 수정 없음, 발견된 문제만 해당 파일 수정)
- **Depends**: Task 4

- [ ] **Step 1: 전체 검증 실행**

```bash
cd backend && npm run type-check && npx jest test/usecases/eformsign-doc/
cd ../frontend && npm run type-check && npm run lint && npx jest src/lib/client/__tests__ 
```

Expected: 모두 통과. 실패 시 해당 태스크 파일로 돌아가 수정 후 재실행.

- [ ] **Step 2: 스펙 대조**

스펙(`docs/superpowers/specs/2026-08-03-register-client-from-contract-design.md`)의 각 요구사항이 구현됐는지 확인: 메뉴 표시 조건 / 후보 엔드포인트 + 폴백 / prefill 생성 모드 전용 / 안내 문구 / 쿼리 무효화 / 서비스 제공기록지 섹션 제외.

---

## 병렬 실행 배치

- **Batch 1**: Task 1 (단독)
- **Batch 2** (**Run together:** Paths 비중첩): Task 2, Task 3
- **Batch 3**: Task 4 → Task 5
