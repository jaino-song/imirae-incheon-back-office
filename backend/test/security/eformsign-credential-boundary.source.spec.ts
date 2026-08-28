import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const backendRoot = join(__dirname, "../..");
const productionRoots = [
    join(backendRoot, "application"),
    join(backendRoot, "interface"),
    join(backendRoot, "module"),
    join(backendRoot, "scripts"),
];
const boundaryPath = join(
    backendRoot,
    "application/services/eformsign-credential-boundary.service.ts",
);

const directCredentialAcquisitionPatterns: readonly RegExp[] = [
    /\.getAccessToken\s*\(/,
    /\.refreshAccessToken\s*\(/,
    /\/api_auth\/(?:access_token|refresh_token)/,
    /\b(?:Get|Refresh)EformsignAccessTokenUsecase\b/,
];

function productionTypeScriptFiles(root: string): string[] {
    const entries = readdirSync(root, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__tests__" || entry.name === "dist") continue;
            files.push(...productionTypeScriptFiles(path));
            continue;
        }
        if (
            entry.isFile()
            && entry.name.endsWith(".ts")
            && !entry.name.endsWith(".spec.ts")
            && !entry.name.endsWith(".test.ts")
        ) {
            files.push(path);
        }
    }
    return files;
}

describe("eformsign credential boundary source guard", () => {
    it("keeps direct provider token acquisition inside the boundary", () => {
        const violations: string[] = [];
        for (const root of productionRoots) {
            for (const path of productionTypeScriptFiles(root)) {
                if (path === boundaryPath) continue;
                const source = readFileSync(path, "utf8");
                if (directCredentialAcquisitionPatterns.some((pattern) => pattern.test(source))) {
                    violations.push(relative(backendRoot, path));
                }
            }
        }

        expect(violations).toEqual([]);
        expect(readFileSync(boundaryPath, "utf8")).toMatch(/eformsignClient\.getAccessToken\s*\(/);
    });

    it("keeps provider credentials out of public eformsign DTOs", () => {
        const dtoPaths = [
            join(backendRoot, "interface/dto/eformsign.dto.ts"),
            join(backendRoot, "interface/dto/eformsign-doc.dto.ts"),
            join(backendRoot, "interface/dto/staff-document.dto.ts"),
            join(backendRoot, "../packages/shared/src/types/eformsign.ts"),
        ];
        for (const path of dtoPaths) {
            const source = readFileSync(path, "utf8");
            expect(source).not.toMatch(/\bmemberEmail\b/);
            expect(source).not.toMatch(/\baccessToken\b/);
            expect(source).not.toMatch(/\brefreshToken\b/);
            expect(source).not.toMatch(/\baccess_token\b/);
            expect(source).not.toMatch(/\brefresh_token\b/);
        }
    });
});
