package com.imirae.incheon.network

/** Native surfaces that share the endpoint contract. */
enum class NativeSurface {
    SHARED,
    ANDROID,
    IOS,
}

/** One method/path/response contract consumed by native clients. */
data class ApiContractEntry(
    val feature: String,
    val method: String,
    val path: String?,
    val response: String,
    val supported: Boolean = true,
    val surfaces: Set<NativeSurface> = setOf(
        NativeSurface.SHARED,
        NativeSurface.ANDROID,
        NativeSurface.IOS,
    ),
)

/**
 * Single source of truth for native endpoint parity.
 *
 * The native contract-document route is an intentional presentation alias for
 * the backend's canonical `/documents` resource. No `/contracts` request is
 * represented here.
 */
object ApiContractMatrix {
    val entries: List<ApiContractEntry> = listOf(
        ApiContractEntry("client", "GET", "/clients?page={page}&limit={limit}", "ClientListResponse"),
        ApiContractEntry("client", "GET", "/clients/{id}", "Client"),
        ApiContractEntry("client", "POST", "/clients", "Client"),
        ApiContractEntry("client", "PATCH", "/clients/{id}", "Client"),
        ApiContractEntry("client", "DELETE", "/clients/{id}", "Unit"),
        ApiContractEntry("employee", "GET", "/employees", "List<Employee>"),
        ApiContractEntry("employee", "GET", "/employees/id?id={id}", "Employee"),
        ApiContractEntry("employee", "PATCH", "/employees?id={id}", "Employee"),
        ApiContractEntry("employee", "DELETE", "/employees?id={id}", "Unit"),
        ApiContractEntry("document", "GET", "/documents", "List<FileItem>"),
        ApiContractEntry("document", "GET", "/documents/{id}", "FileItem"),
        ApiContractEntry("document", "PUT", "/documents/{id}", "FileItem"),
        ApiContractEntry("document", "DELETE", "/documents/{id}", "Unit"),
        ApiContractEntry("contract", "GET", "/documents", "List<FileItem>"),
        ApiContractEntry("contract", "GET", "/documents/{id}", "FileItem"),
        ApiContractEntry("contract", "PUT", "/documents/{id}", "FileItem"),
        ApiContractEntry("contract", "DELETE", "/documents/{id}", "Unit"),
        ApiContractEntry("file", "GET", "/documents", "List<FileItem>"),
        ApiContractEntry("file", "GET", "/documents/{id}", "FileItem"),
        ApiContractEntry("file", "DELETE", "/documents/{id}", "Unit"),
        ApiContractEntry("chat", "POST", "/ai/chat/stream", "SSE(ChatStreamEvent)"),
        ApiContractEntry("chat", "GET", "/ai/chat/history?offset={offset}&limit={limit}", "ChatHistoryResponse"),
        ApiContractEntry("template", "GET", "/message-templates", "List<MessageTemplate>"),
        ApiContractEntry("template", "GET", "/message-templates/{id}", "MessageTemplate"),
        ApiContractEntry("template", "POST", "/message-templates", "MessageTemplate"),
        ApiContractEntry("template", "PATCH", "/message-templates/{id}", "MessageTemplate"),
        ApiContractEntry("template", "DELETE", "/message-templates/{id}", "Unit"),
        ApiContractEntry("template", "GET", "/system-templates", "List<SystemTemplate>"),
        ApiContractEntry("notification", "GET", "/notifications", "List<Notification>"),
        ApiContractEntry("notification", "GET", "/notifications/unread/count", "UnreadCountResponse"),
        ApiContractEntry("notification", "PATCH", "/notifications/{id}/read", "Notification"),
        ApiContractEntry("settings", "GET", "/settings/notification-preferences", "NotificationPreferencesResponse"),
        ApiContractEntry("settings", "PUT", "/settings/notification-preferences", "NotificationPreferencesResponse"),
        ApiContractEntry("settings", "GET", "/voucher-price-infos", "List<VoucherPrice>"),
    )

    val supportedEntries: List<ApiContractEntry>
        get() = entries.filter { it.supported }

    val unsupportedFeatures: Set<String>
        get() = entries.filterNot { it.supported }.mapTo(linkedSetOf()) { it.feature }

    fun has(method: String, path: String): Boolean = supportedEntries.any {
        it.method == method && it.path == path
    }
}
