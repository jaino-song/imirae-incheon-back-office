import type { Config } from "jest";

const config: Config = {
    rootDir: "./",
    testEnvironment: "node",
    moduleFileExtensions: ["ts", "js", "json"],
    transform: {
        "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "tsconfig.json" }],
    },
    testMatch: ["<rootDir>/test/agent-e2e/**/*.spec.ts"],
    moduleNameMapper: {
        "^nanoid$": "<rootDir>/test/auth-e2e/nanoid.stub.ts",
        "^application/(.*)$": "<rootDir>/application/$1",
        "^domain/(.*)$": "<rootDir>/domain/$1",
        "^infrastructure/(.*)$": "<rootDir>/infrastructure/$1",
        "^interface/(.*)$": "<rootDir>/interface/$1",
        "^module/(.*)$": "<rootDir>/module/$1",
    },
    maxWorkers: 1,
    testTimeout: 30_000,
};

export default config;
