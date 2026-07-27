import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("SettingsPage account profile", () => {
  it("seeds the auth query from the protected layout user", () => {
    expect(source).toContain('import { useInitialUser } from "@/providers/UserProvider"');
    expect(source).toContain("const initialUser = useInitialUser()");
    expect(source).toContain("useGetAuthUser({ initialData: initialUser })");
  });
});
