import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("MessagesPage template type labels", () => {
  it("keeps branch template semantics when the selected detail is unavailable", () => {
    expect(source).toContain("const isBranchTemplate = userTemplateId !== null");
    expect(source).toContain('isBranchTemplate ? "지점 템플릿" : "기본 템플릿"');
    expect(source).toContain("지점 템플릿 · 정보를 불러오지 못했습니다.");
  });
});

describe("MessagesPage unreleased section gating", () => {
  it("keeps the unreleased sections disabled for everyone except the owner", () => {
    const unreleasedIds = source
      .split("const UNRELEASED_SECTION_IDS = new Set<MessageSectionId>([")[1]
      ?.split("]);")[0];

    expect(unreleasedIds).toBeDefined();
    expect(unreleasedIds).toContain('"scheduled"');
    expect(unreleasedIds).toContain('"history"');
    expect(unreleasedIds).toContain('"templates"');
    expect(unreleasedIds).toContain('"triggers"');
    expect(source).toContain("const isOwner = user?.role === ROLES.owner");
    expect(source).toContain("UNRELEASED_SECTION_IDS.has(section.id) && !isOwner");
  });
});

describe("MessagesPage sender approval gating", () => {
  it("keeps only send and settings available while sender approval is pending", () => {
    expect(source).toContain(
      'const SENDER_APPROVAL_EXEMPT_SECTION_IDS = new Set<MessageSectionId>(["send", "settings"]);',
    );
    expect(source).toContain(
      "const isSenderApprovalRequired = senderApproval?.isApproved === false",
    );
    expect(source).toContain(
      "!SENDER_APPROVAL_EXEMPT_SECTION_IDS.has(section.id)",
    );
  });
});
