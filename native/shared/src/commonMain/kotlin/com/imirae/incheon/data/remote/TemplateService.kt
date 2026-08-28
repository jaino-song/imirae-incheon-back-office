package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*
import io.ktor.client.request.*

interface TemplateService {
    suspend fun getMessageTemplates(): ApiResult<List<MessageTemplate>>
    suspend fun getMessageTemplate(id: String): ApiResult<MessageTemplate>
    suspend fun createMessageTemplate(title: String, content: String, category: String?): ApiResult<MessageTemplate>
    suspend fun updateMessageTemplate(id: String, title: String, content: String, category: String?): ApiResult<MessageTemplate>
    suspend fun deleteMessageTemplate(id: String): ApiResult<Unit>
    suspend fun getSystemTemplates(): ApiResult<List<SystemTemplate>>
}

class TemplateServiceImpl(private val client: ApiClient) : TemplateService {
    override suspend fun getMessageTemplates() = client.get<List<MessageTemplate>>("/message-templates")
    override suspend fun getMessageTemplate(id: String) = client.get<MessageTemplate>("/message-templates/$id")
    override suspend fun createMessageTemplate(title: String, content: String, category: String?) = client.post<MessageTemplate>("/message-templates") {
        setBody(MessageTemplateRequest(name = title, content = content))
    }
    override suspend fun updateMessageTemplate(id: String, title: String, content: String, category: String?) = client.patch<MessageTemplate>("/message-templates/$id") {
        setBody(MessageTemplateRequest(name = title, content = content))
    }
    override suspend fun deleteMessageTemplate(id: String) = client.delete<Unit>("/message-templates/$id")
    override suspend fun getSystemTemplates() = client.get<List<SystemTemplate>>("/system-templates")
}
