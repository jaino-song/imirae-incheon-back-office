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
    // The integration specs stand up a full Nest app per test. With Jest's
    // default worker count (cores - 1) they contend for CPU hard enough to blow
    // the 5s default timeout, which surfaced as unrelated specs failing roughly
    // one full-suite run in four — timeouts, stray 401s and missed mock calls.
    // Cap the workers and give a slow-under-load test room to finish.
    maxWorkers: "50%",
    testTimeout: 15000,
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
