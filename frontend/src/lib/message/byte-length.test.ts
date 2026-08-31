import { getLmsTitle, getTextByteLength, MAX_LMS_TITLE_BYTES } from "./byte-length";

describe("getTextByteLength", () => {
  it("counts ASCII characters as 1 byte each", () => {
    expect(getTextByteLength("hello")).toBe(5);
  });

  it("counts Korean characters as 3 bytes each in UTF-8", () => {
    expect(getTextByteLength("안녕")).toBe(6);
  });

  it("counts mixed ASCII and Korean text correctly", () => {
    expect(getTextByteLength("hi 안녕")).toBe(2 + 1 + 6);
  });

  it("returns 0 for an empty string", () => {
    expect(getTextByteLength("")).toBe(0);
  });
});

describe("getLmsTitle", () => {
  it("returns the template name when it is at or under the byte limit", () => {
    const name = "안내문구";
    expect(getTextByteLength(name)).toBeLessThanOrEqual(MAX_LMS_TITLE_BYTES);
    expect(getLmsTitle(name)).toBe(name);
  });

  it("falls back to the default title when the template name exceeds the byte limit", () => {
    const name = "가".repeat(20);
    expect(getTextByteLength(name)).toBeGreaterThan(MAX_LMS_TITLE_BYTES);
    expect(getLmsTitle(name)).toBe("안내");
  });
});
