import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import dataComponentPlugin, { uiArchitecture } from "@babyjamjam/shared/eslint-plugin";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/**/*.tsx", "src/**/*.ts"],
    ignores: [
      "src/**/*.test.tsx",
      "src/**/*.test.ts",
      "src/**/__tests__/**",
    ],
    plugins: {
      "data-component": dataComponentPlugin,
    },
    rules: {
      // Migration lock: value format, legacy ban, parent-path, slot/source checks.
      // Annotation coverage (missing data-component on structural elements) is
      // intentionally not enforced here — anonymous wrappers are exempt by convention.
      "data-component/require-data-component": [
        "error",
        { banLegacyFormat: true, checkMissingAnnotations: false },
      ],
    },
  },
  {
    files: ["src/app/**/page.tsx"],
    plugins: {
      "ui-architecture": uiArchitecture,
    },
    rules: {
      "ui-architecture/no-page-local-components": "warn",
      "ui-architecture/no-page-style-constants": "warn",
      "ui-architecture/no-raw-ui-in-pages": "warn",
      "ui-architecture/no-visual-tailwind-in-pages": "warn",
    },
  },
]);

export default eslintConfig;
