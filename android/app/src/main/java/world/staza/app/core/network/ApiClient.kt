package world.staza.app.core.network

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

@Serializable
object EmptyResponse

/**
 * JSON client. Attaches bearer credentials, decodes the `{ "error" }` envelope
 * into [ApiError], and on 401 asks the [TokenProvider] to refresh and retries the
 * request at most once. Mirrors the iOS `APIClient`.
 */
class ApiClient(
    private val service: StazaService,
    private val tokenProvider: TokenProvider = NoTokenProvider,
    @PublishedApi internal val json: Json = DefaultJson,
) {
    suspend inline fun <reified R> get(
        path: String,
        query: Map<String, String> = emptyMap(),
    ): R = request("GET", path, query, null, true, serializer<R>())

    suspend inline fun <reified B, reified R> post(
        path: String,
        body: B,
        authenticated: Boolean = true,
    ): R = request("POST", path, emptyMap(), json.encodeToString(serializer<B>(), body), authenticated, serializer<R>())

    suspend inline fun <reified R> post(path: String, authenticated: Boolean = true): R =
        request("POST", path, emptyMap(), "", authenticated, serializer<R>())

    @PublishedApi
    internal suspend fun <R> request(
        method: String,
        path: String,
        query: Map<String, String>,
        body: String?,
        authenticated: Boolean,
        responseSerializer: KSerializer<R>,
    ): R {
        val token = if (authenticated) tokenProvider.accessToken() else null
        try {
            return execute(method, path, query, body, token, responseSerializer)
        } catch (e: ApiError.Unauthorized) {
            // A 401 without a token being sent means we are signed out; nothing to refresh.
            if (!authenticated || token == null) throw e
            val refreshed = tokenProvider.refreshAfterUnauthorized(token) ?: throw e
            try {
                return execute(method, path, query, body, refreshed, responseSerializer)
            } catch (retry: ApiError.Unauthorized) {
                tokenProvider.sessionRejected()
                throw retry
            }
        }
    }

    private suspend fun <R> execute(
        method: String,
        path: String,
        query: Map<String, String>,
        body: String?,
        token: String?,
        responseSerializer: KSerializer<R>,
    ): R {
        val bearer = BearerToken(token)
        val response = try {
            if (method == "GET") {
                service.get(path, query, bearer)
            } else {
                service.post(path, (body ?: "").toRequestBody(JSON_MEDIA_TYPE), bearer)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw ApiError.Transport(e.message, e)
        }

        val raw = try {
            (if (response.isSuccessful) response.body() else response.errorBody())?.string().orEmpty()
        } catch (e: IOException) {
            throw ApiError.Transport(e.message, e)
        }

        if (!response.isSuccessful) {
            val envelope = runCatching { json.decodeFromString(ApiErrorEnvelope.serializer(), raw) }.getOrNull()
            if (response.code() == 401) throw ApiError.Unauthorized(envelope?.error)
            throw ApiError.Server(response.code(), envelope?.error ?: response.message(), envelope?.code)
        }

        if (raw.isEmpty() || response.code() == 204) {
            @Suppress("UNCHECKED_CAST")
            if (responseSerializer.descriptor.serialName == EmptyResponse.serializer().descriptor.serialName) {
                return EmptyResponse as R
            }
            throw ApiError.Decoding("empty response body")
        }
        return try {
            json.decodeFromString(responseSerializer, raw)
        } catch (e: Exception) {
            throw ApiError.Decoding(e.message ?: e.toString(), e)
        }
    }

    companion object {
        val DefaultJson = Json { ignoreUnknownKeys = true; explicitNulls = false }
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }
}
