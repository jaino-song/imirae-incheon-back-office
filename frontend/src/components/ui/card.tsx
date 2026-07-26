import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

type DataComponentProps = {
  "data-component"?: string
}

type CardSourceComponent = "Card" | "SurfaceCard"

const CARD_SOURCE_COMPONENT = "Card"
const CARD_HEADER_SOURCE_COMPONENT = "CardHeader"
const CARD_TITLE_SOURCE_COMPONENT = "CardTitle"
const CARD_CONTENT_SOURCE_COMPONENT = "CardContent"

const cardVariants = cva(
  "rounded-lg border bg-card text-card-foreground shadow-sm",
  {
    variants: {
      variant: {
        default: "",
        v3: "rounded-[24px] border-none bg-white shadow-[0_4px_24px_hsla(214,50%,20%,0.06)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type CardProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardVariants> &
  DataComponentProps & {
    /** @internal Zero-DOM wrapper ownership only. */
    sourceComponent?: CardSourceComponent
  }

const Card = React.forwardRef<
  HTMLDivElement,
  CardProps
>(({ className, variant, sourceComponent = CARD_SOURCE_COMPONENT, "data-component": dataComponent, ...props }, ref) => (
  <div
    ref={ref}
    {...props}
    data-component={dataComponent}
    data-source-component={sourceComponent}
    className={cn(cardVariants({ variant, className }))}
  />
))
Card.displayName = "Card"

const cardHeaderVariants = cva("flex flex-col p-6", {
  variants: {
    variant: {
      default: "",
      v3: "border-b border-border px-6 py-5",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardHeaderVariants> & DataComponentProps
>(({ className, variant, "data-component": dataComponent, ...props }, ref) => (
  <div
    ref={ref}
    {...props}
    data-component={dataComponent}
    data-source-component={CARD_HEADER_SOURCE_COMPONENT}
    className={cn(cardHeaderVariants({ variant, className }))}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement> & DataComponentProps
>(
  ({ className, "data-component": dataComponent, ...props }, ref) => (
    <h3
      ref={ref}
      {...props}
      data-component={dataComponent}
      data-source-component={CARD_TITLE_SOURCE_COMPONENT}
      className={cn("text-2xl font-semibold leading-none tracking-tight", className)}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & DataComponentProps
>(
  ({ className, "data-component": dataComponent, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      data-component={dataComponent}
      data-source-component={CARD_CONTENT_SOURCE_COMPONENT}
      className={cn("p-6 pt-0", className)}
    />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants };
