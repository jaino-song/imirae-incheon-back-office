"use client";

import { cn } from "@/lib/utils";
import type { TranscriptTurn } from "@/lib/call-inbox/types";

// Known roles the backend refine stage emits (design spec §4.3). Anything
// outside both sets — the shared NEUTRAL_SPEAKER constant, an unexpected
// string, or a missing/empty speaker — is unattributed, by virtue of being
// the complement of these sets. Never branch on the neutral literal itself.
const STAFF_SPEAKERS = new Set(["아이미래로", "상담원"]);
const CUSTOMER_SPEAKERS = new Set(["고객", "산모", "남편"]);

type Side = "staff" | "customer" | "unattributed";

function speakerSide(speaker: string): Side {
  if (STAFF_SPEAKERS.has(speaker)) return "staff";
  if (CUSTOMER_SPEAKERS.has(speaker)) return "customer";
  return "unattributed";
}

export function transcriptTurnId(index: number): string {
  return `transcript-turn-${index}`;
}

/** Find the first turn containing an evidence quote (used for evidence-chip scroll). */
export function findEvidenceTurnIndex(transcript: TranscriptTurn[], evidence: string): number {
  const needle = evidence.replace(/\s/g, "").slice(0, 20);
  return transcript.findIndex((turn) => turn.text.replace(/\s/g, "").includes(needle));
}

export function TranscriptView({
  "data-component": dataComponent,
  transcript,
  highlightIndex,
}: {
  "data-component": string;
  transcript: TranscriptTurn[];
  highlightIndex?: number | null;
}) {
  return (
    <div data-component={dataComponent} className="flex flex-col gap-2 rounded-xl bg-gray-50 p-3">
      {transcript.map((turn, index) => {
        const side = speakerSide(turn.speaker);
        return (
          <div
            key={index}
            id={transcriptTurnId(index)}
            className={cn(
              "max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed",
              side === "staff" && "self-start bg-gray-200",
              side === "customer" && "self-end bg-blue-100",
              side === "unattributed" && "self-center bg-gray-100",
              highlightIndex === index && "ring-2 ring-amber-400",
            )}
          >
            <span className="mb-0.5 block text-[10px] text-gray-500">{turn.speaker}</span>
            {turn.text}
          </div>
        );
      })}
    </div>
  );
}
