"use client";

import { ArrowLeft, Monitor } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ContentPaper } from "@/components/app/root/content-paper";

export default function NewTemplatePage() {
  return (
    <div data-component="mobile_messages_templates_new_page" className="bg-background">
      <section
        data-component="mobile_messages_templates_new_page_content"
        className="mx-auto px-4 py-6 sm:px-6 md:px-12 sm:py-8"
      >
        <div data-component="mobile_messages_templates_new_page_content_nav" className="mb-4">
          <Button variant="ghost" size="icon" className="h-[44px] w-[44px]" asChild>
            <Link href="/messages/templates">
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>
        </div>

        <ContentPaper title="템플릿 생성" subtitle="템플릿 생성은 데스크톱에서만 가능합니다">
          <div
            data-component="mobile_messages_templates_new_page_content_desktop-only"
            className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-v3-border bg-v3-dim-white px-6 py-10 text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-v3-primary/10">
              <Monitor className="h-6 w-6 text-v3-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-bold text-v3-dark">데스크톱에서 작성하세요</p>
              <p className="text-[0.78rem] text-v3-text-muted leading-relaxed">
                모바일에서는 템플릿 보기와 발송만 지원합니다. 새 템플릿은 데스크톱에서 충분한 입력 공간과
                미리보기 환경에서 작성하는 것을 권장합니다.
              </p>
            </div>
            <Button asChild variant="default">
              <Link href="/messages/templates">템플릿 목록으로</Link>
            </Button>
          </div>
        </ContentPaper>
      </section>
    </div>
  );
}
