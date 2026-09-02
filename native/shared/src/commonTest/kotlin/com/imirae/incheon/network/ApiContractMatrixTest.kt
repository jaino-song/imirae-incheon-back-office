package com.imirae.incheon.network

import com.imirae.incheon.data.remote.parseChatStreamEvents
import com.imirae.incheon.domain.models.ChatHistoryResponse
import com.imirae.incheon.domain.models.Client
import com.imirae.incheon.domain.models.CreateClientRequest
import com.imirae.incheon.domain.models.Employee
import com.imirae.incheon.domain.models.FileItem
import com.imirae.incheon.domain.models.Notification
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ApiContractMatrixTest {
    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
        isLenient = true
    }

    @Test
    fun matrixCoversEveryNativeSurfaceAndCanonicalFeature() {
        val requiredFeatures = setOf(
            "client",
            "employee",
            "document",
            "contract",
            "chat",
            "template",
            "notification",
            "file",
            "settings",
        )

        assertTrue(requiredFeatures.all { feature ->
            ApiContractMatrix.entries.any { it.feature == feature && it.supported }
        })
        assertTrue(ApiContractMatrix.unsupportedFeatures.isEmpty())
        assertTrue(ApiContractMatrix.entries
            .filter { it.supported }
            .all { NativeSurface.entries.toSet().containsAll(it.surfaces) })
    }

    @Test
    fun matrixContainsNoLegacyOrUnsupportedRouteFamilies() {
        val paths = ApiContractMatrix.supportedEntries.mapNotNull { it.path }
        assertFalse(paths.any { it == "/contracts" || it.startsWith("/contracts/") })
        assertFalse(paths.any { it == "/files" || it.startsWith("/files/") })
        assertFalse(paths.any { it == "/settings" })
        assertFalse(paths.any { it == "/voucher-prices" || it.startsWith("/voucher-prices/") })
        assertFalse(paths.any { it == "/chat" || it.startsWith("/chat/") })
        assertFalse(paths.any { it == "/chat/history" || it.startsWith("/chat/history?") })
        assertFalse(ApiContractMatrix.entries.any { it.feature == "template" && it.method == "PUT" })
        assertFalse(paths.any { it == "/notifications/unread-count" })
        assertTrue(ApiContractMatrix.entries
            .filter { it.feature == "file" && it.supported }
            .all { it.path?.startsWith("/documents") == true })
        assertTrue(ApiContractMatrix.has("PATCH", "/employees?id={id}"))
        assertTrue(ApiContractMatrix.has("DELETE", "/employees?id={id}"))
    }

    @Test
    fun canonicalPayloadsDecodeAndEncodeWithCurrentFields() {
        val client = json.decodeFromString<Client>("""
            {"id":7,"name":"홍길동","voucherClient":true,"breastPump":false,"serviceStatus":"active"}
        """.trimIndent())
        assertEquals(7, client.id)
        assertTrue(client.voucherClient)

        val employee = json.decodeFromString<Employee>("""
            {"id":3,"name":"김직원","workArea":["강남"],"phone":"010-0000-0000","grade":"간호사","openToNextWork":true}
        """.trimIndent())
        assertEquals(3, employee.id)
        assertEquals(listOf("강남"), employee.workArea)

        val requestJson = json.encodeToString(
            CreateClientRequest(
                name = "홍길동",
                voucherClient = true,
                breastPump = false,
            ),
        )
        assertTrue(requestJson.contains("\"voucherClient\":true"))
        assertTrue(requestJson.contains("\"breastPump\":false"))
        assertFalse(requestJson.contains("email"))
        assertFalse(requestJson.contains("memo"))

        val file = json.decodeFromString<FileItem>("""
            {"id":"doc-1","name":"안내.pdf","description":null,"categoryId":"general","categoryLabel":"일반","tags":[],"mimeType":"application/pdf","fileSize":12,"storagePath":"documents/b/doc-1.pdf","storageUrl":null,"orgId":"branch-1","uploadedBy":"user-1","visibilityScope":"branch","canManage":true,"createdAt":null,"updatedAt":null}
        """.trimIndent())
        assertEquals("doc-1", file.id)
        assertEquals("application/pdf", file.mimeType)

        val history = json.decodeFromString<ChatHistoryResponse>("""
            {"messages":[{"id":"m-1","role":"user","content":"안녕"}],"total":1,"hasMore":false,"sessionId":"s-1","isSessionActive":true}
        """.trimIndent())
        assertEquals("s-1", history.sessionId)
        assertEquals("m-1", history.messages.single().id)

        val notification = json.decodeFromString<Notification>("""
            {"id":12,"title":"알림","body":"확인","sentAt":"2026-08-29T00:00:00.000Z","readAt":null,"isRead":false}
        """.trimIndent())
        assertEquals(12, notification.id)
        assertFalse(notification.isRead)
    }

    @Test
    fun chatSseParserAcceptsBackendEventsAndIgnoresMalformedLines() {
        val events = parseChatStreamEvents(
            """
            : keep-alive
            data: {"type":"chunk","content":"안"}
            data: {"type":"chunk","content":"녕","sessionId":"s-1"}
            data: not-json
            data: {"type":"done","sessionId":"s-1"}
            """.trimIndent(),
        )

        assertEquals(listOf("chunk", "chunk", "done"), events.map { it.type })
        assertEquals("안녕", events.take(2).mapNotNull { it.content }.joinToString(""))
        assertEquals("s-1", events.last().sessionId)
        assertNotNull(events.first().content)
    }
}
