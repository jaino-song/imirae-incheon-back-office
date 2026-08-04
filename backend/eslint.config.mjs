import tseslint from "typescript-eslint";

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
);
