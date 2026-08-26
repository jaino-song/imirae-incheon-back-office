package com.imirae.incheon.logging

import com.imirae.incheon.auth.currentTimeMillis
import kotlin.concurrent.Volatile

internal expect fun platformLog(level: SafeLogger.Level, message: String)

/**
 * The only application logging boundary for the shared native code.
 *
 * This logger deliberately emits a small, structured local record. It does not
 * forward records to a telemetry provider and it never includes free-form
 * messages, exception text, request headers, or payloads.
 */
object SafeLogger {
    enum class Level(val value: String) {
        DEBUG("debug"), INFO("info"), WARN("warn"), ERROR("error"), SECURITY("security")
    }

    enum class Service(val value: String) {
        ANDROID_APP("android-app"), IOS_APP("ios-app"), KMP_SHARED("kmp-shared")
    }

    enum class Environment(val value: String) {
        DEV("dev"), STAGE("stage"), PROD("prod")
    }

    private enum class RedactionKind { TOKEN, PII, RECORDING, NONE }

    private const val REDACTED_TOKEN = "[REDACTED_TOKEN]"
    private const val REDACTED_PII = "[REDACTED_PII]"
    private const val REDACTED_RECORDING = "[REDACTED_RECORDING_METADATA]"
    private const val REDACTED_VALUE = "[REDACTED]"
    private const val UNKNOWN_EVENT = "unknown.event"

