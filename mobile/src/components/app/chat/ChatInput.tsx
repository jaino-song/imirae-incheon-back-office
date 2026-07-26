"use client";

import { useState, KeyboardEvent, useRef } from "react";
import { Sparkles, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
    /** Caller-context canonical value for this node. */
    "data-component": string;

    onSubmit: (message: string) => void;
    onFocus?: () => void;
    onClick?: () => void;
    disabled?: boolean;
    placeholder?: string;
    readOnly?: boolean;
}

export function ChatInput({
    "data-component": dataComponent,
    onSubmit,
    onFocus,
    onClick,
    disabled = false,
    placeholder = "무엇을 도와드릴까요?",
    readOnly = false,
}: ChatInputProps) {
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = () => {
        const trimmed = value.trim();
        if (trimmed && !disabled) {
            onSubmit(trimmed);
            setValue("");
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div
            data-component={dataComponent}
            onClick={onClick}
            className={cn(
                "relative flex items-center gap-2 rounded-full",
                "border-2 !border-primary/50 bg-card p-2 pl-4",
                "transition-all duration-300",
                "focus-within:!border-primary focus-within:shadow-md",
                "opacity-0 animate-fade-in hover-glow",
                onClick && "cursor-pointer"
            )}
            style={{ animationDelay: "250ms" }}
        >
            <Sparkles className="h-5 w-5 text-navy shrink-0" />
            <Input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={onFocus}
                disabled={disabled}
                readOnly={readOnly}
                tabIndex={readOnly ? -1 : undefined}
                placeholder={placeholder}
                className={cn(
                    "flex-1 border-0 bg-transparent",
                    "text-foreground placeholder:text-muted-foreground",
                    "focus-visible:ring-0 focus-visible:ring-offset-0",
                    readOnly && "caret-transparent"
                )}
            />
            <Button
                variant="ghost"
                size="icon"
                onClick={handleSubmit}
                disabled={disabled || !value.trim()}
                className={cn(
                    "shrink-0 rounded-full h-10 w-10",
                    "!bg-navy text-primary-foreground",
                    "transition-all duration-200",
                    "hover:scale-110 hover:!bg-navy/90 active:scale-95",
                    "disabled:!opacity-100"
                )}
            >
                <Send className="h-4 w-4" />
            </Button>
        </div>
    );
}
