package com.imirae.incheon.domain.models

import kotlinx.serialization.Serializable

/**
 * Canonical document response from GET /documents and GET /documents/:id.
 *
 * The backend has no generic `/files` or `/contracts` resource. Native file
 * and document surfaces therefore consume this single branch-scoped shape.
 */
@Serializable
data class FileItem(
    val id: String,
    val name: String,
    val description: String? = null,
    val categoryId: String,
    val categoryLabel: String? = null,
    val tags: List<String> = emptyList(),
    val mimeType: String,
    val fileSize: Long,
    val storagePath: String,
    val storageUrl: String? = null,
    val orgId: String? = null,
    val uploadedBy: String,
    val visibilityScope: String,
    val canManage: Boolean = false,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)
