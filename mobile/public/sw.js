/**
 * Service Worker for PWA Push Notifications
 *
 * Handles:
 * - Push events (receiving notifications)
 * - Notification click events (opening URLs)
 * - Service worker lifecycle
 */

// Cache version - increment to force update
const CACHE_VERSION = 'v7';
const CACHE_NAME = `babyjamjam-admin-mobile-${CACHE_VERSION}`;

// Assets to precache during install
const PRECACHE_ASSETS = [
    '/manifest.json',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    '/assets/badge-72.png',
    '/apple-touch-icon.png',
    '/splash/splash-640x1136.png?v=20260812-logo-v2',
    '/splash/splash-750x1334.png?v=20260812-logo-v2',
    '/splash/splash-828x1792.png?v=20260812-logo-v2',
    '/splash/splash-1080x2340.png?v=20260812-logo-v2',
    '/splash/splash-1125x2436.png?v=20260812-logo-v2',
    '/splash/splash-1170x2532.png?v=20260812-logo-v2',
    '/splash/splash-1179x2556.png?v=20260812-logo-v2',
    '/splash/splash-1206x2622.png?v=20260812-logo-v2',
    '/splash/splash-1242x2208.png?v=20260812-logo-v2',
    '/splash/splash-1242x2688.png?v=20260812-logo-v2',
    '/splash/splash-1284x2778.png?v=20260812-logo-v2',
    '/splash/splash-1290x2796.png?v=20260812-logo-v2',
    '/splash/splash-1320x2868.png?v=20260812-logo-v2',
    '/splash/splash-1536x2048.png?v=20260812-logo-v2',
    '/splash/splash-1668x2224.png?v=20260812-logo-v2',
    '/splash/splash-1668x2388.png?v=20260812-logo-v2',
    '/splash/splash-2048x2732.png?v=20260812-logo-v2',
];

// Install event - precache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');
    event.waitUntil(
        Promise.all([
            caches.open(CACHE_NAME).then((cache) => {
                console.log('[SW] Precaching assets...');
                return cache.addAll(PRECACHE_ASSETS);
            }),
            // Activate updated SW immediately so fixes take effect without requiring a full browser restart.
            self.skipWaiting(),
        ])
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    // Old admin- and imirae-prefixed caches are still evicted post-rebrand.
                    .filter((name) => (name.startsWith('babyjamjam-admin-mobile-') || name.startsWith('babyjamjam-admin-') || name.startsWith('imirae-back-office-')) && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => {
            // Take control of all pages immediately
            return self.clients.claim();
        })
    );
});

/**
 * Fetch Event Handler
 *
 * Caches static assets using cache-first strategy.
 * Excludes API requests from caching.
 */
self.addEventListener('fetch', (event) => {
    const { request } = event;
    let url;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }

    if (request.method !== 'GET') return;
    // Only handle same-origin http(s) requests. This prevents errors like:
    // "Request scheme 'chrome-extension' is unsupported"
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;
    // Dev DX: don't cache in localhost dev, it can cause stale chunks/HMR issues.
    if (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1') return;
    // Avoid caching Next dev/hmr endpoints even outside localhost.
    if (url.pathname.startsWith('/_next/webpack-hmr')) return;
    // Only cache static assets; avoid caching HTML navigations or XHR/fetch calls.
    const cacheableDestinations = new Set(['style', 'script', 'image', 'font', 'manifest']);
    const cacheableByPath =
        url.pathname.startsWith('/assets/') ||
        url.pathname.startsWith('/splash/') ||
        url.pathname === '/manifest.json' ||
        url.pathname === '/apple-touch-icon.png';
    if (!cacheableDestinations.has(request.destination) && !cacheableByPath) return;

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                event.waitUntil(
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache)).catch(() => {
                        // Ignore cache write errors (e.g. unsupported schemes, quota, etc.)
                    })
                );
                return networkResponse;
            });
        })
    );
});

/**
 * Push Event Handler
 *
 * Receives push messages from the server and displays notifications.
 * Payload format: { title, body, icon, badge, data: { url } }
 */
self.addEventListener('push', (event) => {
    console.log('[SW] Push event received');

    if (!event.data) {
        console.warn('[SW] Push event has no data');
        return;
    }

    let payload;
    try {
        payload = event.data.json();
    } catch (e) {
        console.error('[SW] Failed to parse push payload:', e);
        payload = {
            title: '새 알림',
            body: event.data.text(),
        };
    }

    const options = {
        body: payload.body || '',
        icon: payload.icon || '/assets/icon-192.png',
        badge: payload.badge || '/assets/badge-72.png',
        vibrate: [100, 50, 100], // Vibration pattern
        data: payload.data || {},
        actions: payload.actions || [],
        tag: payload.tag || 'default', // Group notifications
        renotify: true, // Vibrate even if tag matches
        requireInteraction: false, // Auto-dismiss after a while
    };

    event.waitUntil(
        self.registration.showNotification(payload.title || '알림', options)
    );
});

/**
 * Notification Click Handler
 *
 * Opens the URL specified in notification data, or focuses existing window.
 */
function resolveNotificationUrl(url) {
    if (!url) return '/';

    try {
        const parsedUrl = new URL(url, self.location.origin);
        if (parsedUrl.origin === self.location.origin && parsedUrl.pathname === '/clients/filtered') {
            parsedUrl.pathname = '/clients';
            return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
        }
    } catch {
        // Preserve the original URL when notification data is not a valid URL.
    }

    return url;
}

self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked');

    event.notification.close();

    const urlToOpen = resolveNotificationUrl(event.notification.data?.url);

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Check if there's already a window open
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    // Navigate existing window to the URL
                    client.navigate(urlToOpen);
                    return client.focus();
                }
            }
            // Open new window if none exists
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

/**
 * Notification Close Handler
 *
 * Track when user dismisses notification (for analytics).
 */
self.addEventListener('notificationclose', (event) => {
    console.log('[SW] Notification dismissed');
    // Could send analytics event here
});

/**
 * Message Handler
 *
 * Handles messages from the main thread (e.g., skip waiting).
 */
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
