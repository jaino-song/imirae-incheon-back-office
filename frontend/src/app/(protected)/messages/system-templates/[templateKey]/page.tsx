'use client';

import { use } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSystemTemplate } from '@/features/system-templates/hooks';
import { SystemTemplateEditor } from '@/features/system-templates/components/system-template-editor';
import { VersionHistory } from '@/features/system-templates/components/VersionHistory';
import { ContentPaper } from '@/components/app/root/content-paper';

function SystemTemplateDetailSkeleton() {
  return (
      <div data-component="desktop_messages_sections_system-template-detail-loading-skeleton" className="space-y-6">
        <div data-component="desktop_messages_sections_system-template-detail-loading-skeleton_system-template-detail-loading-header" className="space-y-3">
        <div data-component="desktop_messages_sections_system-template-detail-loading-skeleton_system-template-detail-loading-header_system-template-detail-loading-title-row" className="flex items-center gap-3">
          <Skeleton className="h-6 w-44 bg-v3-dim-white" />
          <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white" />
        </div>
        <Skeleton className="h-4 w-72 max-w-full bg-v3-dim-white" />
      </div>
      <div data-component="desktop_messages_sections_system-template-detail-loading-skeleton_system-template-detail-loading-actions" className="flex justify-between">
        <Skeleton className="h-9 w-20 rounded-[10px] bg-v3-dim-white" />
        <Skeleton className="h-9 w-28 rounded-[10px] bg-v3-dim-white" />
      </div>
      <div data-component="desktop_messages_sections_system-template-detail-loading-skeleton_system-template-detail-loading-editor" className="space-y-4">
        <Skeleton className="h-11 w-full rounded-[14px] bg-v3-dim-white" />
        <Skeleton className="h-52 w-full rounded-[14px] bg-v3-dim-white" />
        <div data-component="desktop_messages_sections_system-template-detail-loading-skeleton_system-template-detail-loading-editor_system-template-detail-loading-save" className="flex justify-end">
          <Skeleton className="h-10 w-24 rounded-[12px] bg-v3-dim-white" />
        </div>
      </div>
    </div>
  );
}

export default function EditSystemTemplatePage({ params }: { params: Promise<{ templateKey: string }> }) {
  const { templateKey } = use(params);
  const router = useRouter();
  const { data: template, isLoading } = useSystemTemplate(templateKey);

  if (isLoading) {
    return (
      <div data-component="desktop_messages_sections_system-template-detail" className="bg-background">
        <section data-component="desktop_messages_sections_system-template-detail_system-template-detail-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
          <ContentPaper className="min-h-[70vh]">
            <SystemTemplateDetailSkeleton />
          </ContentPaper>
        </section>
      </div>
    );
  }

  if (!template) {
    return (
      <div data-component="desktop_messages_sections_system-template-detail" className="bg-background">
        <section data-component="desktop_messages_sections_system-template-detail_system-template-detail-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
          <ContentPaper title="오류" className="min-h-[70vh]">
            <p className="text-muted-foreground">템플릿을 찾을 수 없습니다.</p>
          </ContentPaper>
        </section>
      </div>
    );
  }

  const customHeader = (
    <div data-component="desktop_messages_sections_system-template-detail-header" className="mb-6">
      <div data-component="desktop_messages_sections_system-template-detail-header_system-template-detail-title-row" className="flex items-center gap-3 mb-2">
        <h2 className="text-xl font-bold text-primary">
          {template.name}
        </h2>
        <Badge>시스템</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {template.description}
      </p>
    </div>
  );

  return (
    <div data-component="desktop_messages_sections_system-template-detail" className="bg-background">
      <section data-component="desktop_messages_sections_system-template-detail_system-template-detail-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
        <ContentPaper
          header={customHeader}
          className="min-h-[70vh]"
        >
          <div data-component="desktop_messages_sections_system-template-detail_system-template-detail-content_system-template-detail-actions" className="flex justify-between items-center mb-6">
            <Button variant="ghost" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              뒤로
            </Button>
            <VersionHistory templateKey={template.templateKey} onRollback={() => router.refresh()} />
          </div>
          <SystemTemplateEditor template={template} />
        </ContentPaper>
      </section>
    </div>
  );
}
