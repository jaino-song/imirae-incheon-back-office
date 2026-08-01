'use client';

import { use } from 'react';
import { FileText, Loader2, Monitor, Send, Workflow } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { InfoCard } from '@/components/app/mobile-redesign/detail-sheet';
import { MobileDetailSlideUp } from '@/components/app/mobile-redesign/mobile-detail-slideup';
import { useSystemTemplate } from '@/features/system-templates/hooks';

export default function EditSystemTemplatePage({ params }: { params: Promise<{ templateKey: string }> }) {
  const { templateKey } = use(params);
  const router = useRouter();
  const { data: template, isLoading } = useSystemTemplate(templateKey);

  const handleClose = () => router.back();

  if (isLoading) {
    return (
      <MobileDetailSlideUp
        name="messages-system-template-detail"
        open
        onClose={handleClose}
        title="시스템 템플릿"
      >
        <div className="detail-empty-state" data-component="mobile_messages_system-templates_template-key-detail_loading">
          <div
            className="flex items-center justify-center"
            data-component="mobile_messages_system-templates_template-key-detail_loading_spinner"
          >
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </div>
      </MobileDetailSlideUp>
    );
  }

  if (!template) {
    return (
      <MobileDetailSlideUp
        name="messages-system-template-detail"
        open
        onClose={handleClose}
        title="시스템 템플릿"
      >
        <div className="detail-empty-state" data-component="mobile_messages_system-templates_template-key-detail_error">
          템플릿을 찾을 수 없습니다.
        </div>
      </MobileDetailSlideUp>
    );
  }

  const handleSend = () => {
    const params = new URLSearchParams({ body: template.content });
    router.push(`/messages/new?${params.toString()}`);
  };

  return (
    <MobileDetailSlideUp
      name="messages-system-template-detail"
      open
      onClose={handleClose}
      title={template.name}
      primaryAction={{
        label: (
          <>
            <Send className="h-4 w-4" />
            이 템플릿으로 보내기
          </>
        ),
        onClick: handleSend,
        dataComponent: 'mobile_messages_system-templates_template-key-detail_send-cta',
      }}
    >
      <div className="message-detail pop-up" data-component="mobile_messages_system-templates_template-key-detail_detail-panel">
        <div className="message-detail-head" data-component="mobile_messages_system-templates_template-key-detail_detail-panel_summary">
          <div className="doc-icon doc-icon-primary" data-component="mobile_messages_system-templates_template-key-detail_detail-panel_summary_icon">
            <FileText size={16} strokeWidth={2.5} />
          </div>
          <div
            className="message-detail-head-text"
            data-component="mobile_messages_system-templates_template-key-detail_detail-panel_summary_text"
          >
            <div
              className="message-detail-title"
              data-component="mobile_messages_system-templates_template-key-detail_detail-panel_summary_text_description"
            >
              {template.description}
            </div>
            <div
              className="message-detail-subtitle"
              data-component="mobile_messages_system-templates_template-key-detail_detail-panel_summary_text_type"
            >
              메시지 템플릿
            </div>
          </div>
          <span className="badge-mini primary" data-component="mobile_messages_system-templates_template-key-detail_detail-panel_summary_badge">
            시스템
          </span>
        </div>

        <InfoCard data-component="mobile_messages_system-templates_template-key-detail_detail-panel_info-card" title="메시지 내용">
          <p className="message-detail-body" data-component="mobile_messages_system-templates_template-key-detail_detail-panel_info-card_content">
            {template.content}
          </p>
        </InfoCard>

        {template.requiredVariables && template.requiredVariables.length > 0 ? (
          <InfoCard data-component="mobile_messages_system-templates_template-key-detail_detail-panel_info-card-2" title="필수 변수">
            <div className="flex flex-wrap gap-2" data-component="mobile_messages_system-templates_template-key-detail_detail-panel_info-card-2_variables">
              {template.requiredVariables.map((variable) => (
                <span
                  key={variable.key}
                  className="badge-mini muted"
                  title={variable.description}
                >
                  <code className="font-mono text-[0.7rem]">#&#123;{variable.key}&#125;</code>
                  <span className="ml-1">· {variable.label}</span>
                </span>
              ))}
            </div>
          </InfoCard>
        ) : null}

        <div
          data-component="mobile_messages_system-templates_template-key-detail_detail-panel_desktop-only"
          className="info-card pop-up flex items-start gap-3 border border-dashed border-v3-border"
        >
          <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-v3-primary" />
          <p className="text-[0.78rem] leading-relaxed text-v3-text-muted">
            <span className="font-semibold text-v3-dark">시스템 템플릿 본문 편집·버전 롤백은 데스크톱에서만 가능합니다.</span>
            <br />
            내용 변경이 필요하면 데스크톱에서 열어 주세요.
          </p>
        </div>

        <div
          data-component="mobile_messages_system-templates_template-key-detail_detail-panel_trigger-link"
          className="info-card pop-up flex items-start gap-3"
        >
          <Workflow className="mt-0.5 h-5 w-5 shrink-0 text-v3-primary" />
          <div className="flex-1" data-component="mobile_messages_system-templates_template-key-detail_detail-panel_trigger-link_copy">
            <p className="text-[0.85rem] font-semibold text-v3-dark">자동 발송 규칙 설정 (출시 예정)</p>
            <p className="text-[0.72rem] text-v3-text-muted">
              이 템플릿의 자동 발송 ON/OFF·발송 시점은 메시지 → 자동 전송에서 관리합니다.
            </p>
          </div>
        </div>
      </div>
    </MobileDetailSlideUp>
  );
}
