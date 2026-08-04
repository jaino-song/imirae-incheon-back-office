import type { Config } from "jest";

const config: Config = {
    rootDir: "./",
    roots: ["<rootDir>/"],
    testEnvironment: "node",
    moduleFileExtensions: ["ts", "js", "json"],
    transform: {
        "^.+\\.(t|j)s$": ["ts-jest", {
            tsconfig: "tsconfig.json",
        }],
    },
    testMatch: ["**/*.spec.ts"],
    // test/e2e needs a live DB/env — it gets its own gated runner, keep the unit suite hermetic.
    testPathIgnorePatterns: [
        "/node_modules/",
        "/dist/",
        "<rootDir>/test/e2e/",
        "<rootDir>/test/auth-e2e/",
        "<rootDir>/test/agent-e2e/runtime/",
    ],
    moduleNameMapper: {
        "^application/(.*)$": "<rootDir>/application/$1",
        "^domain/(.*)$": "<rootDir>/domain/$1",
        "^infrastructure/(.*)$": "<rootDir>/infrastructure/$1",
        "^interface/(.*)$": "<rootDir>/interface/$1",
        "^module/(.*)$": "<rootDir>/module/$1",
    },
    collectCoverageFrom: [
        "application/**/!(*.spec).ts",
        "domain/**/!(*.spec).ts",
        "infrastructure/**/!(*.spec).ts",
    ],
    coveragePathIgnorePatterns: ["/dist/", "/node_modules/"],
};

export default config;
