"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { PWA_NOTIFICATIONS_ENABLED } from "@/lib/notification-config";

// Types
export interface PushNotificationState {
    isSupported: boolean;
    isSubscribed: boolean;
    permission: NotificationPermission;
    isLoading: boolean;
    error: string | null;
}

export interface Notification {
    id: number;
    title: string;
    body: string;
    data: Record<string, unknown> | null;
    sentAt: string;
    readAt: string | null;
    isRead: boolean;
}

// Query Keys
export const NOTIFICATION_KEYS = {
    all: ['notifications'] as const,
    list: (userId: string) => [...NOTIFICATION_KEYS.all, 'list', userId] as const,
    unreadCount: (userId: string) => [...NOTIFICATION_KEYS.all, 'unread', userId] as const,
    vapidKey: ['vapidKey'] as const,
};

// API Functions
const fetchVapidKey = async (): Promise<string> => {
    const { data } = await api.get<{ publicKey: string }>('/notifications/vapid-key');
    if (!data.publicKey) {
        throw new Error('VAPID public key not available');
    }
    return data.publicKey;
};

const fetchNotifications = async (limit = 50, offset = 0): Promise<Notification[]> => {
    try {
        const { data } = await api.get<Notification[]>('/notifications', {
            params: { limit, offset },
        });
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('[Notifications] Failed to fetch:', error);
        return [];
    }
};

const fetchUnreadCount = async (): Promise<number> => {
    try {
        const { data } = await api.get<{ count: number }>('/notifications/unread/count');
        return data?.count ?? 0;
    } catch (error) {
        console.error('[Notifications] Failed to fetch unread count:', error);
        return 0;
    }
};

const subscribePush = async (subscription: PushSubscription): Promise<void> => {
    const key = subscription.getKey('p256dh');
    const auth = subscription.getKey('auth');

    if (!key || !auth) {
        throw new Error('Push subscription keys not available');
    }

    await api.post('/notifications/subscribe', {
        endpoint: subscription.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
        auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
        userAgent: navigator.userAgent,
    });
};

const unsubscribePush = async (endpoint: string): Promise<void> => {
    await api.post('/notifications/unsubscribe', { endpoint });
};

const markAsReadApi = async (id: number): Promise<Notification> => {
    const { data } = await api.patch<Notification>(`/notifications/${id}/read`);
    return data;
};

const markAllAsReadApi = async (): Promise<void> => {
    await api.patch('/notifications/read-all');
};

/**
 * Convert VAPID public key from base64 to Uint8Array
 * Required format for PushManager.subscribe()
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

/**
 * Hook to get VAPID public key
 */
export function useVapidKey(enabled = true) {
    return useQuery({
        queryKey: NOTIFICATION_KEYS.vapidKey,
        queryFn: fetchVapidKey,
        staleTime: Infinity, // VAPID key doesn't change
        gcTime: Infinity,
        enabled,
    });
}

/**
 * Hook to get notifications list
 */
export function useNotifications(limit = 50, offset = 0, enabled = true) {
    return useQuery({
        queryKey: [...NOTIFICATION_KEYS.all, 'list', { limit, offset }],
        queryFn: () => fetchNotifications(limit, offset),
        staleTime: 1000 * 60, // 1 minute
        enabled,
    });
}

/**
 * Hook to get unread notification count
 */
export function useUnreadCount(enabled = true) {
    return useQuery({
        queryKey: [...NOTIFICATION_KEYS.all, 'unread'],
        queryFn: fetchUnreadCount,
        staleTime: 1000 * 30, // 30 seconds
        refetchInterval: enabled ? 1000 * 60 : false, // Only poll when enabled
        enabled,
    });
}

/**
 * Hook to mark notification as read
 */
export function useMarkAsRead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: markAsReadApi,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
        },
    });
}

/**
 * Hook to mark all notifications as read
 */
export function useMarkAllAsRead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: markAllAsReadApi,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
        },
    });
}

/**
 * Main hook for PWA Push Notification management
 *
 * Handles:
 * - Service Worker registration
 * - Push subscription
 * - Permission requests
 * - Subscription state management
 */
