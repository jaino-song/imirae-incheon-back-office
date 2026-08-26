"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AUTH_ROUTES } from "@/lib/auth/routes";
import { resetAuthorityState } from "@/lib/auth/authority-state";
import { exchangeToken } from "@/app/(auth)/callback/actions";
import { getSafeCallbackError } from "@/lib/auth/auth-errors";

type ExchangeTokenResult = Awaited<ReturnType<typeof exchangeToken>>;

const EXCHANGE_RESULT_CACHE_TTL_MS = 60_000;
const exchangeTokenPromises = new Map<string, Promise<ExchangeTokenResult>>();

function exchangeTokenOnce(code: string): Promise<ExchangeTokenResult> {
  const existingPromise = exchangeTokenPromises.get(code);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = exchangeToken(code).finally(() => {
    setTimeout(() => {
      exchangeTokenPromises.delete(code);
    }, EXCHANGE_RESULT_CACHE_TTL_MS);
  });

  exchangeTokenPromises.set(code, promise);
  return promise;
}

export function useCallbackPageController() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const exchangeCodeForTokens = async () => {
      const callbackError = searchParams.get("error");
      if (callbackError) {
        setError(getSafeCallbackError(callbackError));
        return;
      }

      const code = searchParams.get("code");

      if (!code) {
        console.error("[Auth Callback] No code in URL");
        if (!cancelled) {
          setError("Authorization Code Required");
        }
        return;
      }

      try {
        // OAuth callback may replace an already-authenticated browser
        // identity; clear its cache and drafts before accepting new tokens.
        await resetAuthorityState();
        // De-duping the single-use code is handled by exchangeTokenOnce's
        // module-level cache. A per-render ref guard must NOT be added here: under
        // React Strict Mode (dev) the effect runs twice, and a ref guard makes the
        // second (live) run bail while the first (cancelled) run drops its result,
        // leaving the page stuck on the loading spinner.
        const result = await exchangeTokenOnce(code);

        if (cancelled) {
          return;
        }

        if (!result.success) {
            console.error("[Auth Callback] Token exchange failed:", result.error);
            setError(result.error || "Authentication Failed");
            return;
        }

        if (result.onboardingRequired) {
          router.replace(result.onboardingRoute || "/kakao/onboarding");
          return;
        }

        if (result.requiresBranchSelection) {
          router.replace("/select-branch");
        } else {
          router.replace("/dashboard");
        }
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        console.error("[Auth Callback] Token Exchange Error:", requestError);
        console.error(
          "[Auth Callback] Error message:",
          requestError instanceof Error ? requestError.message : String(requestError),
        );
        setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
      }
    };

    void exchangeCodeForTokens();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return {
    error,
    status: error ? "error" : "loading",
    goToLogin: () => router.push(AUTH_ROUTES.login),
  };
}
