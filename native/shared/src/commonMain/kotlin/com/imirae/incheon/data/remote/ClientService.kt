package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*
import io.ktor.client.request.*

interface ClientService {
    suspend fun getClients(page: Int = 1, limit: Int = 20, search: String? = null): ApiResult<ClientListResponse>
    suspend fun getClient(id: Int): ApiResult<Client>
    suspend fun createClient(request: CreateClientRequest): ApiResult<Client>
    suspend fun updateClient(id: Int, request: UpdateClientRequest): ApiResult<Client>
    suspend fun deleteClient(id: Int): ApiResult<Unit>
}

class ClientServiceImpl(private val client: ApiClient) : ClientService {
    override suspend fun getClients(page: Int, limit: Int, search: String?) = client.get<ClientListResponse>("/clients?page=$page&limit=$limit" + (search?.let { "&search=$it" } ?: ""))
    override suspend fun getClient(id: Int) = client.get<Client>("/clients/$id")
    override suspend fun createClient(request: CreateClientRequest) = client.post<Client>("/clients") { setBody(request) }
    override suspend fun updateClient(id: Int, request: UpdateClientRequest) = client.patch<Client>("/clients/$id") { setBody(request) }
    override suspend fun deleteClient(id: Int) = client.delete<Unit>("/clients/$id")
}
