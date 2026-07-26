"use client";

import { Loader2 } from "lucide-react";
import { useServiceWorkerUpdate } from "@/hooks/useServiceWorkerUpdate";

export function ServiceWorkerUpdateOverlay() {
    const { isUpdating } = useServiceWorkerUpdate();

    if (!isUpdating) return null;

    return (
        <div data-component="mobile_shell_sw-update-overlay" className="fixed inset-0 bg-background/95 flex flex-col items-center justify-center z-[9999] gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-lg font-semibold text-foreground">
                앱 업데이트 중...
            </p>
            <p className="text-sm text-muted-foreground">
                잠시만 기다려 주세요
            </p>
        </div>
    );
}
