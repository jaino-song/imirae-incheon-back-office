package com.imirae.incheon.data.remote

import com.imirae.incheon.domain.models.FileItem
import com.imirae.incheon.network.ApiClient
import com.imirae.incheon.network.ApiResult
import io.ktor.client.request.setBody
import kotlinx.serialization.Serializable

/** Branch-scoped document metadata API. */
interface DocumentService {
    suspend fun getDocuments(categoryId: String? = null): ApiResult<List<FileItem>>
    suspend fun getDocument(id: String): ApiResult<FileItem>
    suspend fun updateDocument(id: String, request: UpdateDocumentRequest): ApiResult<FileItem>
    suspend fun deleteDocument(id: String): ApiResult<Unit>
}

@Serializable
data class UpdateDocumentRequest(
    val name: String? = null,
    val description: String? = null,
    val categoryId: String? = null,
    val tags: List<String>? = null,
)

class DocumentServiceImpl(private val client: ApiClient) : DocumentService {
    override suspend fun getDocuments(categoryId: String?): ApiResult<List<FileItem>> = client.get(
        "/documents" + (categoryId?.let { "?categoryId=$it" } ?: ""),
    )

    override suspend fun getDocument(id: String): ApiResult<FileItem> = client.get("/documents/$id")

    override suspend fun updateDocument(id: String, request: UpdateDocumentRequest): ApiResult<FileItem> = client.put(
        "/documents/$id",
    ) { setBody(request) }

    override suspend fun deleteDocument(id: String): ApiResult<Unit> = client.delete("/documents/$id")
}
