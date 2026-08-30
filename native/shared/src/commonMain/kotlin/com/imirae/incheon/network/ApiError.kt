package com.imirae.incheon.network

import kotlinx.serialization.Serializable

sealed class ApiError {
    data class Http(val code: Int, val message: String, val body: String? = null) : ApiError()
    data class Network(val cause: String) : ApiError()
    data class Timeout(val cause: String = "요청 시간이 초과되었습니다") : ApiError()
    data class Serialization(val cause: String) : ApiError()
    data class Unknown(val cause: String) : ApiError()
    data class Unsupported(val cause: String) : ApiError()

    fun userMessage(): String = when (this) {
        is Http -> {
            val serverMessage = body?.let { parseServerErrorMessage(it) }
            serverMessage ?: when (code) {
                400 -> "잘못된 요청입니다 (400)"
                401 -> "인증이 만료되었습니다. 다시 로그인해 주세요"
                403 -> "접근 권한이 없습니다"
                404 -> "요청한 정보를 찾을 수 없습니다 (404)"
                409 -> "이미 존재하는 데이터입니다"
                422 -> "입력값을 확인해 주세요"
                429 -> "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요"
                in 500..599 -> "서버 오류가 발생했습니다 ($code)"
                else -> "요청 실패: $message ($code)"
            }
        }
        is Network -> "네트워크 연결을 확인해 주세요: $cause"
        is Timeout -> "요청 시간이 초과되었습니다. 네트워크 상태를 확인해 주세요"
        is Serialization -> "서버 응답 처리 중 오류: $cause"
        is Unknown -> "오류가 발생했습니다: $cause"
        is Unsupported -> cause
    }

    fun technicalMessage(): String = when (this) {
        is Http -> "HTTP $code: $message${body?.let { " | body=$it" } ?: ""}"
        is Network -> "Network: $cause"
        is Timeout -> "Timeout: $cause"
        is Serialization -> "Serialization: $cause"
        is Unknown -> "Unknown: $cause"
        is Unsupported -> "Unsupported: $cause"
    }
}

private fun parseServerErrorMessage(body: String): String? {
    val messageMatch = """"message"\s*:\s*"([^"]+)"""".toRegex().find(body)
    if (messageMatch != null) return messageMatch.groupValues[1]
    val errorMatch = """"error"\s*:\s*"([^"]+)"""".toRegex().find(body)
    return errorMatch?.groupValues?.get(1)
}

@Serializable
data class ApiErrorResponse(
    val message: String? = null,
    val statusCode: Int? = null,
    val error: String? = null,
)
