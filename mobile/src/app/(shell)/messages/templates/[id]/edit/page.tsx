"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Monitor, Send } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMessageTemplate } from "@/hooks/use-message-templates";
import { ContentPaper } from "@/components/app/root/content-paper";

function BackButton() {
  return (
    <div data-component="mobile_messages_templates_edit_page_nav" className="mb-4">
      <Button variant="ghost" size="icon" asChild>
        <Link href="/messages/templates">
          <ArrowLeft className="h-6 w-6" />
        </Link>
      </Button>
    </div>
  );
}

export default function EditTemplatePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: template, isLoading, error } = useMessageTemplate(id);

  if (isLoading) {
    return (
      <div data-component="mobile_messages_templates_edit_page" className="bg-background">
        <div data-component="mobile_messages_templates_edit_page_loading" className="mx-auto px-4 py-6 sm:px-6 sm:py-8 md:px-12">
          <BackButton />
          <ContentPaper title="템플릿" className="flex min-h-[70vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </ContentPaper>
        </div>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div data-component="mobile_messages_templates_edit_page" className="bg-background">
        <div data-component="mobile_messages_templates_edit_page_error" className="mx-auto px-4 py-6 sm:px-6 sm:py-8 md:px-12">
          <BackButton />
          <ContentPaper title="템플릿" className="min-h-[70vh]">
            <Alert variant="destructive">
              <AlertDescription>템플릿을 불러오지 못했습니다.</AlertDescription>
            </Alert>
          </ContentPaper>
        </div>
      </div>
    );
  }

  return (
    <div data-component="mobile_messages_templates_edit_page" className="bg-background">
      <section
        data-component="mobile_messages_templates_edit_page_content"
        className="mx-auto px-4 py-6 sm:px-6 md:px-12 sm:py-8"
      >
        <BackButton />
        <ContentPaper title={template.name} subtitle="모바일에서는 보기와 발송만 지원합니다">
          <div data-component="mobile_messages_templates_edit_page_content_body" className="space-y-4">
            <div
              data-component="mobile_messages_templates_edit_page_content_body_text"
              className="whitespace-pre-wrap rounded-2xl border border-v3-border/60 bg-white p-4 text-[0.85rem] leading-relaxed text-v3-dark"
            >
              {template.content}
            </div>

            <div
              data-component="mobile_messages_templates_edit_page_content_body_desktop-only"
              className="flex items-start gap-3 rounded-2xl border border-dashed border-v3-border bg-v3-dim-white px-4 py-3"
            >
              <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-v3-primary" />
              <p className="text-[0.78rem] text-v3-text-muted leading-relaxed">
                <span className="font-semibold text-v3-dark">템플릿 편집은 데스크톱에서만 가능합니다.</span>
                <br />
                이름·본문·변수 수정이 필요하면 데스크톱에서 열어 주세요.
              </p>
            </div>

            <Button
              data-component="mobile_messages_templates_edit_page_content_body_send-cta"
              className="w-full gap-2"
              onClick={() =>
                router.push(`/messages/new?template=${encodeURIComponent(String(template.id))}`)
              }
            >
              <Send className="h-4 w-4" />이 템플릿으로 보내기
            </Button>
          </div>
        </ContentPaper>
      </section>
    </div>
  );
}
