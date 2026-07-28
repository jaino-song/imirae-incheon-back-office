"use client";
import { useEffect, useState } from "react";
import { infoMsgTemplate } from "../templates/messageTemplate/infoMsg";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { AutoFillMsgCard } from "../templates/AutoFillMsgCard";
import {
  TemplateMessageFormFrame,
  type TemplateMessageFormLayout,
} from "./form-components/TemplateMessageFormLayout";


interface InfoMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
  renderLayout?: TemplateMessageFormLayout;
  showMessageSide?: boolean;
}

export const InfoMessageForm = ({
  onPreviewMessageChange,
  renderLayout,
  showMessageSide = true,
}: InfoMessageFormProps) => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const { data: systemTemplate } = useSystemTemplate("INFO");

  const initialMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, {})
    : infoMsgTemplate();

  const displayMessage = isDirty ? generatedMessage : initialMessage;

  useEffect(() => {
    onPreviewMessageChange?.(displayMessage);
  }, [displayMessage, onPreviewMessageChange]);

  const handleCopy = () => {
    return navigator.clipboard.writeText(displayMessage);
  };

  const messageCard = displayMessage ? (
    <AutoFillMsgCard
      title={t(locale, "common.generated-message-title")}
      copyButtonText={t(locale, "common.copy-button")}
      copySuccessMessage={t(locale, "common.copy-success-message")}
      message={displayMessage}
      bodyDescription="메시지 내용을 수정할 수 있어요."
      onMessageChange={(message) => {
        setIsDirty(true);
        setGeneratedMessage(message);
      }}
      handleCopy={handleCopy}
      showSide={showMessageSide}
    />
  ) : null;

  return (
    <TemplateMessageFormFrame
      dataComponent="desktop_messages_sections_info-form"
      fields={null}
      messageCard={messageCard}
      requiresRecipientName={false}
      renderLayout={renderLayout}
    />
  );
};
