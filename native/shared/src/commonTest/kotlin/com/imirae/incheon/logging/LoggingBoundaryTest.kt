package com.imirae.incheon.logging

import com.imirae.incheon.network.privacySafeKtorLogger
import com.imirae.incheon.observability.CrashReporting
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LoggingBoundaryTest {
    @Test
    fun structuredEventsRedactRawMessagesAndSensitiveMetadata() {
        val lines = captureLogs {
            SafeLogger.info(
                eventType = "app.startup",
                message = "message body from a call for user@example.com",
                requestId = "request-123",
                result = "success",
                context = mapOf(
                    "authorization" to "Bearer super-secret-token",
                    "refresh_token" to "refresh-secret",
                    "cookie" to "session-cookie",
                    "apns_token" to "apns-secret",
                    "email" to "user@example.com",
                    "phone" to "010-1234-5678",
                    "address" to "1 Private Road",
                    "safe_reason" to "user-requested",
                    "recording_uri" to "content://private/call.m4a",
                ),
            )
        }

        assertEquals(1, lines.size)
        val line = lines.single()
        assertTrue(line.contains("event_type=\"app.startup\""))
        assertTrue(line.contains("level=\"info\""))
        assertTrue(line.contains("result=\"success\""))
        assertFalse(line.contains("message body from a call"))
        assertFalse(line.contains("user@example.com"))
        assertFalse(line.contains("010-1234-5678"))
        assertFalse(line.contains("refresh-secret"))
        assertFalse(line.contains("session-cookie"))
        assertFalse(line.contains("apns-secret"))
        assertFalse(line.contains("1 Private Road"))
        assertFalse(line.contains("super-secret-token"))
        assertFalse(line.contains("content://private/call.m4a"))
    }

    @Test
    fun dynamicEventNamesCannotBecomeUnstructuredLogData() {
        val lines = captureLogs {
            SafeLogger.warn(
                eventType = "Upload failed for user@example.com",
                message = "raw exception: token=secret",
            )
        }

        assertEquals(1, lines.size)
        assertTrue(lines.single().contains("event_type=\"unknown.event\""))
        assertFalse(lines.single().contains("Upload failed"))
        assertFalse(lines.single().contains("secret"))
    }

    @Test
    fun debugEventsStayLocalDevelopmentOnly() {
        val productionLines = captureLogs(SafeLogger.Environment.PROD) {
            SafeLogger.debug(eventType = "app.debug.probe")
        }
        assertTrue(productionLines.isEmpty())

        val developmentLines = captureLogs(SafeLogger.Environment.DEV) {
            SafeLogger.debug(eventType = "app.debug.probe")
        }
        assertEquals(1, developmentLines.size)
    }

    @Test
    fun crashReportingUsesTheStructuredBoundaryWithoutRawExceptionText() {
        val lines = captureLogs {
            CrashReporting.logError(
                tag = "Network Failure",
                message = "authorization=Bearer super-secret-token body=user@example.com",
                throwable = IllegalStateException("raw response body"),
            )
        }

        assertEquals(1, lines.size)
        assertTrue(lines.single().contains("level=\"error\""))
        assertFalse(lines.single().contains("super-secret-token"))
        assertFalse(lines.single().contains("user@example.com"))
        assertFalse(lines.single().contains("raw response body"))
    }

    @Test
    fun approvedIdentifiersAreStableOpaqueValues() {
        val lines = captureLogs {
            SafeLogger.info(
                eventType = "app.startup",
                requestId = "request-123",
                traceId = "trace-456",
            )
        }

        assertEquals(1, lines.size)
        assertFalse(lines.single().contains("request-123"))
        assertFalse(lines.single().contains("trace-456"))
        assertTrue(lines.single().contains("request_id=\"h_"))
        assertTrue(lines.single().contains("trace_id=\"h_"))
    }

    @Test
    fun ktorLoggerDropsTheFormattedHeaderAndPayloadMessage() {
        val lines = captureLogs {
            privacySafeKtorLogger().log(
                "REQUEST: https://api.example.test?email=user@example.com Authorization: Bearer super-secret-token body=private message",
            )
        }

        assertEquals(1, lines.size)
        assertTrue(lines.single().contains("event_type=\"network.request\""))
        assertFalse(lines.single().contains("Authorization"))
        assertFalse(lines.single().contains("super-secret-token"))
        assertFalse(lines.single().contains("user@example.com"))
        assertFalse(lines.single().contains("private message"))

        val productionLines = captureLogs(SafeLogger.Environment.PROD) {
            privacySafeKtorLogger().log("Authorization: Bearer production-secret")
        }
        assertTrue(productionLines.isEmpty())
    }

    @Test
    fun androidAndIosServicesHaveIndependentStructuredConfiguration() {
        val android = captureLogs(service = SafeLogger.Service.ANDROID_APP) {
            SafeLogger.info("app.startup")
        }
        val ios = captureLogs {
            SafeLogger.configureIos(debugBuild = true)
            SafeLogger.info("app.startup")
        }

        assertTrue(android.single().contains("service=\"android-app\""))
        assertTrue(ios.single().contains("service=\"ios-app\""))
    }

    @Test
    fun notificationEventsAreRegisteredAndDebugGated() {
        val lines = captureLogs {
            SafeLogger.apnsRegistered()
            SafeLogger.apnsRegistrationFailed()
            SafeLogger.notificationPermissionFailed()
            SafeLogger.notificationReceived()
            SafeLogger.notificationTapped()
        }

        assertEquals(5, lines.size)
        assertTrue(lines[0].contains("event_type=\"notification.apns.registered\""))
        assertTrue(lines[1].contains("event_type=\"notification.apns.registration.failed\""))
        assertTrue(lines[2].contains("event_type=\"notification.permission.failed\""))
        assertTrue(lines[3].contains("event_type=\"notification.apns.received\""))
        assertTrue(lines[4].contains("event_type=\"notification.apns.tapped\""))

        val productionLines = captureLogs(SafeLogger.Environment.PROD) {
            SafeLogger.configureIos(debugBuild = false)
            SafeLogger.apnsRegistered()
            SafeLogger.notificationReceived()
            SafeLogger.notificationTapped()
        }
        assertTrue(productionLines.isEmpty())
    }

    private fun captureLogs(
        environment: SafeLogger.Environment = SafeLogger.Environment.DEV,
        service: SafeLogger.Service = SafeLogger.Service.KMP_SHARED,
        block: () -> Unit,
    ): List<String> {
        val lines = mutableListOf<String>()
        SafeLogger.configureForTests(environment, service, lines::add)
        try {
            block()
        } finally {
            SafeLogger.resetForTests()
        }
        return lines
    }
}
