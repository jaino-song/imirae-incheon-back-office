import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "Block";

interface BlockProps {
    "data-component"?: string;
    /** @deprecated Use the `data-component` prop. */
    name: string;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}

export function Block({
    "data-component": dataComponent,
    name,
    className,
    style,
    children,
}: BlockProps) {
    return (
        <div
            data-component={dataComponent ?? name}
            data-source-component={SOURCE_COMPONENT}
            className={cn(className)}
            style={style}
        >
            {children}
        </div>
    );
}
