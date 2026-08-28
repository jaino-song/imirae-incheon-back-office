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
