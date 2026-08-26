package com.imirae.incheon.network

/** The runtime family that owns the endpoint configuration. */
enum class ApiEndpointPlatform {
    ANDROID_EMULATOR,
    IOS_SIMULATOR,
    IOS_DEVICE,
}

/** The build variant that is allowed to consume the endpoint. */
enum class ApiBuildVariant {
    DEBUG,
    RELEASE,
}

class InvalidApiEndpointConfigurationException(
    message: String,
) : IllegalArgumentException(message)

/**
 * Validates an API base URL at the application composition boundary.
 *
 * The Android emulator alias is deliberately an Android-debug-only exception.
 * iOS receives an explicit build setting instead and must use TLS for both
 * simulator and device builds. Production validation rejects local/private
 * development hosts without embedding a production hostname in shared code.
 */
object ApiEndpointConfiguration {
    private const val ANDROID_EMULATOR_HOST = "10.0.2.2"
    private const val ANDROID_EMULATOR_PORT = 3001

    private val endpointPattern = Regex(
        pattern = "^(https?)://([^/?#\\s]+)(/[^?#\\s]*)?$",
        options = setOf(RegexOption.IGNORE_CASE),
    )

    fun resolve(
        rawUrl: String?,
        platform: ApiEndpointPlatform,
        buildVariant: ApiBuildVariant,
    ): String {
        val normalized = rawUrl?.trim()?.takeUnless { it.isEmpty() }
            ?: invalid("missing endpoint")

        if (normalized.contains("$(API_BASE_URL)")) {
            invalid("unresolved endpoint")
        }

        val match = endpointPattern.matchEntire(normalized)
            ?: invalid("malformed endpoint")
        val protocol = match.groupValues[1].lowercase()
        val authority = match.groupValues[2]
        val path = match.groupValues.getOrNull(3).orEmpty()

        if (authority.contains('@')) {
            invalid("endpoint credentials are not allowed")
        }

        val hostAndPort = parseAuthority(authority)
        val host = hostAndPort.host.trimEnd('.').lowercase()
        if (host.isEmpty()) {
            invalid("missing endpoint host")
        }
        val port = hostAndPort.port
        val isAndroidEmulatorDebugEndpoint =
            platform == ApiEndpointPlatform.ANDROID_EMULATOR &&
                buildVariant == ApiBuildVariant.DEBUG &&
                protocol == "http" &&
                host == ANDROID_EMULATOR_HOST &&
                port == ANDROID_EMULATOR_PORT &&
                (path.isEmpty() || path == "/")

        if (!isAndroidEmulatorDebugEndpoint && protocol != "https") {
            invalid("TLS is required")
        }

        if (!isAndroidEmulatorDebugEndpoint && host == ANDROID_EMULATOR_HOST) {
            invalid("Android emulator endpoint is not valid for this build")
        }

        if (!isAndroidEmulatorDebugEndpoint && isDevelopmentHost(host)) {
            invalid("development endpoint is not allowed for this build")
        }

        if (buildVariant == ApiBuildVariant.RELEASE && (isPrivateOrLocalHost(host) || isReservedHost(host))) {
            invalid("private endpoint is not allowed in release")
        }

        return normalized.trimEnd('/')
    }

    /** Null-returning boundary for Swift, where throwing Kotlin exceptions is awkward. */
    fun resolveOrNull(
        rawUrl: String?,
        platform: ApiEndpointPlatform,
        buildVariant: ApiBuildVariant,
    ): String? = runCatching {
        resolve(rawUrl, platform, buildVariant)
    }.getOrNull()

    private fun parseAuthority(authority: String): Authority {
        if (authority.isEmpty()) {
            invalid("missing endpoint host")
        }

        if (authority.startsWith('[')) {
            val closingBracket = authority.indexOf(']')
            if (closingBracket <= 1) {
                invalid("malformed endpoint host")
            }
            val host = authority.substring(1, closingBracket)
            val suffix = authority.substring(closingBracket + 1)
            val port = parsePort(suffix)
            return Authority(host, port)
        }

        if (authority.count { it == ':' } > 1) {
            invalid("malformed endpoint host")
        }

        val separator = authority.indexOf(':')
        val host = if (separator == -1) authority else authority.substring(0, separator)
        val suffix = if (separator == -1) "" else authority.substring(separator)
        if (host.isEmpty()) {
            invalid("missing endpoint host")
        }
        return Authority(host, parsePort(suffix))
    }

    private fun parsePort(suffix: String): Int? {
        if (suffix.isEmpty()) {
            return null
        }
        if (!suffix.startsWith(':')) {
            invalid("malformed endpoint port")
        }
        val port = suffix.substring(1).toIntOrNull()
            ?: invalid("malformed endpoint port")
        if (port !in 1..65535) {
            invalid("malformed endpoint port")
        }
        return port
    }

    private fun isDevelopmentHost(host: String): Boolean =
        host == "localhost" ||
            host == "0.0.0.0" ||
            host == "127.0.0.1" ||
            host == "::1" ||
            host.endsWith(".local") ||
            isPrivateOrLocalHost(host)

    private fun isReservedHost(host: String): Boolean =
        host == "example.com" ||
            host.endsWith(".example.com") ||
            host.endsWith(".example") ||
            host.endsWith(".invalid") ||
            host.endsWith(".test") ||
            host.endsWith(".localhost")

    private fun isPrivateOrLocalHost(host: String): Boolean {
        val octets = host.split('.')
        if (octets.size != 4 || octets.any { it.toIntOrNull() == null }) {
            return host == "::1" ||
                host.startsWith("fc", ignoreCase = true) ||
                host.startsWith("fd", ignoreCase = true) ||
                host.startsWith("fe80:", ignoreCase = true)
        }

        val values = octets.map { it.toInt() }
        if (values.any { it !in 0..255 }) {
            return true
        }
        val first = values[0]
        val second = values[1]
        return first == 0 ||
            first == 10 ||
            first == 127 ||
            (first == 169 && second == 254) ||
            (first == 172 && second in 16..31) ||
            (first == 192 && second == 168)
    }

    private fun invalid(reason: String): Nothing =
        throw InvalidApiEndpointConfigurationException("Invalid API endpoint configuration: $reason")

    private data class Authority(
        val host: String,
        val port: Int?,
    )
}
