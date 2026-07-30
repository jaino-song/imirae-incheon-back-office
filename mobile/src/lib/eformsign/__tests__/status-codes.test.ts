import {
  getStatusCategory,
  getStatusColor,
  isDeletedStatusCode,
  mapDocStatusLabel,
  mapStatusToLabel,
  normalizeStatusCode,
} from "../status-codes";

describe("eformsign status code helpers", () => {
  it("normalizes status codes to the 3-digit eformsign format", () => {
    expect(normalizeStatusCode("1")).toBe("001");
    expect(normalizeStatusCode(" 70 ")).toBe("070");
    expect(normalizeStatusCode("003")).toBe("003");
    expect(normalizeStatusCode("doc_request_participant")).toBe("060");
  });

  it("classifies only known in-progress status codes as in-progress", () => {
    expect(getStatusCategory("001")).toBe("in-progress");
    expect(getStatusCategory("070")).toBe("in-progress");
  });

  it("classifies completed and expired status codes by eformsign buckets", () => {
    expect(getStatusCategory("003")).toBe("completed");
    expect(getStatusCategory("080")).toBe("expired");
    expect(getStatusCategory("090")).toBe("expired");
    expect(mapStatusToLabel("090")).toBe("기간 만료");
  });

  it("keeps deleted document codes out of rejected expiration buckets", () => {
    expect(isDeletedStatusCode("047")).toBe(true);
    expect(isDeletedStatusCode("049")).toBe(true);
    expect(isDeletedStatusCode("099")).toBe(true);
    expect(getStatusCategory("049")).toBe("unknown");
    expect(getStatusCategory("099")).toBe("unknown");
    expect(mapStatusToLabel("049")).toBe("알 수 없음");
  });

  it("classifies unsupported, blank, and missing status codes as unknown", () => {
    expect(getStatusCategory("999")).toBe("unknown");
    expect(getStatusCategory("")).toBe("unknown");
    expect(getStatusCategory(null)).toBe("unknown");
    expect(getStatusCategory(undefined)).toBe("unknown");
  });

  it("maps unknown status values to a distinct label and neutral badge color", () => {
    expect(mapStatusToLabel("999")).toBe("알 수 없음");
    expect(getStatusColor("알 수 없음")).toBe("info");
  });

  it("does not mark user participant steps as review needed when upstream marks the recipient internal", () => {
    expect(
      mapDocStatusLabel({
        status_type: "060",
        step_type: "05",
        step_name: "이용자",
        step_recipients: [{ recipient_type: "01" }],
      }),
    ).toBe("대기");
  });

  it("marks provider confirmation steps as review needed", () => {
    expect(
      mapDocStatusLabel({
        status_type: "060",
        step_type: "05",
        step_name: "제공기관 확인",
        step_recipients: [{ recipient_type: "01" }],
      }),
    ).toBe("검토 필요");
  });
});
