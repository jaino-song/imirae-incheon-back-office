import tseslint from "typescript-eslint";
import { prismaServiceImportAllowlist } from "./eslint.tenant-freeze.allowlist.mjs";
import { systemScopeImportAllowlist } from "./eslint.system-scope.allowlist.mjs";

export default tseslint.config(
    {
        ignores: [
            "dist/",
            "node_modules/",
            "prisma/generated/",
            "vendor/",
            "supabase/",
            "scripts/",
            "coverage/",
        ],
    },
    ...tseslint.configs.recommended,
    {
        files: ["**/*.ts", "**/*.tsx"],
        rules: {
            "@typescript-eslint/ban-ts-comment": "warn",
            "@typescript-eslint/no-empty-object-type": "warn",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-require-imports": "warn",
            "@typescript-eslint/no-unused-expressions": "warn",
            "@typescript-eslint/no-unused-vars": "warn",
            "@typescript-eslint/no-unsafe-function-type": "warn",
            "@typescript-eslint/no-wrapper-object-types": "warn",
            "@typescript-eslint/prefer-namespace-keyword": "warn",
            "@typescript-eslint/triple-slash-reference": "warn",
            "prefer-const": "warn",
        },
    },
    {
        files: ["**/*.spec.ts", "**/*.test.ts"],
        rules: {
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/no-unused-expressions": "off",
        },
    },
    // NOTE on ordering: flat config does NOT merge `no-restricted-imports`
    // options across blocks that both match a file — the later matching
    // block's rule value wholly REPLACES the earlier one's for that rule.
    // The system-scope block below must therefore come BEFORE the
    // prisma-freeze block, and the prisma-freeze block (which is `files:
    // ["application/**/*.ts"]` and so is the LAST word for every
    // non-ignored application/ file) must itself carry BOTH restricted
    // patterns, or application/ files would silently lose the
    // run-system-scope restriction. A file listed in
    // prismaServiceImportAllowlist is `ignores`d by the freeze block, so it
    // falls back to this system-scope block: it stays restricted from
    // run-system-scope while keeping its grandfathered prisma import.
    {
        files: ["**/*.ts"],
        ignores: [...systemScopeImportAllowlist],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "**/infrastructure/tenant/run-system-scope",
                                "**/run-system-scope",
                            ],
                            message:
                                "runSystemScope bypasses tenant isolation and is audited/restricted. If this call site genuinely needs a system-scope bypass, add it to eslint.system-scope.allowlist.mjs via explicit review.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["application/**/*.ts"],
        ignores: [...prismaServiceImportAllowlist, "**/*.spec.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/infrastructure/database/prisma.service"],
                            message:
                                "application/ code must not import PrismaService directly. Use a domain repository instead. If this file genuinely needs grandfathering, add it to eslint.tenant-freeze.allowlist.mjs via explicit review.",
                        },
                        {
                            group: [
                                "**/infrastructure/tenant/run-system-scope",
                                "**/run-system-scope",
                            ],
                            message:
                                "runSystemScope bypasses tenant isolation and is audited/restricted. If this call site genuinely needs a system-scope bypass, add it to eslint.system-scope.allowlist.mjs via explicit review.",
                        },
                    ],
                },
            ],
        },
    },
);
