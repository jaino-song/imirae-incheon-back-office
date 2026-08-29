package com.imirae.incheon.deeplink

/**
 * Deep link URI → navigation intent router with allowlist validation.
 * Supported routes:
 *   /clients/{id}, /employees/{id}, /contracts/{id},
 *   /messages/templates/{id}, /chat, /dashboard
 *
 * Fail-secure: invalid/malformed URIs are silently dropped.
 */

sealed class NavigationIntent {
    data object Dashboard : NavigationIntent()
    data class ClientDetail(val clientId: String) : NavigationIntent()
    data class EmployeeDetail(val employeeId: String) : NavigationIntent()
    data class ContractDetail(val contractId: String) : NavigationIntent()
    data class MessageTemplateDetail(val templateId: String) : NavigationIntent()
    data object Chat : NavigationIntent()
    data object ClientList : NavigationIntent()
    data object EmployeeList : NavigationIntent()
    data object ContractList : NavigationIntent()
    data object Messages : NavigationIntent()
    data object Settings : NavigationIntent()
    data object Unknown : NavigationIntent()
}

class DeepLinkRouter {
    companion object {
        private val ALLOWED_HOSTS = setOf(
            "imirae-incheon.vercel.app",
            "app.imirae-incheon.com"
        )
        private val ID_PATTERN = Regex("^[a-zA-Z0-9_-]{1,64}$")
    }

    /**
     * Parse a deep link URI and return a NavigationIntent.
     * Returns NavigationIntent.Unknown for invalid/malformed URIs (fail-secure).
     */
    fun route(uri: String): NavigationIntent {
        return try {
            parseUri(uri)
        } catch (_: Exception) {
            NavigationIntent.Unknown
        }
    }

    /**
     * Return the canonical allowlisted path for a URI.  Platform navigation
     * consumes this shared mapping instead of reparsing untrusted URL text.
     * Unknown, malformed, or foreign-host links return null.
     */
    fun routePath(uri: String): String? = when (val intent = route(uri)) {
        NavigationIntent.Dashboard -> "/dashboard"
        is NavigationIntent.ClientDetail -> "/clients/${intent.clientId}"
        is NavigationIntent.EmployeeDetail -> "/employees/${intent.employeeId}"
        is NavigationIntent.ContractDetail -> "/contracts/${intent.contractId}"
        is NavigationIntent.MessageTemplateDetail -> "/messages/templates/${intent.templateId}"
        NavigationIntent.Chat -> "/chat"
        NavigationIntent.ClientList -> "/clients"
        NavigationIntent.EmployeeList -> "/employees"
        NavigationIntent.ContractList -> "/contracts"
        NavigationIntent.Messages -> "/messages"
        NavigationIntent.Settings -> "/settings"
        NavigationIntent.Unknown -> null
    }

    private fun parseUri(uri: String): NavigationIntent {
        // Support both https:// and custom scheme imirae://
        val normalized = when {
            uri.startsWith("imirae://") -> {
                val withoutScheme = uri.removePrefix("imirae://")
                // Android's manifest declares `app` as the custom-scheme host,
                // while older callers used a host-less form.  Accept both and
                // still route through the same path allowlist.
                when {
                    withoutScheme == "app" -> ""
                    withoutScheme.startsWith("app/") -> withoutScheme.removePrefix("app/")
                    else -> withoutScheme
                }
            }
            uri.startsWith("https://") -> {
                val withoutScheme = uri.removePrefix("https://")
                val host = withoutScheme.substringBefore("/")
                if (host !in ALLOWED_HOSTS) return NavigationIntent.Unknown
                withoutScheme.substringAfter("/", "")
            }
            uri.startsWith("http://") -> return NavigationIntent.Unknown // reject http
            else -> uri
        }

        val path = normalized.trimStart('/').split("?").first().split("#").first()
        val segments = path.split("/").filter { it.isNotBlank() }

        return when {
            segments.isEmpty() || (segments.size == 1 && segments[0] == "dashboard") ->
                NavigationIntent.Dashboard

            segments.size == 1 && segments[0] == "clients" ->
                NavigationIntent.ClientList
            segments.size == 2 && segments[0] == "clients" && isValidId(segments[1]) ->
                NavigationIntent.ClientDetail(segments[1])

            segments.size == 1 && segments[0] == "employees" ->
                NavigationIntent.EmployeeList
            segments.size == 2 && segments[0] == "employees" && isValidId(segments[1]) ->
                NavigationIntent.EmployeeDetail(segments[1])

            segments.size == 1 && segments[0] == "contracts" ->
                NavigationIntent.ContractList
            segments.size == 2 && segments[0] == "contracts" && isValidId(segments[1]) ->
                NavigationIntent.ContractDetail(segments[1])

            segments.size == 1 && segments[0] == "messages" ->
                NavigationIntent.Messages
            segments.size == 3 && segments[0] == "messages" && segments[1] == "templates" && isValidId(segments[2]) ->
                NavigationIntent.MessageTemplateDetail(segments[2])

            segments.size == 1 && segments[0] == "chat" ->
                NavigationIntent.Chat

            segments.size == 1 && segments[0] == "settings" ->
                NavigationIntent.Settings

            else -> NavigationIntent.Unknown
        }
    }

    private fun isValidId(id: String): Boolean = ID_PATTERN.matches(id)

    // TODO(TD-DEEP-001): Add deferred deep link support for app-not-installed flow
}
