"use client";

import { KeyRound } from "lucide-react";

import { ContentPaper } from "@/components/app/root/content-paper";

const SOURCE_COMPONENT = "CallIngestTokenBranchRequired";
const DATA_COMPONENT = "desktop_settings_sections_call-ingest-tokens_branch-required";

/**
 * Shown in place of CallIngestTokenSection when the owner's session has no
 * selected branch. The settings nav entry is owner-gated, not branch-gated,
 * so an owner can reach the section without a branch — and tokens are issued
 * per branch, so there is nothing to list yet. Lives here rather than inline
 * in the page so the page carries no visual styling
 * (ui-architecture/no-visual-tailwind-in-pages).
 */
export function CallIngestTokenBranchRequired() {
  return (
    <section data-component={DATA_COMPONENT} data-source-component={SOURCE_COMPONENT}>
      <ContentPaper variant="v3">
        <div data-component={`${DATA_COMPONENT}_header`} className="flex items-center gap-3">
          <div
            data-component={`${DATA_COMPONENT}_header_icon`}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-[hsl(var(--v3-primary))]/10"
          >
            <KeyRound size={20} className="text-[hsl(var(--v3-primary))]" />
          </div>
          <div data-component={`${DATA_COMPONENT}_header_title-group`} className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground">통화 수집 토큰</h2>
            <p className="text-sm text-muted-foreground">
              토큰은 지점별로 발급됩니다. 상단에서 지점을 먼저 선택해 주세요.
            </p>
          </div>
        </div>
      </ContentPaper>
    </section>
  );
}
