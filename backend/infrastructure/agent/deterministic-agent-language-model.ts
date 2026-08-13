type ScriptedStep =
    | { type: "tool-call"; toolName: string; input: Record<string, unknown> }
    | { type: "text"; text: string }
    | { type: "error"; message: string };

const EMPTY_USAGE = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/**
 * A deterministic AI SDK provider used by the agent E2E suite. It intentionally
 * implements the provider contract instead of bypassing streamText, so tool
 * validation, execution, and the multi-step loop are exercised exactly as in
 * production.
 */
export class DeterministicAgentLanguageModel {
    readonly specificationVersion = "v3" as const;
    readonly provider = "babyjamjam-e2e";
    readonly modelId = "deterministic-agent-v1";
    readonly supportedUrls = {};

    private callIndex = 0;

    constructor(private readonly script: ScriptedStep[]) {}

    async doGenerate(): Promise<never> {
        throw new Error("The deterministic agent provider supports streaming only");
    }

    async doStream(_options: unknown) {
        const step = this.script[this.callIndex++] ?? { type: "text" as const, text: "완료했습니다." };
        if (step.type === "error") {
            return {
                stream: new ReadableStream({
                    start(controller) {
                        controller.enqueue({ type: "stream-start", warnings: [] });
                        controller.enqueue({ type: "error", error: new Error(step.message) });
                        controller.close();
                    },
                }),
            };
        }
        const parts: Array<Record<string, unknown>> = [{ type: "stream-start", warnings: [] }];

        if (step.type === "tool-call") {
            parts.push({
                type: "tool-call",
                toolCallId: `deterministic-tool-${this.callIndex}`,
                toolName: step.toolName,
                input: JSON.stringify(step.input),
            });
            parts.push({
                type: "finish",
                usage: EMPTY_USAGE,
                finishReason: { unified: "tool-calls", raw: "tool-calls" },
            });
        } else {
            parts.push(
                { type: "text-start", id: `deterministic-text-${this.callIndex}` },
                { type: "text-delta", id: `deterministic-text-${this.callIndex}`, delta: step.text },
                { type: "text-end", id: `deterministic-text-${this.callIndex}` },
                {
                    type: "finish",
                    usage: EMPTY_USAGE,
                    finishReason: { unified: "stop", raw: "stop" },
                },
            );
        }

        return {
            stream: new ReadableStream({
                start(controller) {
                    for (const part of parts) controller.enqueue(part);
                    controller.close();
                },
            }),
        };
    }
}

export type { ScriptedStep as DeterministicAgentScriptStep };
