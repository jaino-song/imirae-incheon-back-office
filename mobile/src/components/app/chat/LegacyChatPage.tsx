"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { Bell, Send, SquarePen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/app/chat/CodeBlock";
import ClientRegistrationWizard, {
  type CreatedClient,
} from "@/components/app/chat/ClientRegistrationWizard";
import ContractSendWizard from "@/components/app/chat/ContractSendWizard";
import ContractStatusWizard, {
  type ContractStatusResult,
} from "@/components/app/chat/ContractStatusWizard";
import { useChatStream, type ChatMessage } from "@/hooks/useChatStream";
import { useInitialUser } from "@/providers/UserProvider";
import { LegacyTypingIndicator } from "@/components/app/chat/LegacyTypingIndicator";

import styles from "./LegacyChatPage.module.css";

interface ChatDisplayMessage extends ChatMessage {
  id: string;
  sources?: string[];
  timeLabel?: string;
}

function formatMessageTime(message: ChatDisplayMessage) {
  if (message.timeLabel) return message.timeLabel;

  const date = new Date(message.timestamp);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function UserMessage({ message }: { message: ChatDisplayMessage }) {
  const timeLabel = formatMessageTime(message);

  return (
    <div className={`${styles.msgRow} ${styles.userRow}`} data-component="mobile_chat_page_content_messages_message-user">
      <div className={`${styles.msgAvatar} ${styles.userAvatar}`} data-component="mobile_chat_page_content_messages_message-user_avatar">송</div>
      <div data-component="mobile_chat_page_content_messages_message-user_body">
        <div className={styles.msgBubble} data-component="mobile_chat_page_content_messages_message-user_body_bubble">{message.content}</div>
        {timeLabel && <div className={styles.msgTime} data-component="mobile_chat_page_content_messages_message-user_body_time">{timeLabel}</div>}
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatDisplayMessage }) {
  const wizardType = message.ui?.type;
  const [createdClient, setCreatedClient] = useState<CreatedClient | null>(null);
  const [contractStatus, setContractStatus] = useState<ContractStatusResult | null>(null);
  const [contractSendDone, setContractSendDone] = useState(false);

  const wizardContent = useMemo(() => {
    if (!wizardType) return null;

    switch (wizardType) {
      case "clientRegistrationWizard":
        if (createdClient) {
          return (
            <div data-component="mobile_chat_page_content_messages_message-assistant_body_bubble_wizard-registration-success">
              산모 등록 완료: {createdClient.name} (ID: {createdClient.id})
            </div>
          );
        }

        return <ClientRegistrationWizard onCreated={(client) => setCreatedClient(client)} />;

      case "contractSendWizard":
        if (contractSendDone) {
          return <div data-component="mobile_chat_page_content_messages_message-assistant_body_bubble_wizard-contract-send-success">계약서 전송 화면으로 이동했습니다.</div>;
        }

        return <ContractSendWizard onComplete={() => setContractSendDone(true)} />;

      case "contractStatusWizard":
        if (contractStatus) {
          return (
            <div data-component="mobile_chat_page_content_messages_message-assistant_body_bubble_wizard-contract-status-result" className={styles.wizardResult}>
              <div data-component="mobile_chat_page_content_messages_message-assistant_body_bubble_wizard-contract-status-result_state">
                계약서 상태: <strong>{String(contractStatus.documentStatus)}</strong>
              </div>
              <div data-component="mobile_chat_page_content_messages_message-assistant_body_bubble_wizard-contract-status-result_client">
                산모: {contractStatus.clientName} (ID: {contractStatus.clientId})
              </div>
              {contractStatus.serviceStatus && (
                <div data-component="mobile_chat_page_content_messages_message-assistant_body_bubble_wizard-contract-status-result_service">서비스 상태: {contractStatus.serviceStatus}</div>
              )}
            </div>
          );
        }

        return <ContractStatusWizard onCheck={(result) => setContractStatus(result)} />;

      default:
        return null;
    }
  }, [wizardType, createdClient, contractSendDone, contractStatus]);

  const timeLabel = formatMessageTime(message);
  const showTyping = message.isStreaming && !message.content && !wizardContent;

  return (
    <div className={styles.msgRow} data-component="mobile_chat_page_content_messages_message-assistant">
      <div className={`${styles.msgAvatar} ${styles.aiAvatar}`} data-component="mobile_chat_page_content_messages_message-assistant_avatar">AI</div>
      <div data-component="mobile_chat_page_content_messages_message-assistant_body">
        {showTyping ? (
          <LegacyTypingIndicator className={styles.msgTyping} />
        ) : (
          <div className={styles.msgBubble} data-component="mobile_chat_page_content_messages_message-assistant_body_bubble">
            {wizardContent ? (
              wizardContent
            ) : (
              <div className={styles.chatMarkdown} data-component="mobile_chat_page_content_messages_message-assistant_body_bubble_markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code: ({ className, children, ref, ...props }) => {
                      void ref;
                      const match = /language-(\w+)/.exec(className || "");
                      const language = match ? match[1] : "";
                      const codeString = String(children).replace(/\n$/, "");

                      if (language) {
                        return (
                          <CodeBlock
                            data-component="mobile_chat_page_content_messages_message-assistant_body_bubble_markdown_code-block"
                            language={language}
                          >
                            {codeString}
                          </CodeBlock>
                        );
                      }

                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                    table: ({ children }) => (
                      <div className={styles.tableWrapper} data-component="mobile_chat_page_content_messages_message-assistant_body_bubble_markdown_table-wrapper">
                        <table>{children}</table>
                      </div>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
        {message.sources && (
          <div className={styles.msgSources} data-component="mobile_chat_page_content_messages_message-assistant_body_sources">
            {message.sources.map((source) => (
              <span className={styles.msgSource} key={source}>
                {source}
              </span>
            ))}
          </div>
        )}
        {timeLabel && !showTyping && (
          <div className={styles.msgTime} data-component="mobile_chat_page_content_messages_message-assistant_body_time">
            {timeLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolExecutingIndicator({ toolName }: { toolName: string | null }) {
  return (
    <div className={styles.stateIndicator} data-component="mobile_chat_page_content_messages_tool-executing-indicator">
      <p>{toolName ? `${toolName} 실행 중...` : "처리 중..."}</p>
    </div>
  );
}

function ChatComposer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (message: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    void onSubmit(trimmed);
    setValue("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    handleSubmit();
  };

  return (
    <div className={styles.chatInputBar} data-component="mobile_chat_page_input-area">
      <textarea
        ref={textareaRef}
        className={styles.chatInput}
        placeholder="질문을 입력하세요..."
        rows={1}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        data-component="mobile_chat_page_input-area_input"
      />
      <button
        className={styles.chatSend}
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        aria-label="메시지 보내기"
      >
        <Send size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}

export function LegacyChatPage() {
  const user = useInitialUser();
  const {
    messages,
    state,
    sendMessage,
    confirmAction,
    cancelAction,
    pendingConfirmation,
    clearSession,
    isToolExecuting,
    currentTool,
    loadHistory,
    isLoadingHistory,
    hasMoreHistory,
  } = useChatStream();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const lastMessageRef = useRef<ChatMessage | null>(null);

  useEffect(() => {
    loadHistory(0);
  }, [loadHistory]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (container.scrollTop < 100 && hasMoreHistory && !isLoadingHistory) {
      prevScrollHeightRef.current = container.scrollHeight;
      loadHistory(messages.length);
    }
  }, [hasMoreHistory, isLoadingHistory, messages.length, loadHistory]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const lastMessage = messages[messages.length - 1];
    const isNewMessage = lastMessage !== lastMessageRef.current;

    if (!isNewMessage && container && prevScrollHeightRef.current > 0) {
      const diff = container.scrollHeight - prevScrollHeightRef.current;
      if (diff > 0) {
        requestAnimationFrame(() => {
          container.scrollTop = diff;
        });
      }
      prevScrollHeightRef.current = 0;
    } else if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: isNewMessage ? "smooth" : "auto" });
    }

    lastMessageRef.current = lastMessage || null;
  }, [messages]);

  const visibleMessages = useMemo<ChatDisplayMessage[]>(() => {
    return messages.map((message, index) => ({
      ...message,
      id: `live-${index}-${message.timestamp}`,
    }));
  }, [messages]);

  const lastMessage = messages[messages.length - 1];
  const showConfirmButtons = Boolean(pendingConfirmation) && lastMessage?.role === "assistant" && !lastMessage.isStreaming;

  const userLabel = user?.name ? `${user.name} 님` : "송진호 님";
  const branchLabel = user?.branchName ?? "인천 아이미래로";
  const isInputDisabled = state === "streaming" || state === "connecting";

  return (
    <section className={styles.chatShell} data-component="mobile_chat_page" data-slot="chat-page">
      <header className={styles.existingNavbar} data-component="mobile_chat_page_header">
        <div className={styles.navbarIdentity} data-component="mobile_chat_page_header_identity">
          <span className={styles.navbarUser}>{userLabel}</span>
          <span className={styles.navbarBranch}>{branchLabel}</span>
        </div>
        <div className={styles.navbarIcons} data-component="mobile_chat_page_header_icons">
          <button
            className={styles.navbarIconBtn}
            type="button"
            onClick={clearSession}
            title="새 대화"
            aria-label="새 대화"
          >
            <SquarePen size={18} strokeWidth={2.5} />
          </button>
          <button className={styles.navbarIconBtn} type="button" aria-label="알림">
            <Bell size={18} strokeWidth={2} />
            <span className={styles.dot} />
          </button>
        </div>
      </header>

      <div className={styles.chatContent} data-component="mobile_chat_page_content">
        <div className={styles.chatScroll} ref={scrollContainerRef} data-component="mobile_chat_page_content_messages">
          {isLoadingHistory && messages.length > 0 && (
            <div className={styles.historySpinner} data-component="mobile_chat_page_content_messages_history-spinner">
              <Spinner size="sm" />
            </div>
          )}

          {visibleMessages.map((message) =>
            message.role === "user" ? (
              <UserMessage key={message.id} message={message} />
            ) : (
              <AssistantMessage key={message.id} message={message} />
            )
          )}

          {isToolExecuting && <ToolExecutingIndicator toolName={currentTool} />}

          {showConfirmButtons && (
            <div className={styles.confirmActions} data-component="mobile_chat_page_content_messages_confirm-actions">
              <Button type="button" size="sm" onClick={() => void confirmAction?.()} disabled={isInputDisabled}>
                확인
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => cancelAction?.()} disabled={isInputDisabled}>
                취소
              </Button>
            </div>
          )}

          <div ref={messagesEndRef} data-component="mobile_chat_page_content_messages_end" />
        </div>
      </div>

      <ChatComposer onSubmit={sendMessage} disabled={isInputDisabled} />
    </section>
  );
}
