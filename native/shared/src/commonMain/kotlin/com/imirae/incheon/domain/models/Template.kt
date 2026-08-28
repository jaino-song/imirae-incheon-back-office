package com.imirae.incheon.domain.models

import kotlinx.serialization.Serializable

@Serializable
data class TemplateVariable(
    val key: String,
    val type: String,
    val label: String,
    val placeholder: String? = null,
    val required: Boolean = false,
    val optionType: String? = null,
    val options: List<String>? = null,
    val dataSource: String? = null,
    val min: Double? = null,
    val max: Double? = null,
)

@Serializable
data class MessageTemplate(
    val id: String,
    @kotlinx.serialization.SerialName("name") val title: String,
    val content: String,
    val variables: List<TemplateVariable> = emptyList(),
    val createdAt: String? = null,
    val updatedAt: String? = null,
    /** Legacy presentation-only category; never serialized to the backend. */
    @kotlinx.serialization.Transient val category: String? = null,
)

@Serializable
data class MessageTemplateRequest(
    val name: String,
    val content: String,
    val variables: List<TemplateVariable> = emptyList(),
)

@Serializable
data class SystemTemplate(
    val id: String,
    val templateKey: String? = null,
    val name: String,
    val description: String? = null,
    val content: String,
    val requiredVariables: List<TemplateVariable> = emptyList(),
    val customVariables: List<TemplateVariable> = emptyList(),
    val createdAt: String? = null,
    val updatedAt: String? = null,
)
