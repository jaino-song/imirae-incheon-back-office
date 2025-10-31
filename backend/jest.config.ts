import type { Config } from "jest";

const config: Config = {
    rootDir: "./",
    testEnvironment: "node",
    moduleFileExtensions: ["ts", "js", "json"],
    transform: {
        "^.+\\.(t|j)s$": ["ts-jest", {
            tsconfig: "tsconfig.json",
        }],
    },
    testRegex: "\\.spec\\.ts$",
    moduleNameMapper: {
        "^application/(.*)$": "<rootDir>/application/$1",
        "^domain/(.*)$": "<rootDir>/domain/$1",
        "^infrastructure/(.*)$": "<rootDir>/infrastructure/$1",
        "^interface/(.*)$": "<rootDir>/interface/$1",
    },
    collectCoverageFrom: [
        "application/**/!(*.spec).ts",
        "domain/**/!(*.spec).ts",
        "infrastructure/**/!(*.spec).ts",
    ],
    coveragePathIgnorePatterns: ["/dist/", "/node_modules/"],
};

export default config;

