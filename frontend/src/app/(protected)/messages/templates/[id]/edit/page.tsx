"use client";

import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { TemplateEditor } from "@/components/app/my-templates/template-editor";
import { useMessageTemplate } from "@/hooks/use-message-templates";
import { ContentPaper } from "@/components/app/root/content-paper";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";

function BackButton() {
    return (
        <div data-component="desktop_messages_sections_template-edit-nav" className="mb-4">
            <Button variant="ghost" size="icon" asChild>
                <Link href="/messages/templates">
                    <ArrowLeft className="h-6 w-6" />
                </Link>
            </Button>
        </div>
    );
}

function TemplateEditorPageSkeleton() {
    return (
        <div data-component="desktop_messages_sections_template-edit-loading-skeleton" className="space-y-6">
            <div data-component="desktop_messages_sections_template-edit-loading-skeleton_template-edit-loading-field" className="space-y-2">
                <Skeleton className="h-4 w-24 bg-v3-dim-white" />
                <Skeleton className="h-11 w-full rounded-[14px] bg-v3-dim-white" />
            </div>
            <div data-component="desktop_messages_sections_template-edit-loading-skeleton_template-edit-loading-field" className="space-y-2">
                <Skeleton className="h-4 w-20 bg-v3-dim-white" />
                <Skeleton className="h-52 w-full rounded-[14px] bg-v3-dim-white" />
            </div>
            <div data-component="desktop_messages_sections_template-edit-loading-skeleton_template-edit-loading-actions" className="flex justify-end">
                <Skeleton className="h-10 w-24 rounded-[12px] bg-v3-dim-white" />
            </div>
        </div>
    );
}

export default function EditTemplatePage() {
    const params = useParams();
    const id = params.id as string;
    const locale = useLocale();

    const { data: template, isLoading, error } = useMessageTemplate(id);

    if (isLoading) {
        return (
            <div data-component="desktop_messages_sections_template-edit" className="bg-background">
                <div data-component="desktop_messages_sections_template-edit_template-edit-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
                    <BackButton />
                    <ContentPaper
                        title={t(locale, "template-editor.edit-title")}
                        className="min-h-[70vh]"
                    >
                        <TemplateEditorPageSkeleton />
                    </ContentPaper>
                </div>
            </div>
        );
    }

    if (error || !template) {
        return (
            <div data-component="desktop_messages_sections_template-edit" className="bg-background">
                <div data-component="desktop_messages_sections_template-edit_template-edit-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
                    <BackButton />
                    <ContentPaper
                        title={t(locale, "template-editor.edit-title")}
                        className="min-h-[70vh]"
                    >
                        <Alert variant="destructive">
                            <AlertDescription>{t(locale, "common.error-loading")}</AlertDescription>
                        </Alert>
                    </ContentPaper>
                </div>
            </div>
        );
    }

    return (
        <div data-component="desktop_messages_sections_template-edit" className="bg-background">
            <section data-component="desktop_messages_sections_template-edit_template-edit-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
                <BackButton />
                <ContentPaper
                    title={t(locale, "template-editor.edit-title")}
                    subtitle={t(locale, "template-editor.edit-subtitle")}
                    className="min-h-[70vh]"
                >
                    <TemplateEditor initialData={template} />
                </ContentPaper>
            </section>
        </div>
    );
}
