import { cn } from "@/lib/utils";
import { QuickActionItem, QuickActionColor, DEFAULT_QUICK_ACTION_COLORS, QuickActionButton } from "./QuickActionButton";

interface QuickActionsProps {
    /** Caller-context canonical base for the section root. */
    "data-component"?: string;
    /** Items to display in the grid */
    shortcuts: QuickActionItem[];
    /** Section title. Pass `null` to hide. */
    title?: string | null;
    /** Colour palette — cycles through the array */
    colors?: readonly QuickActionColor[];
    /** Number of grid columns (default: 4) */
    columns?: number;
    /** Base delay (seconds) before the pop-up animation starts */
    animationBaseDelay?: number;
    /** Stagger increment (seconds) between each item */
    animationStagger?: number;
    /** Extra class names on the outer `<section>` */
    className?: string;
}

export function QuickActions({
    "data-component": dataComponent,
    shortcuts,
    title = "바로가기",
    colors = DEFAULT_QUICK_ACTION_COLORS,
    animationBaseDelay = 0.2,
    animationStagger = 0.06,
    className,
}: QuickActionsProps) {
    return (
        <section data-component={dataComponent} data-slot="quick-actions" className={cn("space-y-3", className)}>
            <h2 className="px-1 text-lg font-extrabold tracking-tight text-v3-dark">
                {title}
            </h2>
            <div
                className="flex gap-3"
            >
                {shortcuts.map((s, idx) => (
                    <QuickActionButton
                        data-component={dataComponent ? `${dataComponent}_item-${idx + 1}` : undefined}
                        key={s.href}
                        href={s.href}
                        label={s.label}
                        icon={s.icon}
                        color={colors[idx % colors.length]}
                        animationDelay={animationBaseDelay + idx * animationStagger}
                    />
                ))}
            </div>
        </section>
    );
}
