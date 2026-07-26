"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FeedbackModal } from "./feedback-modal";

interface MessageFeedbackProps {
    /** Caller-context canonical value for this node. */
    "data-component": string;

    messageId: string;
    sessionId: string | null;
    onSubmitFeedback: (type: "positive" | "negative", comment?: string) => Promise<void>;
}

export function MessageFeedback({
    "data-component": dataComponent,
    messageId: _messageId,
    sessionId: _sessionId,
    onSubmitFeedback
}: MessageFeedbackProps) {
    const [feedbackGiven, setFeedbackGiven] = useState<"positive" | "negative" | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleThumbsUp = async () => {
        if (feedbackGiven || isSubmitting) return;
        setIsSubmitting(true);
        try {
            await onSubmitFeedback("positive");
            setFeedbackGiven("positive");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleThumbsDown = () => {
        if (feedbackGiven || isSubmitting) return;
        setModalOpen(true);
    };

    const handleModalSubmit = async (comment: string) => {
        setIsSubmitting(true);
        try {
            await onSubmitFeedback("negative", comment);
            setFeedbackGiven("negative");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <div
                data-component={dataComponent}
                data-testid="message-feedback"
                className={cn(
                    "flex gap-1 mt-2",
                    feedbackGiven && "opacity-50"
                )}
            >
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                data-testid="thumbs-up"
                                variant="ghost"
                                size="icon"
                                onClick={handleThumbsUp}
                                disabled={feedbackGiven !== null || isSubmitting}
                                className={cn(
                                    "h-8 w-8",
                                    feedbackGiven === "positive" ? "text-primary" : "text-muted-foreground"
                                )}
                            >
                                <ThumbsUp
                                    className="w-4 h-4"
                                    fill={feedbackGiven === "positive" ? "currentColor" : "none"}
                                />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            {feedbackGiven === "positive" ? "감사합니다!" : "도움이 됐어요"}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                data-testid="thumbs-down"
                                variant="ghost"
                                size="icon"
                                onClick={handleThumbsDown}
                                disabled={feedbackGiven !== null || isSubmitting}
                                className={cn(
                                    "h-8 w-8",
                                    feedbackGiven === "negative" ? "text-destructive" : "text-muted-foreground"
                                )}
                            >
                                <ThumbsDown
                                    className="w-4 h-4"
                                    fill={feedbackGiven === "negative" ? "currentColor" : "none"}
                                />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            {feedbackGiven === "negative" ? "피드백 감사합니다" : "개선이 필요해요"}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <FeedbackModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                onSubmit={handleModalSubmit}
            />
        </>
    );
}
