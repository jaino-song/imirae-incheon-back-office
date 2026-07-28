"use client";

import { Battery, ChevronLeft, MessageCircle, Send, Signal, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessagePhonePreviewProps {
  content: string;
  templateName?: string;
  headline?: string;
  subtitle?: string;
  buttons?: string[];
  timestamp?: string;
  channelName?: string;
  className?: string;
  panelDataComponent?: string;
  dataComponentPrefix: string;
}

export function MessagePhonePreview({
  content,
  templateName,
  buttons = [],
  timestamp,
  channelName = "아가잼잼",
  className,
  panelDataComponent,
  dataComponentPrefix,
}: MessagePhonePreviewProps) {
  const component = (suffix: string) => `${dataComponentPrefix}_${suffix}`;
  const resolvedPanelDataComponent = panelDataComponent ?? component("templates-preview-panel");
  const timeText =
    timestamp && timestamp.trim().length > 0
      ? timestamp
      : `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
  const hasContent = content.trim().length > 0;

  return (
    <div data-component={resolvedPanelDataComponent} className={cn("flex min-h-0 justify-center py-2", className)}>
      <div data-component={component("preview-phone")} className="flex h-full min-h-0 w-[320px] shrink-0">
        <div data-component={component("preview-shell")} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[44px] border-[3px] border-gray-800 bg-gray-800">
          <div data-component={component("preview-statusbar")} className="flex shrink-0 items-center justify-between bg-gray-800 px-6 pt-3 pb-2">
            <span className="text-[0.65rem] font-medium text-gray-400">{timeText}</span>
            <div data-component={component("preview-status-icons")} className="flex items-center gap-1.5">
              <Signal className="h-3 w-3 text-gray-400" />
              <Wifi className="h-3 w-3 text-gray-400" />
              <Battery className="h-3.5 w-3.5 text-gray-400" />
            </div>
          </div>

          <div data-component={component("preview-header")} className="flex shrink-0 items-center gap-2 bg-[#B2C7D9] px-3 py-2">
            <ChevronLeft className="h-5 w-5 text-gray-700" />
            <div data-component={component("preview-header-title")} className="flex min-w-0 flex-1 items-center gap-2">
              <div data-component={component("preview-header-avatar")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FAE100]">
                <MessageCircle className="h-4 w-4 text-[#3C1E1E]" />
              </div>
              <span className="truncate text-[0.8rem] font-bold text-gray-900">{channelName}</span>
            </div>
          </div>

          <div data-component={component("preview-body")} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-[#B2C7D9] px-3 py-4">
            {hasContent ? (
              <div data-component={component("preview-message-row")} className="flex items-end gap-1.5">
                <div data-component={component("preview-message-avatar")} className="flex h-9 w-9 shrink-0 self-start items-center justify-center rounded-full bg-[#FAE100]">
                  <MessageCircle className="h-4 w-4 text-[#3C1E1E]" />
                </div>
                <div data-component={component("preview-message-content")} className="flex min-w-0 max-w-[85%] flex-col gap-1">
                  <span className="truncate pl-1 text-[0.7rem] font-semibold text-gray-800">
                    {templateName || "메시지 템플릿"}
                  </span>
                  <div data-component={component("preview-message-card")} className="overflow-hidden rounded-xl bg-white shadow-sm">
                    <div data-component={component("preview-message-text")} className="px-3.5 py-3">
                      <pre className="break-all whitespace-pre-wrap font-sans text-[0.72rem] leading-relaxed text-gray-800">
                        {content}
                      </pre>
                    </div>

                    {buttons.length > 0 ? (
                      <div data-component={component("preview-message-buttons")} className="border-t border-gray-100">
                        {buttons.map((buttonLabel, index) => (
                          <button
                            type="button"
                            key={`${buttonLabel}-${index}`}
                            className="w-full border-b border-gray-100 py-2.5 text-center text-[0.72rem] font-medium text-[#4A90D9] transition-colors last:border-b-0 hover:bg-gray-50"
                          >
                            {buttonLabel}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <span className="pl-1 text-[0.6rem] text-gray-600">{timeText}</span>
                </div>
              </div>
            ) : (
              <div data-component={component("preview-empty")} className="flex h-full min-h-0 items-center justify-center">
                <div data-component={component("preview-empty-content")} className="text-center">
                  <MessageCircle className="mx-auto mb-2 h-8 w-8 text-gray-500/40" />
                  <p className="text-[0.72rem] text-gray-600/70">
                    템플릿 내용을 입력하면
                    <br />
                    미리보기가 표시됩니다
                  </p>
                </div>
              </div>
            )}
          </div>

          <div data-component={component("preview-inputbar")} className="flex shrink-0 items-center gap-2 bg-[#EFF2F6] px-3 py-2.5">
            <div data-component={component("preview-input")} className="flex-1 rounded-full bg-white px-3.5 py-2 text-[0.7rem] text-gray-400">
              메시지 입력
            </div>
            <div data-component={component("preview-send")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FAE100]">
              <Send className="h-3.5 w-3.5 text-[#3C1E1E]" />
            </div>
          </div>

          <div data-component={component("preview-homebar")} className="flex h-5 shrink-0 items-center justify-center bg-gray-800">
            <div data-component={component("preview-homebar-indicator")} className="h-1 w-28 rounded-full bg-gray-600" />
          </div>
        </div>
      </div>
    </div>
  );
}
