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
 * Because native request targets are root-relative, accepted base URLs must
 * contain no path (a single root slash is normalized away).
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

        // Native service endpoints are intentionally root-relative (for example,
        // `/auth/login`). A pathful base would therefore be discarded by Ktor's
        // URL resolution and silently send requests to the wrong route. Keep the
        // composition boundary pathless instead of allowing that mismatch.
        if (path.isNotEmpty() && path != "/") {
            invalid("endpoint path must be empty or /; native requests use root-relative paths")
        }

        if (authority.contains('@')) {
            invalid("endpoint credentials are not allowed")
        }

        val hostAndPort = parseAuthority(authority)
        val host = hostAndPort.host.trimEnd('.').lowercase()
        if (host.isEmpty()) {
            invalid("missing endpoint host")
        }
        if (host.contains('%')) {
            invalid("IPv6 zone identifiers are not allowed")
        }
        rejectNonCanonicalNumericIpv4(host)
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
            if (host.contains('%')) {
                invalid("IPv6 zone identifiers are not allowed")
            }
            if (parseIpv6Literal(host) == null) {
                invalid("malformed endpoint host")
            }
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

    /**
     * Rejects alternate numeric IPv4 spellings before host classification.
     *
     * URL consumers may interpret forms such as `127.1`, `2130706433`, or
     * `0x7f000001` as loopback. Keeping only canonical dotted-decimal literals
     * makes the release guard agree with the URL parser instead of allowing a
     * private/local address to bypass it.
     */
    private fun rejectNonCanonicalNumericIpv4(host: String) {
        val components = host.split('.')
        val isCanonicalDottedDecimal = components.size == 4 &&
            components.all { component ->
                component.isNotEmpty() &&
                    (component == "0" || !component.startsWith('0')) &&
                    component.all { it in '0'..'9' } &&
                    component.toIntOrNull()?.let { it in 0..255 } == true
            }
        if (isCanonicalDottedDecimal) {
            return
        }

        val isDecimalIpv4Syntax = host.isNotEmpty() &&
            host.all { it in '0'..'9' || it == '.' }
        val isHexIpv4Syntax = components.any { it.startsWith("0x") } &&
            components.all { component ->
                val digits = component.removePrefix("0x")
                digits.isNotEmpty() && digits.all(::isHexDigit)
            }
        if (isDecimalIpv4Syntax || isHexIpv4Syntax) {
            invalid("non-canonical IPv4 endpoint host")
        }
    }

    private fun isPrivateOrLocalHost(host: String): Boolean {
        val octets = host.split('.')
        if (octets.size == 4 && octets.none { it.toIntOrNull() == null }) {
            val values = octets.map { it.toInt() }
            if (values.any { it !in 0..255 }) {
                return true
            }
            return isPrivateIpv4(values[0], values[1])
        }

        val ipv6Hextets = parseIpv6Literal(host) ?: return false
        val firstHextet = ipv6Hextets.first()
        return isIpv6Unspecified(ipv6Hextets) ||
            isIpv6Loopback(ipv6Hextets) ||
            isIpv4MappedPrivate(ipv6Hextets) ||
            (firstHextet and 0xFE00) == 0xFC00 ||
            (firstHextet and 0xFFC0) == 0xFE80
    }

    /** Returns expanded hextets only when [host] is a syntactically valid IPv6 literal. */
    private fun parseIpv6Literal(host: String): List<Int>? {
        if (!host.contains(':') || host.contains('%')) {
            return null
        }

        val compressionStart = host.indexOf("::")
        if (compressionStart >= 0 && host.indexOf("::", compressionStart + 2) >= 0) {
            return null
        }

        val hasCompression = compressionStart >= 0
        val leftText = if (hasCompression) host.substring(0, compressionStart) else host
        val rightText = if (hasCompression) host.substring(compressionStart + 2) else ""
        val leftHextets = parseIpv6Segments(leftText) ?: return null
        val rightHextets = if (hasCompression) {
            parseIpv6Segments(rightText) ?: return null
        } else {
            emptyList()
        }
        val segmentCount = leftHextets.size + rightHextets.size

        if (hasCompression) {
            if (segmentCount >= 8) {
                return null
            }
            return leftHextets + List(8 - segmentCount) { 0 } + rightHextets
        }

        return leftHextets.takeIf { segmentCount == 8 }
    }

    private fun parseIpv6Segments(text: String): List<Int>? {
        if (text.isEmpty()) {
            return emptyList()
        }

        val segments = text.split(':')
        if (segments.any { it.isEmpty() }) {
            return null
        }

        val hextets = mutableListOf<Int>()
        segments.forEachIndexed { index, segment ->
            if (segment.contains('.')) {
                if (index != segments.lastIndex) {
                    return null
                }
                val ipv4 = parseIpv4Segment(segment) ?: return null
                hextets += (ipv4 ushr 16)
                hextets += (ipv4 and 0xFFFF)
            } else {
                if (segment.length !in 1..4 || segment.any { !isHexDigit(it) }) {
                    return null
                }
                hextets += segment.toIntOrNull(16) ?: return null
            }
        }
        return hextets
    }

    private fun parseIpv4Segment(segment: String): Int? {
        val octets = segment.split('.')
        if (octets.size != 4) {
            return null
        }

        var value = 0
        octets.forEach { octet ->
            if (octet.isEmpty() || octet.any { it !in '0'..'9' }) {
                return null
            }
            val parsed = octet.toIntOrNull() ?: return null
            if (parsed !in 0..255) {
                return null
            }
            value = (value shl 8) or parsed
        }
        return value
    }

    private fun isHexDigit(character: Char): Boolean =
        character in '0'..'9' || character in 'a'..'f' || character in 'A'..'F'

    private fun isIpv6Unspecified(hextets: List<Int>): Boolean =
        hextets.size == 8 && hextets.all { it == 0 }

    private fun isIpv6Loopback(hextets: List<Int>): Boolean {
        if (hextets.size != 8 || hextets.last() != 1) {
            return false
        }
        return hextets.dropLast(1).all { it == 0 }
    }

    private fun isIpv4MappedPrivate(hextets: List<Int>): Boolean {
        if (hextets.size != 8 || hextets.take(5).any { it != 0 } || hextets[5] != 0xFFFF) {
            return false
        }
        val first = hextets[6] ushr 8
        val second = hextets[6] and 0xFF
        return isPrivateIpv4(first, second)
    }

    private fun isPrivateIpv4(first: Int, second: Int): Boolean =
        first == 0 ||
            first == 10 ||
            first == 127 ||
            (first == 169 && second == 254) ||
            (first == 172 && second in 16..31) ||
            (first == 192 && second == 168)

    private fun invalid(reason: String): Nothing =
        throw InvalidApiEndpointConfigurationException("Invalid API endpoint configuration: $reason")

    private data class Authority(
        val host: String,
        val port: Int?,
    )
}
