"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ContentPaper } from "@/components/app/root/content-paper";
import { TemplateEditor } from "@/components/app/my-templates/template-editor";
import { useScrollActivity } from "@/components/app/v3/useScrollActivity";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";

export default function NewTemplatePage() {
    const locale = useLocale();
    const { isScrollActive, handleScroll } = useScrollActivity();

    return (
        <div
            data-component="desktop_messages_sections_templates-new"
            className="scrollbar-on-scroll h-full min-h-0 overflow-y-auto bg-background"
            data-scroll-active={isScrollActive ? "true" : "false"}
            onScroll={handleScroll}
        >
            <section data-component="desktop_messages_sections_templates-new_templates-new-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
                <div data-component="desktop_messages_sections_templates-new_templates-new-content_templates-new-nav" className="mb-4">
                    <Button variant="ghost" size="icon" asChild>
                        <Link href="/messages/templates">
                            <ArrowLeft className="h-6 w-6" />
                        </Link>
                    </Button>
                </div>
                <ContentPaper
                    title={t(locale, "template-editor.create-title")}
                    subtitle={t(locale, "template-editor.create-subtitle")}
                    className="min-h-[70vh]"
                >
                    <TemplateEditor />
                </ContentPaper>
            </section>
        </div>
    );
}
