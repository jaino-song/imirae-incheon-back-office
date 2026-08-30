package com.imirae.incheon.domain.utils

object StatusCodes {
    fun getStatusLabel(status: String): String = when (status) {
        "active" -> "활성"
        "inactive" -> "비활성"
        "archived" -> "보관됨"
        "draft" -> "초안"
        "pending" -> "대기 중"
        "sent" -> "발송됨"
        "signed" -> "서명 완료"
        "rejected" -> "거절됨"
        "revoked" -> "취소됨"
        "completed" -> "완료"
        "expired" -> "만료됨"
        "on_leave" -> "휴직"
        "available" -> "가능"
        "working" -> "근무 중"
        "unavailable" -> "불가"
        else -> status
    }

    fun contractStatusLabel(status: String): String = getStatusLabel(status)
    fun clientStatusLabel(status: String): String = getStatusLabel(status)
    fun employeeStatusLabel(status: String): String = getStatusLabel(status)

    fun getStatusColor(status: String): String = when (status) {
        "active", "signed", "completed" -> "success"
        "pending", "draft", "sent" -> "warning"
        "inactive", "rejected", "revoked", "expired" -> "destructive"
        else -> "muted"
    }
}
