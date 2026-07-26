"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeBlockProps {
    /** Caller-context canonical value for this node. */
    "data-component": string;

    children: string;
    language?: string;
}

export function CodeBlock({ "data-component": dataComponent, children, language = "text" }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(children);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div data-component={dataComponent} className="relative my-4">
            <div className="flex justify-between items-center bg-zinc-800 px-4 py-1 rounded-t-2xl">
                <span className="text-xs text-zinc-400">
                    {language}
                </span>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleCopy}
                                className="h-6 w-6 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                            >
                                {copied ? (
                                    <Check className="w-4 h-4" />
                                ) : (
                                    <Copy className="w-4 h-4" />
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            {copied ? "Copied!" : "Copy code"}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            <SyntaxHighlighter
                language={language}
                style={oneDark}
                customStyle={{
                    margin: 0,
                    borderTopLeftRadius: 0,
                    borderTopRightRadius: 0,
                    borderBottomLeftRadius: 8,
                    borderBottomRightRadius: 8,
                }}
            >
                {children}
            </SyntaxHighlighter>
        </div>
    );
}
