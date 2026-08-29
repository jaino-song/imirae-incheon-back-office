package com.imirae.incheon.auth

import com.imirae.incheon.network.platformEngine
import io.ktor.client.HttpClient
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/** The backend's only canonical native session revocation route. */
internal class HttpSessionRevoker(private val apiBaseUrl: String) : SessionRevoker {
    private val client = HttpClient(platformEngine()) {
        install(ContentNegotiation) {
            json(Json {
                ignoreUnknownKeys = true
                isLenient = true
                encodeDefaults = true
            })
        }
    }

    override suspend fun revoke(accessToken: String?, refreshToken: String?, @Suppress("UNUSED_PARAMETER") deviceId: String?): Boolean {
        if (accessToken == null && refreshToken == null) {
            return true
        }

        // LogoutDto intentionally accepts only the canonical refreshToken
        // field.  Sending legacy snake_case/device aliases would be rejected by
        // the backend's strict validation pipe.
        val payload = buildMap {
            if (refreshToken != null) put("refreshToken", refreshToken)
        }

        return runCatching {
            val response = client.post("$apiBaseUrl/auth/logout") {
                if (accessToken != null) {
                    header(HttpHeaders.Authorization, "Bearer $accessToken")
                }
                contentType(ContentType.Application.Json)
                setBody(payload)
            }

            // A missing/already-expired session is terminally revoked from the
            // server's perspective; local cleanup still proceeds in all cases.
            response.status.isSuccess() || response.status.value == 401 || response.status.value == 403
        }.getOrDefault(false)
    }
}
