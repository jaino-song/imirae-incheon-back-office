import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FooterNavigationProps {
  positionLabel?: React.ReactNode;
  onPrev: () => void;
  onNext: () => void;
  nextContent?: React.ReactNode;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevHidden?: boolean;
  prevLabel?: string;
  nextLabel?: string;
  prevVariant?: ButtonProps["variant"];
  nextVariant?: ButtonProps["variant"];
  prevSize?: ButtonProps["size"];
  nextSize?: ButtonProps["size"];
  prevWidth?: ButtonProps["width"];
  nextWidth?: ButtonProps["width"];
  className?: string;
  prevClassName?: string;
  nextClassName?: string;
  positionClassName?: string;
  stickyOnMobile?: boolean;
  dataComponent?: string;
  prevDataComponent?: string;
  nextDataComponent?: string;
  positionDataComponent?: string;
}

export function FooterNavigation({
  positionLabel,
  onPrev,
  onNext,
  nextContent,
  prevDisabled = false,
  nextDisabled = false,
  prevHidden = false,
  prevLabel = "이전",
  nextLabel = "다음",
  prevVariant = "outline",
  nextVariant = "outline",
  prevSize = "sm",
  nextSize = "sm",
  prevWidth,
  nextWidth,
  className,
  prevClassName,
  nextClassName,
  positionClassName,
  stickyOnMobile = false,
  dataComponent = "desktop_v3_footer-navigation",
  prevDataComponent = "desktop_v3_footer-navigation_prev",
  nextDataComponent = "desktop_v3_footer-navigation_next",
  positionDataComponent = "desktop_v3_footer-navigation_position",
}: FooterNavigationProps) {
  const hasPositionLabel = positionLabel != null;

  return (
    <div
      data-component={dataComponent}
      className={cn(
        "mt-auto items-center gap-3 border-t border-v3-border pt-3",
        hasPositionLabel ? "grid grid-cols-[1fr_auto_1fr]" : "flex justify-between",
        stickyOnMobile &&
          "sticky bottom-0 bg-white rounded-b-[28px] shadow-[0_-4px_20px_hsla(214,50%,20%,0.06)]",
        className,
      )}
    >
      <Button
        data-component={prevDataComponent}
        type="button"
        variant={prevVariant}
        size={prevSize}
        width={prevWidth}
        onClick={onPrev}
        disabled={prevDisabled}
        className={cn(prevHidden && "pointer-events-none opacity-0", prevClassName)}
      >
        {prevLabel}
      </Button>

      {hasPositionLabel ? (
        <div
          data-component={positionDataComponent}
          className={cn(
            "justify-self-center text-[0.72rem] font-semibold text-v3-text-muted md:text-[0.77rem]",
            positionClassName,
          )}
        >
          {positionLabel}
        </div>
      ) : null}

      <Button
        data-component={nextDataComponent}
        type="button"
        variant={nextVariant}
        size={nextSize}
        width={nextWidth}
        onClick={onNext}
        disabled={nextDisabled}
        className={cn(nextClassName)}
      >
        {nextContent ?? nextLabel}
      </Button>
    </div>
  );
}
