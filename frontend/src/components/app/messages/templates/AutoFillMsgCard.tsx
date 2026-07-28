import { memo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Copy } from "lucide-react";

import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { HeaderActionButton, InfoCard, InfoRow } from "@/components/app/v3";
import {
  APP_CONTENT_BODY_CARD_CLASS_NAME,
  APP_CONTENT_CARD_MUTED_CLASS_NAME,
  AppContentCard,
} from "@/components/ui/app-surface";
import { cn } from "@/lib/utils";

import { MsgField } from "./MsgField";

export interface AutoFillMsgCardMetaItem {
  label: string;
  value: ReactNode;
}

export interface AutoFillMsgCardVariableItem {
  token: string;
  label: string;
  value: string;
}

export type AutoFillMsgCardLayout = "grouped" | "flat";

export interface AutoFillMsgCardProps {
  title: string;
  copyButtonText: string;
  copySuccessMessage?: string;
  message: string;
  onMessageChange?: (value: string) => void;
  handleCopy: () => void | Promise<void>;
  children?: ReactNode;
  bodyTitle?: string;
  bodyDescription?: string;
  metaTitle?: string;
  metaItems?: AutoFillMsgCardMetaItem[];
  variableTitle?: string;
  variableItems?: AutoFillMsgCardVariableItem[];
  variableEmptyText?: string;
  layout?: AutoFillMsgCardLayout;
  showSide?: boolean;
}

export interface AutoFillMsgCardSideProps {
  title: string;
  message: string;
  onMessageChange?: (value: string) => void;
  metaTitle?: string;
  metaItems?: AutoFillMsgCardMetaItem[];
  variableTitle?: string;
  variableItems?: AutoFillMsgCardVariableItem[];
  variableEmptyText?: string;
  className?: string;
}

export function AutoFillMsgCardSide({
  title,
  message,
  onMessageChange,
  metaTitle = "메시지 정보",
  metaItems,
  variableTitle = "변수",
  variableItems,
  variableEmptyText = "변수 정보가 없습니다.",
  className,
}: AutoFillMsgCardSideProps) {
  const fallbackMetaItems: AutoFillMsgCardMetaItem[] = [
    { label: "구성 영역", value: title },
    { label: "메시지 길이", value: `${message.length}자` },
    { label: "문단 수", value: `${message.split("\n").filter((line) => line.trim().length > 0).length}개` },
    { label: "편집 상태", value: onMessageChange ? "수정 가능" : "읽기 전용" },
  ];
  const resolvedMetaItems = metaItems?.length ? metaItems : fallbackMetaItems;
  const hasVariableItems = Boolean(variableItems?.length);

  return (
    <div
      data-component="desktop_messages_sections_generated-msg-detail-side"
      className={cn("flex flex-col gap-3 self-start", className)}
    >
      <InfoCard
        data-component="desktop_messages_sections_generated-msg-detail-meta"
        title={metaTitle}
        className="h-fit"
      >
        <div
          data-component="desktop_messages_sections_generated-msg-detail-meta_list"
          className="-mt-1"
        >
          {resolvedMetaItems.map((item) => (
            <InfoRow
              key={`${item.label}`}
              data-component="desktop_messages_sections_generated-msg-detail-meta_list_item"
              label={item.label}
              value={item.value}
            />
          ))}
        </div>
      </InfoCard>

      <InfoCard
        data-component="desktop_messages_sections_generated-msg-detail-variables"
        title={variableTitle}
        className="h-fit"
      >
        <div
          data-component="desktop_messages_sections_generated-msg-detail-variables_body"
          className="-mt-1"
        >
          {hasVariableItems ? (
            <div
              data-component="desktop_messages_sections_generated-msg-detail-variables_body_list"
              className="space-y-1"
            >
              {variableItems?.map((item) => (
                <div
                  key={`${item.token}-${item.label}`}
                  data-component="desktop_messages_sections_generated-msg-detail-variables_body_list_item"
                  className="flex items-center justify-between gap-3 border-b border-v3-border py-2.5 text-[calc(12px*var(--glint-ui-scale,1))] last:border-b-0"
                >
                  <div
                    data-component="desktop_messages_sections_generated-msg-detail-variables_body_list_item_meta"
                    className="flex min-w-0 flex-wrap items-center gap-2"
                  >
                    <span
                      data-component="desktop_messages_sections_generated-msg-detail-variables_body_list_item_meta_label"
                      className="text-v3-text-muted"
                    >
                      {item.label}
                    </span>
                    <span
                      data-component="desktop_messages_sections_generated-msg-detail-variables_body_list_item_meta_token"
                      className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[calc(11.52px*var(--glint-ui-scale,1))] font-semibold text-v3-primary"
                    >
                      {item.token}
                    </span>
                  </div>
                  <p
                    data-component="desktop_messages_sections_generated-msg-detail-variables_body_list_item_value"
                    className="shrink-0 text-right text-[calc(12px*var(--glint-ui-scale,1))] font-semibold text-v3-dark"
                  >
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">{variableEmptyText}</p>
          )}
        </div>
      </InfoCard>
    </div>
  );
}

export const AutoFillMsgCard = memo(function AutoFillMsgCard({
  title,
  copyButtonText,
  copySuccessMessage,
  message,
  onMessageChange,
  handleCopy,
  children,
  bodyTitle = "메시지 본문",
  bodyDescription = "메시지 내용을 수정할 수 있어요.",
  metaTitle = "메시지 정보",
  metaItems,
  variableTitle = "변수",
  variableItems,
  variableEmptyText = "변수 정보가 없습니다.",
  layout = "grouped",
  showSide = true,
}: AutoFillMsgCardProps) {
  const [isCopySuccessOpen, setIsCopySuccessOpen] = useState(false);

  const handleCopyClick = () => {
    void handleCopy();
    if (copySuccessMessage) setIsCopySuccessOpen(true);
  };

  const copySuccessNotification = copySuccessMessage ? (
    <NotificationOneButtonModal
      open={isCopySuccessOpen}
      onOpenChange={setIsCopySuccessOpen}
      dataComponent="desktop_messages_sections_copy-success-notification"
      title={copySuccessMessage}
      description="복사한 내용을 원하는 곳에 붙여넣을 수 있습니다."
      onAcknowledge={() => setIsCopySuccessOpen(false)}
    />
  ) : null;

  const detailGridContent = (
    <>
      <div
        data-component="desktop_messages_sections_generated-msg-detail-content"
        className={cn(
          "scrollbar-hide flex h-full min-h-0 flex-col",
          APP_CONTENT_CARD_MUTED_CLASS_NAME,
        )}
      >
        <div
          data-component="desktop_messages_sections_generated-msg-detail-content_header"
          className="mb-4 flex items-start justify-between gap-4"
        >
          <div data-component="desktop_messages_sections_generated-msg-detail-content_header_title" className="min-w-0">
            <h3 className="text-[calc(14.4px*var(--glint-ui-scale,1))] font-bold text-v3-dark">{bodyTitle}</h3>
            <p className="mt-0.5 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">{bodyDescription}</p>
          </div>
          <HeaderActionButton
            icon={Copy}
            label={copyButtonText}
            onClick={handleCopyClick}
            data-component="desktop_messages_sections_generated-msg-copy"
            className="shrink-0 whitespace-nowrap text-[calc(12px*var(--glint-ui-scale,1))]"
          />
        </div>

        <div
          data-component="desktop_messages_sections_generated-msg-detail-content_body"
          className={cn(
            "flex min-h-[calc(320px*var(--glint-ui-scale,1))] flex-1",
            APP_CONTENT_BODY_CARD_CLASS_NAME,
          )}
        >
          <MsgField label={bodyTitle} value={message} onChange={onMessageChange} />
        </div>
      </div>

      {showSide ? (
        <AutoFillMsgCardSide
          title={title}
          message={message}
          onMessageChange={onMessageChange}
          metaTitle={metaTitle}
          metaItems={metaItems}
          variableTitle={variableTitle}
          variableItems={variableItems}
          variableEmptyText={variableEmptyText}
        />
      ) : null}
    </>
  );

  if (layout === "flat") {
    return (
      <>
        {detailGridContent}
        {children ? (
          <AppContentCard
            data-component="desktop_messages_sections_generated-msg-actions"
            variant="outlined"
            className="xl:col-span-2"
            contentClassName="block"
          >
            {children}
          </AppContentCard>
        ) : null}
        {copySuccessNotification}
      </>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, filter: "blur(10px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.8 }}
        data-component="desktop_messages_sections_generated-msg-panel"
        className="min-h-0 space-y-4"
      >
        <div
          data-component="desktop_messages_sections_generated-msg-panel_detail-grid"
          className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]"
        >
          {detailGridContent}
        </div>

        {children ? (
          <AppContentCard
            data-component="desktop_messages_sections_generated-msg-actions"
            variant="outlined"
            contentClassName="block"
          >
            {children}
          </AppContentCard>
        ) : null}
      </motion.div>
      {copySuccessNotification}
    </>
  );
});
