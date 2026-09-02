package com.imirae.incheon.domain.models
import kotlinx.serialization.Serializable
@Serializable data class PaginationParams(val page: Int = 1, val limit: Int = 20, val search: String? = null, val sortBy: String? = null, val sortOrder: String = "desc")
@Serializable data class DashboardStats(
    val totalClients: Int = 0,
    val activeContracts: Int = 0,
    val totalEmployees: Int = 0,
    val pendingContracts: Int = 0,
    val recentClients: List<Client> = emptyList(),
    val totalDocuments: Int = 0,
    val contractsSupported: Boolean = false,
)