export function usePushNotification() {
    const [state, setState] = useState<PushNotificationState>({
        isSupported: false,
        isSubscribed: false,
        permission: 'default',
        isLoading: PWA_NOTIFICATIONS_ENABLED,
        error: null,
    });

    const { data: vapidKey } = useVapidKey(PWA_NOTIFICATIONS_ENABLED);

    // Check if push notifications are supported
    useEffect(() => {
        if (!PWA_NOTIFICATIONS_ENABLED) {
            setState({
                isSupported: false,
                isSubscribed: false,
                permission: 'denied',
                isLoading: false,
                error: null,
            });
            return;
        }

        const isSupported =
            typeof window !== 'undefined' &&
            'serviceWorker' in navigator &&
            'PushManager' in window &&
            'Notification' in window;

        setState((prev) => ({
            ...prev,
            isSupported,
            permission: isSupported ? Notification.permission : 'denied',
        }));
    }, []);

    // Check current subscription status
    useEffect(() => {
        if (!state.isSupported) {
            setState((prev) => ({ ...prev, isLoading: false }));
            return;
        }

        const checkSubscription = async () => {
            try {
                const registration = await navigator.serviceWorker.ready;
                const subscription = await registration.pushManager.getSubscription();
                setState((prev) => ({
                    ...prev,
                    isSubscribed: !!subscription,
                    isLoading: false,
                }));
            } catch (err) {
                console.error('[Push] Failed to check subscription:', err);
                setState((prev) => ({
                    ...prev,
                    isLoading: false,
                    error: 'Failed to check subscription status',
                }));
            }
        };

        checkSubscription();
    }, [state.isSupported]);

    // Register Service Worker
    const registerServiceWorker = useCallback(async () => {
        if (!PWA_NOTIFICATIONS_ENABLED || !state.isSupported) return null;

        try {
            const registration = await navigator.serviceWorker.register('/sw.js', {
                scope: '/',
            });
            console.log('[Push] Service Worker registered:', registration.scope);
            return registration;
        } catch (err) {
            console.error('[Push] Service Worker registration failed:', err);
            throw err;
        }
    }, [state.isSupported]);

    // Subscribe to push notifications
    const subscribe = useCallback(async () => {
        if (!PWA_NOTIFICATIONS_ENABLED) return false;

        if (!state.isSupported || !vapidKey) {
            setState((prev) => ({ ...prev, error: 'Push notifications not supported' }));
            return false;
        }

        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        try {
            // Request permission
            const permission = await Notification.requestPermission();
            setState((prev) => ({ ...prev, permission }));

            if (permission !== 'granted') {
                setState((prev) => ({
                    ...prev,
                    isLoading: false,
                    error: 'Notification permission denied',
                }));
                return false;
            }

            // Register service worker
            await registerServiceWorker();
            const registration = await navigator.serviceWorker.ready;

            // Subscribe to push
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey),
            });

            // Send subscription to server
            await subscribePush(subscription);

            setState((prev) => ({
                ...prev,
                isSubscribed: true,
                isLoading: false,
            }));

            console.log('[Push] Successfully subscribed');
            return true;
        } catch (err) {
            console.error('[Push] Subscription failed:', err);
            setState((prev) => ({
                ...prev,
                isLoading: false,
                error: err instanceof Error ? err.message : 'Subscription failed',
            }));
            return false;
        }
    }, [state.isSupported, vapidKey, registerServiceWorker]);

    // Unsubscribe from push notifications
    const unsubscribe = useCallback(async () => {
        if (!PWA_NOTIFICATIONS_ENABLED) return false;

        if (!state.isSupported) return false;

        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();

            if (subscription) {
                // Unsubscribe from server
                await unsubscribePush(subscription.endpoint);
                // Unsubscribe from browser
                await subscription.unsubscribe();
            }

            setState((prev) => ({
                ...prev,
                isSubscribed: false,
                isLoading: false,
            }));

            console.log('[Push] Successfully unsubscribed');
            return true;
        } catch (err) {
            console.error('[Push] Unsubscription failed:', err);
            setState((prev) => ({
                ...prev,
                isLoading: false,
                error: err instanceof Error ? err.message : 'Unsubscription failed',
            }));
            return false;
        }
    }, [state.isSupported]);

    return {
        ...state,
        subscribe,
        unsubscribe,
    };
}
