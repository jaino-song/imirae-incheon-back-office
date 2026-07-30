"use client";

import { useState, useEffect, useCallback } from "react";
import { eformsignApi } from "@/services/api";
import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";

interface UseEformsignAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
  authenticate: () => Promise<void>;
}

interface UseEformsignAuthOptions {
  requireAccessToken?: boolean;
}

// Cookie expiry buffer (re-authenticate 5 minutes before expiry)
const AUTH_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_EXPIRY_MS = 60 * 60 * 1000;

function getStoredAuthTime(): number {
  const authTimeStr = safeStorageGetItem("session", "eformsign_auth_time");
  return authTimeStr ? parseInt(authTimeStr, 10) : 0;
}

function hasFreshAuthTime(authTime: number): boolean {
  return authTime > 0 && Date.now() - authTime < TOKEN_EXPIRY_MS - AUTH_BUFFER_MS;
}

/**
 * Hook to manage eformsign authentication
 * 
 * - Verifies server-side auth cookies before trusting the local auth timestamp
 * - Stores authentication timestamp in sessionStorage
 * - Auto re-authenticates when token is about to expire
 */
export function useEformsignAuth(
  { requireAccessToken = true }: UseEformsignAuthOptions = {},
): UseEformsignAuthReturn {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const authenticate = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const executionTime = Date.now();
      await eformsignApi.authenticate(executionTime);
      
      // Store auth timestamp in sessionStorage
      safeStorageSetItem("session", "eformsign_auth_time", executionTime.toString());
      
      setIsAuthenticated(true);
    } catch (err) {
      console.error("[useEformsignAuth] Authentication failed:", err);
      safeStorageRemoveItem("session", "eformsign_auth_time");
      setError(err instanceof Error ? err : new Error("Authentication failed"));
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncAuthentication = async () => {
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
    };

    void syncAuthentication();

    const handleFocus = () => {
      void syncAuthentication();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [authenticate, requireAccessToken]);

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
