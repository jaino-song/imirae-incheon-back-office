"use client";
import { useEffect, useState } from "react";
import { greetingMsgTemplate } from "../templates/messageTemplate/greetingMsg";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { AutoFillMsgCard } from "../templates/AutoFillMsgCard";
import {
  TemplateMessageFormFrame,
  type TemplateMessageFormLayout,
} from "./form-components/TemplateMessageFormLayout";


interface GreetingMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
  renderLayout?: TemplateMessageFormLayout;
  showMessageSide?: boolean;
}

export const GreetingMessageForm = ({
  onPreviewMessageChange,
  renderLayout,
  showMessageSide = true,
}: GreetingMessageFormProps) => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const { data: systemTemplate } = useSystemTemplate("GREETING");

  const initialMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, {})
    : greetingMsgTemplate();

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
      bodyDescription={systemTemplate?.description || "기본 인사 메시지를 검토하고 바로 수정할 수 있습니다."}
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
      dataComponent="desktop_messages_sections_greeting-form"
      className="w-full"
      fields={null}
      messageCard={messageCard}
      requiresRecipientName={false}
      renderLayout={renderLayout}
    />
  );
};
