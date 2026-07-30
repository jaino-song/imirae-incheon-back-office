"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { eformsignApi } from "@/services/api";
import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";

interface UseEformsignAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
  authenticate: () => Promise<void>;
}

interface UseEformsignAuthOptions {
  syncOnWindowFocus?: boolean;
  requireAccessToken?: boolean;
}

// Cookie expiry buffer (re-authenticate 5 minutes before expiry)
const AUTH_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_EXPIRY_MS = 60 * 60 * 1000;

// Retry config: exponential backoff on transient failures (503, network errors)
const MAX_AUTH_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const PAGE_RELOAD_DELAY_MS = 5000;

let inFlightAuthentication: Promise<void> | null = null;

function getStoredAuthTime(): number {
  const authTimeStr = safeStorageGetItem("session", "eformsign_auth_time");
  return authTimeStr ? parseInt(authTimeStr, 10) : 0;
}

function hasFreshAuthTime(authTime: number): boolean {
  return authTime > 0 && Date.now() - authTime < TOKEN_EXPIRY_MS - AUTH_BUFFER_MS;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function authenticateOnce(memberEmail?: string): Promise<void> {
  if (!inFlightAuthentication) {
    const executionTime = Date.now();

    inFlightAuthentication = (async () => {
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= MAX_AUTH_RETRIES; attempt++) {
        try {
          await eformsignApi.authenticate(executionTime, memberEmail);
          safeStorageSetItem("session", "eformsign_auth_time", executionTime.toString());
          return;
        } catch (err) {
          lastError = err;

          if (attempt < MAX_AUTH_RETRIES) {
            const backoffMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            console.warn(
              `[eformsignAuth] Authentication attempt ${attempt + 1}/${MAX_AUTH_RETRIES + 1} failed, retrying in ${backoffMs}ms`
            );
            await delay(backoffMs);
          }
        }
      }

      throw lastError;
    })().finally(() => {
      inFlightAuthentication = null;
    });
  }

  await inFlightAuthentication;
}

/**
 * Hook to manage eformsign authentication
 * 
 * - Verifies server-side auth cookies before trusting the local auth timestamp
 * - Stores authentication timestamp in sessionStorage
 * - Auto re-authenticates when token is about to expire
 */
export function useEformsignAuth(
  {
    syncOnWindowFocus = true,
    requireAccessToken = true,
  }: UseEformsignAuthOptions = {}
): UseEformsignAuthReturn {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedulePageReload = useCallback(() => {
    if (reloadTimerRef.current) return;
    console.warn(
      `[useEformsignAuth] All auth retries exhausted, reloading page in ${PAGE_RELOAD_DELAY_MS / 1000}s`
    );
    reloadTimerRef.current = setTimeout(() => {
      window.location.reload();
    }, PAGE_RELOAD_DELAY_MS);
  }, []);

  const authenticate = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      await authenticateOnce();

      setIsAuthenticated(true);

      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    } catch (err) {
      console.error("[useEformsignAuth] Authentication failed:", err);
      safeStorageRemoveItem("session", "eformsign_auth_time");
      setError(err instanceof Error ? err : new Error("Authentication failed"));
      setIsAuthenticated(false);

      schedulePageReload();
    } finally {
      setIsLoading(false);
    }
  }, [schedulePageReload]);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }
    };
  }, []);

  const syncAuthentication = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (!requireAccessToken) {
        const authStatus = await eformsignApi.getAuthStatus();
        setIsAuthenticated(authStatus.hasAppAuthToken);
        return;
      }

      const authTime = getStoredAuthTime();
      if (!hasFreshAuthTime(authTime)) {
        await authenticate();
        return;
      }

      const authStatus = await eformsignApi.getAuthStatus();
      if (authStatus.hasAppAuthToken && authStatus.hasAccessToken) {
        setIsAuthenticated(true);
        return;
      }

      await authenticate();
    } catch (err) {
      console.error("[useEformsignAuth] Auth state validation failed:", err);
      safeStorageRemoveItem("session", "eformsign_auth_time");
      setError(err instanceof Error ? err : new Error("Failed to validate authentication"));
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, [authenticate, requireAccessToken]);

  useEffect(() => {
    void syncAuthentication();

    if (!syncOnWindowFocus) {
      return;
    }

    const handleFocus = () => {
      void syncAuthentication();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [syncAuthentication, syncOnWindowFocus]);

  useEffect(() => {
    if (!requireAccessToken || !isAuthenticated) return;

    const checkTokenExpiry = () => {
      const authTime = getStoredAuthTime();
      if (!hasFreshAuthTime(authTime)) {
        void authenticate();
      }
    };

    const interval = setInterval(checkTokenExpiry, 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated, authenticate, requireAccessToken]);

  return { isAuthenticated, isLoading, error, authenticate };
}
