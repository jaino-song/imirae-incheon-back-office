"use client";

import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    type RefObject,
} from "react";
import {
    EditorContent,
    Extension,
    Node,
    NodeViewWrapper,
    ReactNodeViewRenderer,
    mergeAttributes,
    useEditor,
    type NodeViewProps,
} from "@tiptap/react";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { History } from "@tiptap/extension-history";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Suggestion } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { MessageTemplateVariable } from "@babyjamjam/shared/types/message";
import { cn } from "@/lib/utils";
import { createVariableSuggestion } from "./variable-suggestion";

const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;

type InlineNodeJSON =
    | { type: "text"; text: string }
    | { type: "variable"; attrs: { key: string } }
    | { type: "hardBreak" };

interface DocJSON {
    type: "doc";
    content: [{ type: "paragraph"; content?: InlineNodeJSON[] }];
}

/**
 * Converts plain text into inline ProseMirror JSON nodes: `{{key}}` runs become
 * `variable` nodes, `\n` becomes `hardBreak` nodes, everything else stays `text`.
 * Exported for direct unit testing (round-trip + paste conversion) without
 * needing to mount the ProseMirror view.
 */
export function textToInlineNodesJSON(text: string): InlineNodeJSON[] {
    const content: InlineNodeJSON[] = [];

    const pushText = (segment: string) => {
        const lines = segment.split("\n");
        lines.forEach((line, index) => {
            if (index > 0) content.push({ type: "hardBreak" });
            if (line.length > 0) content.push({ type: "text", text: line });
        });
    };

    let lastIndex = 0;
    VARIABLE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VARIABLE_PATTERN.exec(text))) {
        if (match.index > lastIndex) {
            pushText(text.slice(lastIndex, match.index));
        }
        const key = match[1].trim();
        if (key) {
            content.push({ type: "variable", attrs: { key } });
        }
        lastIndex = VARIABLE_PATTERN.lastIndex;
    }
    if (lastIndex < text.length) {
        pushText(text.slice(lastIndex));
    }

    return content;
}

/** String -> ProseMirror doc JSON (single paragraph + hardBreak line breaks). */
export function valueToDocJSON(value: string): DocJSON {
    return {
        type: "doc",
        content: [{ type: "paragraph", content: textToInlineNodesJSON(value) }],
    };
}

/** ProseMirror doc JSON -> string. Inverse of {@link valueToDocJSON}. */
export function docJSONToValue(doc: DocJSON): string {
    const paragraph = doc.content[0];
    const nodes = paragraph?.content ?? [];
    return nodes
        .map((node) => {
            if (node.type === "text") return node.text;
            if (node.type === "variable") return `{{${node.attrs.key}}}`;
            if (node.type === "hardBreak") return "\n";
            return "";
        })
        .join("");
}

const EditorDocument = Document.extend({
    content: "paragraph",
});

const EditorHardBreak = HardBreak.extend({
    addKeyboardShortcuts() {
        return {
            ...this.parent?.(),
            Enter: () => this.editor.commands.setHardBreak(),
        };
    },
});

interface VariableNodeOptions {
    variablesRef: RefObject<MessageTemplateVariable[]>;
    onVariableClickRef: RefObject<((key: string) => void) | undefined>;
}

function VariableChipNodeView({ node, extension }: NodeViewProps) {
    const key = (node.attrs.key as string) ?? "";
    const options = extension.options as VariableNodeOptions;
    const variables = options.variablesRef.current ?? [];
    const label = variables.find((variable) => variable.key === key)?.label ?? key;

    return (
        <NodeViewWrapper as="span" className="inline" data-variable-key={key}>
            <span
                contentEditable={false}
                role="button"
                tabIndex={-1}
                onClick={() => options.onVariableClickRef.current?.(key)}
                className="mx-0.5 inline-flex items-center rounded-full bg-v3-primary-light px-2 py-0.5 text-xs font-semibold text-v3-primary"
            >
                {label}
            </span>
        </NodeViewWrapper>
    );
}

const VariableNode = Node.create<VariableNodeOptions>({
    name: "variable",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addOptions() {
        return {
            variablesRef: { current: [] },
            onVariableClickRef: { current: undefined },
        };
    },
    addAttributes() {
        return {
            key: {
                default: "",
                parseHTML: (element: HTMLElement) => element.getAttribute("data-key") ?? "",
                renderHTML: (attributes: { key: string }) => ({ "data-key": attributes.key }),
            },
        };
    },
    parseHTML() {
        return [{ tag: "span[data-type='variable']" }];
    },
    renderHTML({ HTMLAttributes, node }) {
        return ["span", mergeAttributes(HTMLAttributes, { "data-type": "variable" }), `{{${node.attrs.key}}}`];
    },
    addNodeView() {
        return ReactNodeViewRenderer(VariableChipNodeView);
    },
});

