import { create } from "zustand";
import { MessageTemplate } from "@/lib/template/types";

interface TemplateStore {
    currentTemplate: MessageTemplate | null;
    setCurrentTemplate: (template: MessageTemplate | null) => void;

    variableValues: Record<string, string>;
    setVariableValue: (key: string, value: string) => void;
    setVariableValues: (values: Record<string, string>) => void;
    resetVariableValues: () => void;

    templates: MessageTemplate[];
    setTemplates: (templates: MessageTemplate[]) => void;
    isLoading: boolean;
    setIsLoading: (isLoading: boolean) => void;
    reset: () => void;
}

export const useTemplateStore = create<TemplateStore>((set) => ({
    currentTemplate: null,
    setCurrentTemplate: (template) => set({ currentTemplate: template }),

    variableValues: {},
    setVariableValue: (key, value) => 
        set((state) => ({ 
            variableValues: { ...state.variableValues, [key]: value } 
        })),
    setVariableValues: (values) => set({ variableValues: values }),
    resetVariableValues: () => set({ variableValues: {} }),

    templates: [],
    setTemplates: (templates) => set({ templates }),
    isLoading: false,
    setIsLoading: (isLoading) => set({ isLoading }),
    reset: () => set({
        currentTemplate: null,
        variableValues: {},
        templates: [],
        isLoading: false,
    }),
}));
