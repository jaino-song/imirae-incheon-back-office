import { cn } from "@/lib/utils";

interface BlockProps {
    name: string;
    "data-slot"?: string;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}

export function Block({
    name,
    "data-slot": dataSlot,
    className,
    style,
    children,
}: BlockProps) {
    return (
        <div data-component={name} data-slot={dataSlot} className={cn(className)} style={style}>
            {children}
        </div>
    );
}
