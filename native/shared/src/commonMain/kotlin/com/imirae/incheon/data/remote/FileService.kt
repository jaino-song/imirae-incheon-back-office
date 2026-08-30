package com.imirae.incheon.data.remote

import com.imirae.incheon.domain.models.FileItem
import com.imirae.incheon.network.ApiClient
import com.imirae.incheon.network.ApiResult

/**
 * Compatibility name for the native file UI. The canonical backend resource
 * is `/documents`, so no request in this service targets `/files`.
 */
interface FileService {
    suspend fun getFiles(): ApiResult<List<FileItem>>
    suspend fun getFile(id: String): ApiResult<FileItem>
    suspend fun deleteFile(id: String): ApiResult<Unit>
}

class FileServiceImpl(private val client: ApiClient) : FileService {
    override suspend fun getFiles(): ApiResult<List<FileItem>> = client.get("/documents")
    override suspend fun getFile(id: String): ApiResult<FileItem> = client.get("/documents/$id")
    override suspend fun deleteFile(id: String): ApiResult<Unit> = client.delete("/documents/$id")
}
