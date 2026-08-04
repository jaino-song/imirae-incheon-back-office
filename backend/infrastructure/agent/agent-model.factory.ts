import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { LanguageModel } from "ai";

import { DeterministicAgentLanguageModel } from "./deterministic-agent-language-model";

export const DEFAULT_AGENT_MODEL = "gemini-3.5-flash-lite";

@Injectable()
export class AgentModelFactory {
    constructor(private readonly configService: ConfigService) {}

    create(): LanguageModel {
        if (this.configService.get<string>("E2E_VENDOR_STUBS") === "1") {
            return new DeterministicAgentLanguageModel([
                { type: "tool-call", toolName: "clients_search", input: { query: "홍길동" } },
                { type: "text", text: "[agent-e2e-stub] 조회 결과를 확인했습니다." },
            ]) as LanguageModel;
        }

        const apiKey = this.configService.get<string>("GEMINI_API_KEY");
        if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

        const google = createGoogleGenerativeAI({ apiKey });
        return google(this.modelId);
    }

    get modelId(): string {
        return this.configService.get<string>("AGENT_MODEL") || DEFAULT_AGENT_MODEL;
    }
}
