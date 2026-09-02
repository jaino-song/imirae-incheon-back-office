package com.imirae.incheon.data.remote

import com.imirae.incheon.domain.models.RegisterRequest
import com.imirae.incheon.domain.models.TokenRefreshRequest
import com.imirae.incheon.domain.models.VerifyEmailRequest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AuthContractTest {
    private val json = Json { encodeDefaults = true }

    @Test
    fun registerPayloadMatchesRequiredBackendDtoFields() {
        val payload = Json.parseToJsonElement(json.encodeToString(
            RegisterRequest(
                email = "person@example.com",
                password = "Strong!Pass1",
                name = "홍길동",
                phone = "010-1234-5678",
                birthDate = "1990-01-01",
            )
        )).jsonObject

        assertEquals("person@example.com", payload["email"]?.toString()?.trim('"'))
        assertEquals("Strong!Pass1", payload["password"]?.toString()?.trim('"'))
        assertEquals("홍길동", payload["name"]?.toString()?.trim('"'))
        assertEquals("010-1234-5678", payload["phone"]?.toString()?.trim('"'))
        assertEquals("1990-01-01", payload["birthDate"]?.toString()?.trim('"'))
        assertEquals(5, payload.size)
        assertFalse(payload.values.any { it.toString() == "null" })
    }

    @Test
    fun verificationAndRefreshPayloadsUseCanonicalBodyAndRouteContracts() {
        val verify = Json.parseToJsonElement(json.encodeToString(VerifyEmailRequest("verify-token"))).jsonObject
        val refresh = Json.parseToJsonElement(json.encodeToString(TokenRefreshRequest("refresh-token"))).jsonObject

        assertEquals(setOf("token"), verify.keys)
        assertEquals(setOf("refreshToken"), refresh.keys)
        assertTrue(verify.containsKey("token"))
        assertTrue(refresh.containsKey("refreshToken"))
    }
}
