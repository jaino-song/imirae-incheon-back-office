package com.imirae.incheon.network

import com.imirae.incheon.logging.SafeLogger
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

internal fun privacySafeKtorLogger(): Logger = object : Logger {
    override fun log(message: String) {
        // Ktor supplies a formatted request/response string here. Never pass
        // that string onward: it can contain headers or payload text.
        SafeLogger.debug("network.request")
    }
}

interface TokenProvider {
    suspend fun getAccessToken(): String?
    suspend fun refreshToken(): String?
}

class ApiClient(
    private val baseUrl: String,
    private val tokenProviderLazy: Lazy<TokenProvider?> = lazy { null },
    val rateLimitHandler: RateLimitHandler = RateLimitHandler(),
) {
    /** Convenience constructor for Swift, which cannot construct Kotlin Lazy values directly. */
    constructor(baseUrl: String, tokenProvider: TokenProvider?) : this(
        baseUrl = baseUrl,
        tokenProviderLazy = lazy { tokenProvider },
    )

    private val tokenProvider: TokenProvider? get() = tokenProviderLazy.value
    val json = Json { ignoreUnknownKeys = true; isLenient = true; encodeDefaults = true }

    val httpClient = HttpClient(platformEngine()) {
        install(ContentNegotiation) { json(this@ApiClient.json) }
        install(Logging) {
            // INFO retains request/response lifecycle visibility without asking
            // Ktor to inspect headers. The callback intentionally discards the
            // raw Ktor message and emits only a local structured debug event.
            level = LogLevel.INFO
            sanitizeHeader { header ->
                header.equals(HttpHeaders.Authorization, ignoreCase = true) ||
                    header.equals(HttpHeaders.Cookie, ignoreCase = true) ||
                    header.equals("Set-Cookie", ignoreCase = true) ||
                    header.equals("X-API-Key", ignoreCase = true)
            }
            logger = privacySafeKtorLogger()
        }
        install(HttpTimeout) { requestTimeoutMillis = 30_000; connectTimeoutMillis = 10_000 }
        defaultRequest { url(baseUrl); contentType(ContentType.Application.Json) }
    }

    suspend inline fun <reified T> get(
        path: String,
        endpointCategory: EndpointCategory = if (path.startsWith("/auth")) EndpointCategory.AUTH else EndpointCategory.READ_HEAVY,
        noinline block: HttpRequestBuilder.() -> Unit = {},
    ): ApiResult<T> = request(endpointCategory = endpointCategory) {
        httpClient.get(path) {
            addAuth()
            block()
        }
    }

    suspend inline fun <reified T> post(
        path: String,
        endpointCategory: EndpointCategory = if (path.startsWith("/auth")) EndpointCategory.AUTH else EndpointCategory.MUTATION,
        noinline block: HttpRequestBuilder.() -> Unit = {},
    ): ApiResult<T> = request(endpointCategory = endpointCategory) {
        httpClient.post(path) {
            addAuth()
            block()
        }
    }

    suspend inline fun <reified T> put(
        path: String,
        endpointCategory: EndpointCategory = if (path.startsWith("/auth")) EndpointCategory.AUTH else EndpointCategory.MUTATION,
        noinline block: HttpRequestBuilder.() -> Unit = {},
    ): ApiResult<T> = request(endpointCategory = endpointCategory) {
        httpClient.put(path) {
            addAuth()
            block()
        }
    }

    suspend inline fun <reified T> delete(
        path: String,
        endpointCategory: EndpointCategory = if (path.startsWith("/auth")) EndpointCategory.AUTH else EndpointCategory.MUTATION,
        noinline block: HttpRequestBuilder.() -> Unit = {},
    ): ApiResult<T> = request(endpointCategory = endpointCategory) {
        httpClient.delete(path) {
            addAuth()
            block()
        }
    }

    suspend inline fun <reified T> request(
        endpointCategory: EndpointCategory,
        call: () -> HttpResponse,
    ): ApiResult<T> {
        var attempt = 0

        while (true) {
            try {
                val response = call()

                if (response.status.isSuccess()) {
                    return ApiResult.Success(response.body<T>())
                }

                val statusCode = response.status.value
                val retryPlan = rateLimitHandler.planRetry(
                    statusCode = statusCode,
                    attempt = attempt,
                    endpointCategory = endpointCategory,
                    retryAfterHeader = response.headers[HttpHeaders.RetryAfter],
                )

                if (retryPlan.shouldRetry) {
                    attempt += 1
                    delay(retryPlan.delayMillis)
                    continue
                }

                return ApiResult.Error(
                    ApiError.Http(
                        code = statusCode,
                        message = response.status.description,
                        body = runCatching { response.bodyAsText() }.getOrNull(),
                    )
                )
            } catch (e: CancellationException) {
                throw e
            } catch (_: HttpRequestTimeoutException) {
                return ApiResult.Error(ApiError.Timeout())
            } catch (e: SerializationException) {
                return ApiResult.Error(ApiError.Serialization(e.message ?: "응답 파싱 실패"))
            } catch (e: Exception) {
                val message = e.message ?: e::class.simpleName ?: "Unknown"
                val className = e::class.simpleName ?: ""
                val networkIndicators = listOf(
                    "UnknownHost", "ConnectException", "SocketException",
                    "SocketTimeout", "SSLException", "SSLHandshake",
                    "Unable to resolve host", "Connection refused",
                    "Network is unreachable", "failed to connect",
                    "CLEARTEXT", "No address associated", "connect timed out",
                )
                val isNetworkError = networkIndicators.any { indicator ->
                    className.contains(indicator, ignoreCase = true) ||
                        message.contains(indicator, ignoreCase = true)
                }
                if (isNetworkError) {
                    return ApiResult.Error(ApiError.Network(message))
                }
                return ApiResult.Error(ApiError.Unknown(message))
            }
        }
    }

    suspend fun HttpRequestBuilder.addAuth() {
        tokenProvider?.getAccessToken()?.let { token ->
            header(HttpHeaders.Authorization, "Bearer $token")
        }
    }
}