export interface VariableChipEditorHandle {
    insertVariable: (key: string) => void;
}

export interface VariableChipEditorProps {
    value: string;
    onChange: (next: string) => void;
    variables: MessageTemplateVariable[];
    onVariableClick?: (key: string) => void;
    placeholder?: string;
    id?: string;
}

export const VariableChipEditor = forwardRef<VariableChipEditorHandle, VariableChipEditorProps>(
    ({ value, onChange, variables, onVariableClick, placeholder, id }, ref) => {
        const variablesRef = useRef(variables);
        const onVariableClickRef = useRef(onVariableClick);
        const onChangeRef = useRef(onChange);
        const lastSerializedRef = useRef(value);

        useEffect(() => {
            variablesRef.current = variables;
        }, [variables]);
        useEffect(() => {
            onVariableClickRef.current = onVariableClick;
        }, [onVariableClick]);
        useEffect(() => {
            onChangeRef.current = onChange;
        }, [onChange]);

        // Extensions are created once; anything that can change over the
        // component's lifetime (variables, click handler) is read through a
        // ref at render time instead of being baked into the extension config.
        const extensions = useMemo(
            () => [
                EditorDocument,
                Paragraph,
                Text,
                History,
                EditorHardBreak,
                VariableNode.configure({ variablesRef, onVariableClickRef }),
                Extension.create({
                    name: "variableSuggestionTriggers",
                    addProseMirrorPlugins() {
                        return [
                            Suggestion({
                                editor: this.editor,
                                ...createVariableSuggestion({
                                    char: "{",
                                    pluginKey: new PluginKey("variableSuggestionBrace"),
                                    variablesRef,
                                }),
                            }),
                            Suggestion({
                                editor: this.editor,
                                ...createVariableSuggestion({
                                    char: "/",
                                    pluginKey: new PluginKey("variableSuggestionSlash"),
                                    variablesRef,
                                }),
                            }),
                        ];
                    },
                }),
            ],
            []
        );

        const editor = useEditor(
            {
                extensions,
                content: valueToDocJSON(value) as unknown as Record<string, unknown>,
                immediatelyRender: false,
                editorProps: {
                    attributes: {
                        ...(id ? { id } : {}),
                        class: cn(
                            "min-h-[240px] w-full rounded-[13px] border-[1.35px] border-input bg-white px-3.5 py-2 text-[0.8rem] font-[Pretendard] text-v3-dark shadow-none transition-all duration-200",
                            "focus-visible:border-v3-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-v3-primary/10 focus-visible:ring-offset-0 focus-visible:shadow-none"
                        ),
                    },
                    handlePaste: (view, event) => {
                        const text = event.clipboardData?.getData("text/plain");
                        if (!text) return false;

                        const nodes = textToInlineNodesJSON(text).map((json) => view.state.schema.nodeFromJSON(json));
                        const { tr } = view.state;
                        tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0));
                        view.dispatch(tr);
                        return true;
                    },
                },
                onUpdate: ({ editor: currentEditor }) => {
                    const next = docJSONToValue(currentEditor.getJSON() as unknown as DocJSON);
                    lastSerializedRef.current = next;
                    onChangeRef.current(next);
                },
            },
            []
        );

        // Controlled sync: only push external `value` changes into the doc when
        // they differ from the last string we ourselves produced, so our own
        // onUpdate -> parent onChange -> value prop round trip doesn't loop.
        useEffect(() => {
            if (!editor) return;
            if (value === lastSerializedRef.current) return;
            lastSerializedRef.current = value;
            editor.commands.setContent(valueToDocJSON(value) as unknown as Record<string, unknown>, {
                emitUpdate: false,
            });
        }, [value, editor]);

        useImperativeHandle(
            ref,
            () => ({
                insertVariable: (key: string) => {
                    if (!editor) return;
                    const { $from } = editor.state.selection;
                    const before = $from.nodeBefore;
                    const needsLeadingSpace = Boolean(before?.isText && before.text && !/\s$/.test(before.text));

                    const nodes: InlineNodeJSON[] = [];
                    if (needsLeadingSpace) nodes.push({ type: "text", text: " " });
                    nodes.push({ type: "variable", attrs: { key } });
                    nodes.push({ type: "text", text: " " });

                    editor.chain().focus().insertContent(nodes).run();
                },
            }),
            [editor]
        );

        const isEmpty = editor ? editor.isEmpty : value.length === 0;

        return (
            <div data-component="desktop_my-templates_chip-editor" className="relative">
                <EditorContent editor={editor} />
                {placeholder && isEmpty ? (
                    <span className="pointer-events-none absolute left-3.5 top-2 text-[0.8rem] font-[Pretendard] text-muted-foreground">
                        {placeholder}
                    </span>
                ) : null}
            </div>
        );
    }
);
VariableChipEditor.displayName = "VariableChipEditor";
