export interface TemplateVariable {
    key: string;
    type: "text" | "phone" | "select" | "date" | "number" | "textarea";
    label: string;
    placeholder?: string;
    required: boolean;
    optionType?: "custom" | "dataSource";
    options?: string[];
    dataSource?: string;
    fallback?: string;
    min?: number;
    max?: number;
}

export interface VariableValidationResult {
    valid: boolean;
    errors: string[];
}

interface CreateMessageTemplateProps {
    name: string;
    content: string;
    variables: TemplateVariable[];
}

interface UpdateMessageTemplateProps {
    name?: string;
    content?: string;
    variables?: TemplateVariable[];
}

export class MessageTemplateEntity {
    constructor(
        public readonly id: string,
        public name: string,
        public content: string,
        public variables: TemplateVariable[],
        public readonly createdAt: Date,
        public updatedAt: Date,
    ) {}

    update(props: UpdateMessageTemplateProps): void {
        if (props.name !== undefined) this.name = props.name;
        if (props.content !== undefined) this.content = props.content;
        if (props.variables !== undefined) this.variables = props.variables;
        this.updatedAt = new Date();
    }

    extractVariablesFromContent(): string[] {
        const regex = /\{\{([^}]+)\}\}/g;
        const matches = Array.from(this.content.matchAll(regex));
        return [...new Set(matches.map(m => m[1]?.trim() ?? "").filter(Boolean))];
    }

    validateVariables(): VariableValidationResult {
        const contentVars = this.extractVariablesFromContent();
        const definedKeys = new Set(this.variables.map(v => v.key));
        const errors: string[] = [];

        for (const varKey of contentVars) {
            if (!definedKeys.has(varKey)) {
                errors.push(`템플릿에 정의되지 않은 변수: {{${varKey}}}`);
            }
        }

        const contentVarsSet = new Set(contentVars);
        for (const variable of this.variables) {
            if (!contentVarsSet.has(variable.key)) {
                errors.push(`사용되지 않는 변수 정의: ${variable.key}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    getVariableCount(): number {
        return this.variables.length;
    }

    static create(props: CreateMessageTemplateProps): MessageTemplateEntity {
        const now = new Date();
        return new MessageTemplateEntity(
            "",
            props.name,
            props.content,
            props.variables,
            now,
            now,
        );
    }

    static reconstitute(
        id: string,
        name: string,
        content: string,
        variables: TemplateVariable[],
        createdAt: Date,
        updatedAt: Date,
    ): MessageTemplateEntity {
        return new MessageTemplateEntity(
            id,
            name,
            content,
            variables,
            createdAt,
            updatedAt,
        );
    }
}
