package com.imirae.incheon.domain.models

import kotlinx.serialization.Serializable

/** Canonical employee response returned by GET /employees. */
@Serializable
data class Employee(
    val id: Int,
    val name: String,
    val workArea: List<String> = emptyList(),
    val phone: String,
    val grade: String,
    val openToNextWork: Boolean,
    val registeredDate: String? = null,
    val birthday: String? = null,
    val status: String? = null,
)

/** Optional fields accepted by PATCH /employees?id={id}. */
@Serializable
data class UpdateEmployeeRequest(
    val name: String? = null,
    val workArea: List<String>? = null,
    val phone: String? = null,
    val grade: String? = null,
    val openToNextWork: Boolean? = null,
    val birthday: String? = null,
)