    private val tokenKeyHints = listOf(
        "token", "authorization", "password", "passwd", "otp", "secret",
        "api_key", "apikey", "credential", "cookie",
    )
    private val piiKeyHints = listOf("email", "phone", "address", "birth", "dob", "name")
    private val recordingKeyHints = listOf(
        "recording", "audio", "voice", "uri", "path", "file", "duration", "size", "checksum", "mime",
    )
    private val eventTypeRegex = Regex("[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*)*")
    private val contextKeyRegex = Regex("[a-z][a-z0-9_]{0,63}")
    private val safeCodeRegex = Regex("[a-z][a-z0-9_.-]{0,63}")
    private val safeIdentifierRegex = Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
    private val emailRegex = Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}")
    private val phoneRegex = Regex("\\b(?:\\+?\\d{1,3}[\\s-]?)?(?:\\d{2,3}[\\s-]?)?\\d{3,4}[\\s-]?\\d{4}\\b")
    private val bearerTokenRegex = Regex("(?i)bearer\\s+[A-Za-z0-9._\\-+/=]+")
    private val jwtRegex = Regex("\\beyJ[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+\\b")
    private val tokenAssignmentRegex = Regex("(?i)(access_token|refresh_token|id_token|token|authorization|api[_-]?key|secret|password|passwd|otp)\\s*[:=]\\s*([^,;\\s]+)")

    private val hashedIdentifierKeys = setOf(
        "actor_hash", "actor_id_hash", "device_hash", "device_id_hash", "org_hash", "org_id_hash",
    )
    private val identifierKeys = setOf("request_id", "trace_id")
    private val safeCodeKeys = setOf("entry_point", "reason_code", "session_scope", "operation", "source", "network", "http_method")
    private val scalarKeys = setOf("koin_started", "attempt", "retry_count", "status_code", "duration_ms", "count")
    private val registeredEventTypes = setOf(
        "app.startup",
        "app.error",
        "network.request",
        "notification.apns.registered",
        "notification.apns.registration.failed",
        "notification.apns.received",
        "notification.apns.tapped",
        "notification.permission.failed",
    )

    // Production is the fail-closed default for iOS, which configures later than Android.
    @Volatile private var currentEnvironment = Environment.PROD
    @Volatile private var currentService = Service.KMP_SHARED
    @Volatile private var testSink: ((String) -> Unit)? = null

    fun configure(environment: Environment, service: Service = currentService) {
        currentEnvironment = environment
        currentService = service
    }

    fun debug(
        eventType: String,
        message: String? = null,
        context: Map<String, Any?> = emptyMap(),
        requestId: String? = null,
        traceId: String? = null,
        result: String? = null,
        errorCode: String? = null,
    ) = log(Level.DEBUG, eventType, message, context, requestId, traceId, result, errorCode)

    fun info(
        eventType: String,
        message: String? = null,
        context: Map<String, Any?> = emptyMap(),
        requestId: String? = null,
        traceId: String? = null,
        result: String? = null,
        errorCode: String? = null,
    ) = log(Level.INFO, eventType, message, context, requestId, traceId, result, errorCode)

    fun warn(
        eventType: String,
        message: String? = null,
        context: Map<String, Any?> = emptyMap(),
        requestId: String? = null,
        traceId: String? = null,
        result: String? = null,
        errorCode: String? = null,
    ) = log(Level.WARN, eventType, message, context, requestId, traceId, result, errorCode)

    fun error(
        eventType: String,
        message: String? = null,
        context: Map<String, Any?> = emptyMap(),
        requestId: String? = null,
        traceId: String? = null,
        result: String? = null,
        errorCode: String? = null,
    ) = log(Level.ERROR, eventType, message, context, requestId, traceId, result, errorCode)

    fun security(
        eventType: String,
        message: String? = null,
        context: Map<String, Any?> = emptyMap(),
        requestId: String? = null,
        traceId: String? = null,
        result: String? = null,
        errorCode: String? = null,
    ) = log(Level.SECURITY, eventType, message, context, requestId, traceId, result, errorCode)

    // Small no-data convenience calls keep platform delegates on this same
    // boundary without exposing Kotlin collection bridging to Swift callers.
    fun apnsRegistered() = debug("notification.apns.registered")
    fun apnsRegistrationFailed() = error("notification.apns.registration.failed", errorCode = "registration_failed")
    fun notificationPermissionFailed() = warn("notification.permission.failed", errorCode = "permission_request_failed")
    fun notificationReceived() = debug("notification.apns.received")
    fun notificationTapped() = debug("notification.apns.tapped")
    fun configureIos(debugBuild: Boolean) {
        configure(
            environment = if (debugBuild) Environment.DEV else Environment.PROD,
            service = Service.IOS_APP,
        )
    }

    /** Return a stable opaque value for correlation without retaining the source identifier. */
    fun hashIdentifier(raw: String): String = if (raw.isBlank()) {
        "anon"
    } else {
        "h_${raw.hashCode().toUInt().toString(16)}"
    }

    private fun log(
        level: Level,
        eventType: String,
        message: String?,
        context: Map<String, Any?>,
        requestId: String?,
        traceId: String?,
        result: String?,
        errorCode: String?,
    ) {
        if (!shouldEmit(level)) return

        val fields = linkedMapOf<String, String>()
        fields["timestamp"] = currentTimeMillis().toString()
        fields["level"] = level.value
        fields["service"] = currentService.value
        fields["environment"] = currentEnvironment.value
        fields["event_type"] = sanitizeEventType(eventType)
        requestId?.let { fields["request_id"] = sanitizeIdentifier(it) }
        traceId?.let { fields["trace_id"] = sanitizeIdentifier(it) }
        result?.let { fields["result"] = sanitizeCode(it) }
        errorCode?.let { fields["error_code"] = sanitizeCode(it) }

        // Keep the source-compatible message parameter, but never serialize it.
        // Callers must use stable event_type/error_code values for diagnostics.
        message?.let { Unit }

        val safeContext = sanitizeContext(context)
        if (safeContext.isNotEmpty()) fields["context"] = toJsonObject(safeContext)

        val line = fields.entries.joinToString(" ") { "${it.key}=\"${escape(it.value)}\"" }
        testSink?.invoke(line) ?: platformLog(level, line)
    }

    private fun shouldEmit(level: Level): Boolean = currentEnvironment != Environment.PROD || level != Level.DEBUG

    private fun sanitizeEventType(eventType: String): String {
        val normalized = eventType.trim().lowercase()
        return if (eventTypeRegex.matches(normalized) && normalized in registeredEventTypes) normalized else UNKNOWN_EVENT
    }

    private fun sanitizeContext(context: Map<String, Any?>): Map<String, String> {
        if (context.isEmpty()) return emptyMap()

        // Sort keys so the same event has the same representation regardless of
        // the caller's map implementation or insertion order.
        return context.entries
            .sortedBy { it.key.lowercase() }
            .associateTo(linkedMapOf()) { (rawKey, value) ->
                val key = sanitizeContextKey(rawKey)
                key to when (classifyKey(rawKey)) {
                    RedactionKind.TOKEN -> REDACTED_TOKEN
                    RedactionKind.PII -> REDACTED_PII
                    RedactionKind.RECORDING -> REDACTED_RECORDING
                    RedactionKind.NONE -> sanitizeApprovedValue(key, value)
                }
            }
    }

    private fun sanitizeContextKey(rawKey: String): String {
        val normalized = rawKey.trim().lowercase().replace(Regex("[^a-z0-9_]"), "_")
        return if (contextKeyRegex.matches(normalized)) normalized else "redacted_field"
    }

    private fun sanitizeApprovedValue(key: String, value: Any?): String = when {
        key in hashedIdentifierKeys -> value?.toString()?.let(::hashIdentifier) ?: "anon"
        key in identifierKeys -> value?.toString()?.let(::sanitizeIdentifier) ?: "anon"
        key in safeCodeKeys -> value?.toString()?.let(::sanitizeCode) ?: REDACTED_VALUE
        key in scalarKeys -> sanitizeScalar(value)
        else -> REDACTED_VALUE
    }

    private fun sanitizeScalar(value: Any?): String = when (value) {
        is Boolean -> value.toString()
        is Byte, is Short, is Int, is Long -> value.toString()
        is Float, is Double -> value.toString().takeIf { it.matches(Regex("-?\\d+(?:\\.\\d+)?")) } ?: REDACTED_VALUE
        else -> REDACTED_VALUE
    }

    private fun classifyKey(key: String): RedactionKind {
        val normalized = key.lowercase()
        return when {
            tokenKeyHints.any { normalized.contains(it) } -> RedactionKind.TOKEN
            recordingKeyHints.any { normalized.contains(it) } -> RedactionKind.RECORDING
            piiKeyHints.any { normalized.contains(it) } -> RedactionKind.PII
            else -> RedactionKind.NONE
        }
    }

    private fun sanitizeIdentifier(raw: String): String {
        val normalized = raw.trim()
        return if (safeIdentifierRegex.matches(normalized) && !containsSensitiveText(normalized)) {
            hashIdentifier(normalized)
        } else {
            REDACTED_VALUE
        }
    }

    private fun sanitizeCode(raw: String): String {
        val normalized = raw.trim().lowercase()
        return if (safeCodeRegex.matches(normalized) && !containsSensitiveText(normalized)) {
            normalized
        } else {
            REDACTED_VALUE
        }
    }

    private fun containsSensitiveText(value: String): Boolean =
        emailRegex.containsMatchIn(value) ||
            phoneRegex.containsMatchIn(value) ||
            bearerTokenRegex.containsMatchIn(value) ||
            jwtRegex.containsMatchIn(value) ||
            tokenAssignmentRegex.containsMatchIn(value)

    private fun toJsonObject(values: Map<String, String>): String = values.entries.joinToString(
        prefix = "{",
        postfix = "}",
        separator = ",",
    ) { "\"${escape(it.key)}\":\"${escape(it.value)}\"" }

    private fun escape(value: String): String = value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")

    /** Test-only local sink; no production code calls this. */
    internal fun configureForTests(
        environment: Environment,
        service: Service,
        sink: (String) -> Unit,
    ) {
        currentEnvironment = environment
        currentService = service
        testSink = sink
    }

    /** Test-only reset to the same fail-closed state used on process start. */
    internal fun resetForTests() {
        testSink = null
        currentEnvironment = Environment.PROD
        currentService = Service.KMP_SHARED
    }
}
