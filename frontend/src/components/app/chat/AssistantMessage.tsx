"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CodeBlock } from "./CodeBlock";
import { MarkdownContent } from "./MarkdownContent";
import { ToolIndicator } from "./tool-indicator";
import { MessageFeedback } from "./message-feedback";
import type { ChatMessage } from "@/hooks/useChatStream";
import ClientRegistrationWizard, { type CreatedClient } from "./ClientRegistrationWizard";
import ContractSendWizard from "./ContractSendWizard";
import ContractStatusWizard, { type ContractStatusResult } from "./ContractStatusWizard";

interface AssistantMessageProps {
    message: ChatMessage;
    messageIndex: number;
    sessionId: string | null;
    isToolExecuting?: boolean;
    currentTool?: string | null;
    onSubmitFeedback: (messageIndex: number, type: "positive" | "negative", comment?: string) => Promise<void>;
}

export function AssistantMessage({
    message,
    messageIndex,
    sessionId,
    isToolExecuting,
    currentTool,
    onSubmitFeedback
}: AssistantMessageProps) {
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
                        <div data-component="desktop_chat_page_wizard-registration-success" className="py-1">
                            산모 등록 완료: {createdClient.name} (ID: {createdClient.id})
                        </div>
                    );
                }
                return (
                    <ClientRegistrationWizard
                        initialDraft={message.ui?.registrationDraft}
                        onCreated={(client) => setCreatedClient(client)}
                    />
                );

            case "contractSendWizard":
                if (contractSendDone) {
                    return (
                        <div data-component="desktop_chat_page_wizard-contract-send-success" className="py-1">
                            계약서 전송이 완료되었습니다.
                        </div>
                    );
                }
                return (
                    <ContractSendWizard
                        onComplete={() => setContractSendDone(true)}
                    />
                );

            case "contractStatusWizard":
                if (contractStatus) {
                    return (
                        <div data-component="desktop_chat_page_wizard-contract-status-result" className="space-y-1 py-1">
                            <div>
                                계약서 상태: <strong>{String(contractStatus.documentStatus)}</strong>
                            </div>
                            <div className="text-sm text-muted-foreground">
                                산모: {contractStatus.clientName} (ID: {contractStatus.clientId})
                            </div>
                            {contractStatus.serviceStatus && (
                                <div className="text-sm text-muted-foreground">
                                    서비스 상태: {contractStatus.serviceStatus}
                                </div>
                            )}
                        </div>
                    );
                }
                return (
                    <ContractStatusWizard
                        onCheck={(result) => setContractStatus(result)}
                    />
                );

            default:
                return null;
        }
    }, [message.ui?.registrationDraft, wizardType, createdClient, contractSendDone, contractStatus]);

    return (
        <div data-component="desktop_chat_page_message-assistant" className="flex gap-4 mb-6 w-full">
            <Avatar className="w-8 h-8 shrink-0 mt-1">
                <AvatarImage src="/assets/icon-72.png" alt="AI" />
                <AvatarFallback>AI</AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
                {isToolExecuting && message.isStreaming && (
                    <ToolIndicator toolName={currentTool || null} isExecuting={true} />
                )}
                <MarkdownContent>
                    {wizardContent ? (
                        wizardContent
                    ) : (
                        <>
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code: ({ className, children, ...props }) => {
                                        const match = /language-(\w+)/.exec(className || "");
                                        const language = match ? match[1] : "";
                                        const codeString = String(children).replace(/\n$/, "");
                                        const isCodeBlock = Boolean(language);

                                        if (isCodeBlock) {
                                            return <CodeBlock language={language}>{codeString}</CodeBlock>;
                                        }

                                        return (
                                            <code className={className} {...props}>
                                                {children}
                                            </code>
                                        );
                                    },
                                    table: ({ children }) => (
                                        <div className="table-wrapper">
                                            <table>{children}</table>
                                        </div>
                                    ),
                                }}
                            >
                                {message.content}
                            </ReactMarkdown>

                            {message.isStreaming && (
                                <span className="inline-block w-2 h-4 bg-foreground ml-1 animate-blink" />
                            )}
                        </>
                    )}
                </MarkdownContent>
                {!wizardContent && !message.isStreaming && (
                    <MessageFeedback
                        messageId={String(messageIndex)}
                        sessionId={sessionId}
                        onSubmitFeedback={(type, comment) => onSubmitFeedback(messageIndex, type, comment)}
                    />
                )}
            </div>
        </div>
    );
}
