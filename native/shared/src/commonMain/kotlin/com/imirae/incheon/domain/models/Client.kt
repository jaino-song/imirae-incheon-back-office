package com.imirae.incheon.domain.models

import kotlinx.serialization.Serializable

/**
 * Canonical client representation returned by the backend client controller.
 * Backend ids are numeric and the response is enriched with assignment and
 * document signals. Unknown fields remain ignored by the shared JSON client.
 */
@Serializable
data class Client(
    val id: Int,
    val name: String,
    val createdAt: String? = null,
    val address: String? = null,
    val phone: String? = null,
    val type: String? = null,
    val duration: Int? = null,
    val fullPrice: String? = null,
    val grant: String? = null,
    val actualPrice: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val careCenter: Boolean? = null,
    val voucherClient: Boolean = false,
    val birthday: String? = null,
    val dueDate: String? = null,
    val birthDate: String? = null,
    val serviceStatus: String? = null,
    val breastPump: Boolean = false,
    val eDocId: String? = null,
    val areaId: String? = null,
    val hasSigned: Boolean = false,
    val documentStatus: String? = null,
    val badges: List<ClientBadge> = emptyList(),
    val actionRequired: ClientActionRequired? = null,
    val primaryEmployee: ClientEmployeeSummary? = null,
    val secondaryEmployee: ClientEmployeeSummary? = null,
    val pendingScheduleChange: PendingScheduleChange? = null,
)

@Serializable
data class ClientEmployeeSummary(
    val id: Int,
    val name: String,
    val phone: String? = null,
)

@Serializable
data class ClientBadge(
    val key: String,
    val status: String,
    val label: String,
    val tone: String,
    val priority: Int,
)

@Serializable
data class ClientActionRequired(
    val reason: String,
    val priority: Int,
)

@Serializable
data class PendingScheduleChange(
    val id: String,
    val sessionIndex: Int,
    val fromDate: String,
    val toDate: String,
    val oldEndDate: String,
    val newEndDate: String,
)

@Serializable
data class ClientListResponse(
    val data: List<Client>,
    val total: Int,
    val page: Int,
    val limit: Int,
    val totalPages: Int = 1,
)

/** Required fields are intentionally non-null to match CreateClientDto. */
@Serializable
data class CreateClientRequest(
    val name: String,
    val voucherClient: Boolean,
    val breastPump: Boolean,
    val primaryEmployeeId: Int? = null,
    val secondaryEmployeeId: Int? = null,
    val address: String? = null,
    val phone: String? = null,
    val type: String? = null,
    val duration: Int? = null,
    val fullPrice: String? = null,
    val grant: String? = null,
    val actualPrice: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val careCenter: Boolean? = null,
    val birthday: String? = null,
    val dueDate: String? = null,
    val birthDate: String? = null,
    val serviceStatus: String? = null,
    val eDocId: String? = null,
    val areaId: String? = null,
    val suppressGreetingSms: Boolean? = null,
    val applyMessageAutomation: Boolean? = null,
    val reuseExistingClient: Boolean? = null,
    val source: String? = null,
)

/** PATCH request; nullable fields express explicit clears from native forms. */
@Serializable
data class UpdateClientRequest(
    val name: String? = null,
    val primaryEmployeeId: Int? = null,
    val secondaryEmployeeId: Int? = null,
    val address: String? = null,
    val phone: String? = null,
    val type: String? = null,
    val duration: Int? = null,
    val fullPrice: String? = null,
    val grant: String? = null,
    val actualPrice: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val careCenter: Boolean? = null,
    val voucherClient: Boolean? = null,
    val birthday: String? = null,
    val dueDate: String? = null,
    val birthDate: String? = null,
    val serviceStatus: String? = null,
    val breastPump: Boolean? = null,
    val eDocId: String? = null,
    val areaId: String? = null,
)
