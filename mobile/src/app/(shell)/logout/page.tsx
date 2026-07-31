"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { logout } from "./actions";

export default function LogoutPage() {
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const performLogout = async () => {
            const result = await logout();

            if (result.success) {
                // Hard navigation: destroys the React Query cache and Next.js
                // Router Cache so the next account never sees this one's data.
                window.location.replace("/login");
            } else {
                setError(result.error || "로그아웃 중 오류가 발생했습니다.");
                // Still redirect to login after a short delay even on error
                setTimeout(() => {
                    window.location.replace("/login");
                }, 2000);
            }
        };

        performLogout();
    }, []);

    if (error) {
        return (
            <div data-component="mobile_logout_page" className="flex flex-col items-center justify-center h-screen gap-4">
                <p className="text-destructive">{error}</p>
                <p className="text-sm text-muted-foreground">
                    잠시 후 로그인 페이지로 이동합니다...
                </p>
            </div>
        );
    }

    return (
        <div data-component="mobile_logout_page" className="flex flex-col items-center justify-center h-screen gap-4">
            <Spinner size="lg" />
            <p className="text-foreground">로그아웃 중...</p>
        </div>
    );
}
