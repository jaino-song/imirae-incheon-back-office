# P0.2 — Push Notification Protocol Compatibility Report

## Current Web Implementation

### Protocol: Web Push (VAPID)
- The web app uses the **Web Push API** with VAPID (Voluntary Application Server Identification)
- Hook: `mobile/src/hooks/usePushNotification.ts`
- Subscribe endpoint: `mobile/src/app/api/notifications/subscribe/route.ts`
- VAPID key endpoint: `mobile/src/app/api/notifications/vapid-key/route.ts`

### Web Subscription Schema
```typescript
// Web Push subscription object
{
  endpoint: string,        // Push service URL (e.g., fcm.googleapis.com/...)
  keys: {
    p256dh: string,        // Client public key
    auth: string           // Auth secret
  }
}
```

### Backend Subscription Storage
The NestJS backend stores push subscriptions with the Web Push schema. The subscription entity likely contains:
- `userId`: Associated user
- `endpoint`: Push service endpoint URL
- `keys`: VAPID key pair (p256dh + auth)
- `createdAt`: Registration timestamp

## Mobile Requirements

### Android: Firebase Cloud Messaging (FCM)
- Registration token: Single string token per device
- Token format: ~163 character string
- Delivery: Firebase SDK handles background/foreground delivery
- Schema needed: `{ token: string, platform: 'android', deviceId: string }`

### iOS: Apple Push Notification Service (APNs)
- Device token: Hex string from APNs registration
- Delivery: UNUserNotificationCenter delegate
- Schema needed: `{ token: string, platform: 'ios', deviceId: string }`

## Compatibility Analysis

### ❌ Incompatible — Backend Changes Required

The current backend subscribe endpoint accepts **Web Push subscription objects** (endpoint + VAPID keys), NOT mobile device tokens (FCM/APNs tokens). These are fundamentally different protocols:

| Aspect | Web Push (VAPID) | Mobile (FCM/APNs) |
|--------|-----------------|-------------------|
| Token format | URL endpoint + key pair | Single string token |
| Delivery mechanism | Web Push protocol | FCM/APNs SDK |
| Server-side sending | `web-push` npm package | `firebase-admin` SDK |
| Token refresh | Browser manages | App must re-register |

### Required Backend Changes

#### CR-PUSH-01: Mobile Device Token Support
- **Priority**: High (blocking for push notifications)
- **Description**: Extend subscription endpoint to accept mobile device tokens
- **New schema**:
  ```typescript
  // Mobile subscription
  POST /notifications/subscribe
  {
    type: 'mobile',
    platform: 'android' | 'ios',
    token: string,          // FCM or APNs token
    deviceId: string,       // Unique device identifier
  }
  ```
- **Backend storage**: New entity or extended entity with `type` discriminator

#### CR-PUSH-02: Firebase Admin SDK Integration
- **Priority**: High (blocking for push delivery)
- **Description**: Install `firebase-admin` in NestJS backend for sending push to mobile devices
- **Implementation**: 
  - Add `firebase-admin` dependency
  - Initialize with service account credentials
  - Create `MobilePushService` alongside existing `WebPushService`
  - Route notifications based on subscription `type` field

#### CR-PUSH-03: Push Payload Standardization
- **Priority**: Medium
- **Description**: Standardize push notification payload for both web and mobile
- **Payload schema**:
  ```json
  {
    "title": "string",
    "body": "string",
    "data": {
      "type": "notification_type",
      "deepLink": "/clients/123",
      "notificationId": "uuid"
    }
  }
  ```

#### CR-PUSH-04: Token Refresh Handling
- **Priority**: Medium
- **Description**: Handle FCM/APNs token refresh (old token → new token update)
- **Endpoint**: `PUT /notifications/subscribe` or `PATCH /notifications/token`

## Firebase Admin SDK Status

### ⚠️ Needs Verification
- Check if `firebase-admin` is already installed in the NestJS backend `package.json`
- If not installed, it must be added for mobile push delivery
- Firebase project must be created (Phase 0.4) with service account credentials

## Risk Assessment

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| CR-PUSH-01/02 delayed | High — no push notifications on mobile | Use in-app polling as fallback; push is critical for engagement |
| CR-PUSH-03 delayed | Low | Use platform-specific payloads initially; standardize later |
| CR-PUSH-04 delayed | Medium | Tokens may become stale; users need to re-open app to refresh |
| Firebase not set up | High — blocking | Phase 0.4 must complete Firebase project setup |

## Conclusion

Push notifications require **backend changes** (CR-PUSH-01, CR-PUSH-02) before mobile push can work. These are **blocking** for the push notification feature but NOT blocking for the overall app (app can launch without push, adding it later).

The committed native clients therefore intentionally do **not** persist or
register FCM/APNs device tokens. Android still receives and displays FCM
messages, and iOS still handles APNs permission and receipt callbacks, but no
provider token is sent to the browser-only `/notifications/subscribe` endpoint.
Browser Web Push remains the only supported subscription path until the
CR-PUSH-01/02/04 architecture, provider credentials, and migration are
approved and implemented.

**Recommended approach**:
1. Phase 0.4: Set up Firebase project + service account
2. Backend team implements CR-PUSH-01 + CR-PUSH-02 in parallel with Phase 1-2
3. Mobile push integration (Phase 6.2) depends on backend readiness
4. Fallback: In-app notification polling if backend changes are delayed
