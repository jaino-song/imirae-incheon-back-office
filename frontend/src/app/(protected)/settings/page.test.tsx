import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("SettingsPage account profile", () => {
  it("seeds the auth query from the protected layout user", () => {
    expect(source).toContain('import { useInitialUser } from "@/providers/UserProvider"');
    expect(source).toContain("const initialUser = useInitialUser()");
    expect(source).toContain("useGetAuthUser({ initialData: initialUser })");
  });
});

// Source-level assertions, matching this file's existing convention (the page
// has no render harness here). The real authorization gate is server-side
// (`assertOwner` in CallIngestTokenController, covered by its own specs);
// these pin the client-side gating that decides what is even offered.
describe("SettingsPage call-ingest-token section gating", () => {
  it("offers the token section in the nav only to owners", () => {
    expect(source).toContain('const isOwner = user?.role === "owner"');
    expect(source).toContain(
      "const navSections = isOwner ? [...BASE_NAV_SECTIONS, ...OWNER_NAV_SECTIONS] : BASE_NAV_SECTIONS",
    );
    // The entry must live in the owner-only list, never the base one.
    const ownerNav = source.slice(source.indexOf("OWNER_NAV_SECTIONS"));
    expect(ownerNav).toContain('id: "call-ingest-tokens"');
    const baseNav = source.slice(
      source.indexOf("BASE_NAV_SECTIONS"),
      source.indexOf("OWNER_NAV_SECTIONS"),
    );
    expect(baseNav).not.toContain('id: "call-ingest-tokens"');
  });

  it("renders the section only with a resolved branch, and explains itself without one", () => {
    expect(source).toContain('activeSection === "call-ingest-tokens" && isOwner');
    expect(source).toContain("<CallIngestTokenSection branchId={branchId} />");
    // An owner with no selected branch reaches the section (the nav entry is
    // owner-gated, not branch-gated) and must get an explanation, not a blank panel.
    expect(source).toContain("지점을 먼저 선택해 주세요");
  });
});
