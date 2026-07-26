"use client";

import { useRouter } from "next/navigation";
import { ChatInput } from "./ChatInput";

export function ChatWidget() {
    const router = useRouter();

    const handleOpenChat = () => {
        router.push("/chat");
    };

    return (
        <div data-component="mobile_chat_widget" className="mt-6">
            <ChatInput
                data-component="mobile_chat_widget_input"
                onSubmit={handleOpenChat}
                onClick={handleOpenChat}
                placeholder="무엇을 도와드릴까요?"
                readOnly
            />
        </div>
    );
}
