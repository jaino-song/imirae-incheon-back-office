import { defineConfig } from "eslint/config";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const recommendedConfigs = Array.isArray(tseslint.configs.recommended)
  ? tseslint.configs.recommended
  : [tseslint.configs.recommended];

const typescriptRules = Object.assign({}, ...recommendedConfigs.map((config) => config.rules ?? {}));

export default defineConfig([
  {
    ignores: [
      "node_modules",
      "dist",
      ".next",
      "apps/frontend/.next",
      "apps/frontend/out",
      "apps/frontend/next-env.d.ts"
    ]
  },
  {
    files: ["apps/frontend/**/*.{js,jsx,ts,tsx}"],
    extends: [...nextCoreWebVitals, ...nextTypescript],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname
      }
    },
    settings: {
      next: {
        rootDir: ["apps/frontend"],
      },
    },
  },
  {
    files: ["apps/api/**/*.ts", "libs/**/*.ts"],
    plugins: {
      "@typescript-eslint": tseslint
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      }
    },
    rules: {
      ...typescriptRules
    }
  }
]);
