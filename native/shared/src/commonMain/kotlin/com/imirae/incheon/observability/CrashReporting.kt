package com.imirae.incheon.observability

import com.imirae.incheon.auth.currentTimeMillis
import com.imirae.incheon.logging.SafeLogger

object CrashReporting {
    fun initialize(isDebug: Boolean) { if (isDebug) return }
    fun logError(tag: String, message: String, throwable: Throwable? = null) {
        // Keep the source-compatible arguments, but do not serialize free-form
        // messages or exception text. The external crash sink remains unconfigured.
        SafeLogger.error(
            eventType = "app.error",
            context = mapOf("reason_code" to tag),
            errorCode = "captured",
        )
    }
    fun setUserId(userId: String) {}
    fun clearUserId() {}
    fun recordMetric(name: String, value: Long) {}
}

object PerformanceTelemetry {
    private var appStartTime: Long = 0
    fun markAppStart() { appStartTime = currentTimeMillis() }
    fun markAppReady() {
        val startupTime = currentTimeMillis() - appStartTime
        CrashReporting.recordMetric("startup_time_ms", startupTime)
        if (startupTime > 2000) CrashReporting.logError("Performance", "Slow startup: ${startupTime}ms (target: <2000ms)")
    }
    fun recordFrameDrop(droppedFrames: Int) { if (droppedFrames > 5) CrashReporting.recordMetric("frame_drops", droppedFrames.toLong()) }
    fun recordNetworkError(endpoint: String, statusCode: Int) { CrashReporting.recordMetric("network_error_$statusCode", 1) }
}
