"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ReactRenderer } from "@tiptap/react";
import type { PluginKey } from "@tiptap/pm/state";
import type { SuggestionKeyDownProps, SuggestionOptions } from "@tiptap/suggestion";
import type { MessageTemplateVariable } from "@babyjamjam/shared/types/message";
import { cn } from "@/lib/utils";

export interface VariableSuggestionListHandle {
    onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface VariableSuggestionListProps {
    items: MessageTemplateVariable[];
    command: (item: MessageTemplateVariable) => void;
}

const VariableSuggestionList = forwardRef<VariableSuggestionListHandle, VariableSuggestionListProps>(
    ({ items, command }, ref) => {
        const [selectedIndex, setSelectedIndex] = useState(0);

        useEffect(() => {
            setSelectedIndex(0);
        }, [items]);

        const selectItem = (index: number) => {
            const item = items[index];
            if (item) command(item);
        };

        useImperativeHandle(
            ref,
            () => ({
                onKeyDown: ({ event }) => {
                    if (event.key === "ArrowDown") {
                        setSelectedIndex((prev) => (items.length ? (prev + 1) % items.length : 0));
                        return true;
                    }
                    if (event.key === "ArrowUp") {
                        setSelectedIndex((prev) => (items.length ? (prev + items.length - 1) % items.length : 0));
                        return true;
                    }
                    if (event.key === "Enter") {
                        selectItem(selectedIndex);
                        return true;
                    }
                    if (event.key === "Escape") {
                        return true;
                    }
                    return false;
                },
            }),
            // eslint-disable-next-line react-hooks/exhaustive-deps
            [items, selectedIndex]
        );

        return (
            <div
                data-component="desktop_my-templates_variable-suggestion"
                className="max-h-64 min-w-[200px] overflow-y-auto rounded-lg border border-v3-border bg-white p-1 shadow-[0_12px_36px_hsla(214,50%,20%,0.12)]"
            >
                {items.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-v3-text-muted">일치하는 변수가 없습니다</p>
                ) : (
                    items.map((item, index) => (
                        <button
                            key={item.key}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectItem(index)}
                            className={cn(
                                "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-v3-dark",
                                index === selectedIndex ? "bg-v3-dim-white" : "hover:bg-v3-dim-white"
                            )}
                        >
                            <span>{item.label}</span>
                            <span className="font-mono text-xs text-v3-text-muted">{`{{${item.key}}}`}</span>
                        </button>
                    ))
                )}
            </div>
        );
    }
);
VariableSuggestionList.displayName = "VariableSuggestionList";

interface CreateVariableSuggestionOptions {
    char: string;
    pluginKey: PluginKey;
    variablesRef: React.RefObject<MessageTemplateVariable[]>;
}

export function createVariableSuggestion({
    char,
    pluginKey,
    variablesRef,
}: CreateVariableSuggestionOptions): Omit<SuggestionOptions<MessageTemplateVariable>, "editor"> {
    return {
        char,
        pluginKey,
        allowSpaces: false,
        items: ({ query }) => {
            const normalized = query.trim().toLowerCase();
            const all = variablesRef.current ?? [];
            if (!normalized) return all;
            return all.filter(
                (variable) =>
                    variable.key.toLowerCase().includes(normalized) ||
                    variable.label.toLowerCase().includes(normalized)
            );
        },
        command: ({ editor, range, props }) => {
            editor
                .chain()
                .focus()
                .insertContentAt(range, [{ type: "variable", attrs: { key: props.key } }])
                .run();
        },
        render: () => {
            let component: ReactRenderer<VariableSuggestionListHandle, VariableSuggestionListProps> | null = null;
            let unmount: (() => void) | null = null;

            return {
                onStart: (props) => {
                    component = new ReactRenderer(VariableSuggestionList, {
                        props: { items: props.items, command: props.command },
                        editor: props.editor,
                    });
                    unmount = props.mount(component.element as HTMLElement);
                },
                onUpdate: (props) => {
                    component?.updateProps({ items: props.items, command: props.command });
                },
                onKeyDown: (props) => {
                    if (props.event.key === "Escape") {
                        unmount?.();
                        unmount = null;
                        return true;
                    }
                    return component?.ref?.onKeyDown(props) ?? false;
                },
                onExit: () => {
                    unmount?.();
                    component?.destroy();
                    component = null;
                    unmount = null;
                },
            };
        },
    };
}
