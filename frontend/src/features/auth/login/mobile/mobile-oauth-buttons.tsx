"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function KakaoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-5 w-5", className)}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3C6.486 3 2 6.481 2 10.795c0 2.747 1.82 5.158 4.566 6.55-.157.55-1 3.531-1.033 3.768 0 0-.021.181.096.249a.327.327 0 0 0 .259.014c.331-.047 3.821-2.502 4.426-2.926.553.08 1.119.122 1.686.122 5.514 0 10-3.481 10-7.795S17.514 3 12 3z" />
    </svg>
  );
}

interface MobileOAuthButtonsProps {
  kakaoButton: {
    title: string;
    onClick: () => void;
    disabled?: boolean;
  };
  className?: string;
}

export function MobileOAuthButtons({
  kakaoButton,
  className,
}: MobileOAuthButtonsProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Button
        data-component="desktop_auth_login_kakao-button"
        type="button"
        variant="kakao"
        size="lg"
        className="w-full rounded-2xl"
        onClick={kakaoButton.onClick}
        disabled={kakaoButton.disabled}
      >
        <KakaoIcon />
        {kakaoButton.title}
      </Button>
    </div>
  );
}
