import { foldContractStats } from "@/lib/eformsign/status-codes";

// Pins the StatsBar bucket semantics currently in contracts/page.tsx:516-557.
// foldContractStats reads the raw signals the /api/documents/status-counts
// endpoint returns from the current step instead of iterating full eformsign
// doc objects.
const TEST_NOW = new Date("2026-08-01T03:00:00.000Z");
const FAR_CONTRACT_END_DATE = "2027-12-31";
const PAST_CONTRACT_END_DATE = "2026-01-01";

describe("foldContractStats", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(TEST_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("excludes completed and cancelled from all buckets", () => {
    expect(
      foldContractStats([
        // doc_complete -> completed
        { status_type: "003", step_type: null, step_name: null, step_recipient_types: [] },
        // doc_revoke -> expired category but not 080
        { status_type: "042", step_type: null, step_name: null, step_recipient_types: [] },
      ]),
    ).toEqual({ reviewNeeded: 0, signed: 0, sendRequired: 0, drafting: 0, expired: 0 });
  });

  it("counts only doc_expired (080) as expired", () => {
    expect(
      foldContractStats([{ status_type: "080", step_type: null, step_name: null, step_recipient_types: [] }])
        .expired,
    ).toBe(1);
    // 011 (doc_reject_approval) is in the expired category but is NOT 080 → counted nowhere
    expect(
      foldContractStats([{ status_type: "011", step_type: null, step_name: null, step_recipient_types: [] }])
        .expired,
    ).toBe(0);
  });

  it("counts draft (001) as drafting, before the reviewNeeded split", () => {
    expect(
      foldContractStats([{ status_type: "001", step_type: "05", step_name: "이용자", step_recipient_types: ["01"] }]),
    ).toEqual({ reviewNeeded: 0, signed: 0, sendRequired: 0, drafting: 1, expired: 0 });
  });

  it("splits provider-review docs into signed while the end date is far, reviewNeeded when due", () => {
    // End date far in the future → the review window has not opened yet.
    expect(
      foldContractStats([
        { status_type: "060", step_type: "06", step_name: "제공기관 검토", step_recipient_types: ["01"], contract_end_date: FAR_CONTRACT_END_DATE },
      ]),
    ).toEqual({ reviewNeeded: 0, signed: 1, sendRequired: 0, drafting: 0, expired: 0 });
    // End date already passed → review is due.
    expect(
      foldContractStats([
        { status_type: "060", step_type: "06", step_name: "제공기관 검토", step_recipient_types: ["01"], contract_end_date: PAST_CONTRACT_END_DATE },
      ]),
    ).toEqual({ reviewNeeded: 1, signed: 0, sendRequired: 0, drafting: 0, expired: 0 });
  });

  it("splits in-progress into reviewNeeded only for provider review workflow steps", () => {
    expect(
      foldContractStats([
        { status_type: "060", step_type: "06", step_name: "제공기관 검토", step_recipient_types: ["01"] },
      ]).reviewNeeded,
    ).toBe(1);
    expect(
      foldContractStats([
        { status_type: "060", step_type: "05", step_name: "제공기관 확인", step_recipient_types: ["01"] },
      ]).reviewNeeded,
    ).toBe(1);
    expect(
      foldContractStats([
        { status_type: "060", step_type: "05", step_name: "이용자", step_recipient_types: ["01"] },
      ]).sendRequired,
    ).toBe(1);
    expect(
      foldContractStats([{ status_type: "060", step_type: null, step_name: null, step_recipient_types: [] }])
        .sendRequired,
    ).toBe(1);
  });

  it("normalizes named status codes (reuses normalizeStatusCode)", () => {
    expect(
      foldContractStats([
        { status_type: "doc_complete", step_type: null, step_name: null, step_recipient_types: [] },
      ]),
    ).toEqual({ reviewNeeded: 0, signed: 0, sendRequired: 0, drafting: 0, expired: 0 });
    expect(
      foldContractStats([
        { status_type: "doc_request_participant", step_type: "05", step_name: "이용자", step_recipient_types: ["02"] },
      ]).sendRequired,
    ).toBe(1);
  });

  it("tallies a mixed batch", () => {
    expect(
      foldContractStats([
        { status_type: "003", step_type: null, step_name: null, step_recipient_types: [] },
        { status_type: "080", step_type: null, step_name: null, step_recipient_types: [] },
        { status_type: "001", step_type: "05", step_name: "이용자", step_recipient_types: ["01"] },
        { status_type: "060", step_type: "06", step_name: "제공기관 검토", step_recipient_types: ["01"] },
        { status_type: "060", step_type: "06", step_name: "제공기관 검토", step_recipient_types: ["01"], contract_end_date: FAR_CONTRACT_END_DATE },
        { status_type: "060", step_type: "05", step_name: "이용자", step_recipient_types: ["01"] },
      ]),
    ).toEqual({ reviewNeeded: 1, signed: 1, sendRequired: 1, drafting: 1, expired: 1 });
  });
});
