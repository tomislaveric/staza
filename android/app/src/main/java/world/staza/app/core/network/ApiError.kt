package world.staza.app.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The standard backend error envelope: `{ "error": "...", "code"?: "..." }`. */
@Serializable
data class ApiErrorEnvelope(
    @SerialName("error") val error: String,
    @SerialName("code") val code: String? = null,
)

sealed class ApiError(message: String?, cause: Throwable? = null) : Exception(message, cause) {
    class InvalidResponse : ApiError("The server returned an invalid response.")

    class Unauthorized(message: String?) : ApiError(message ?: "Sign in is required.")

    class Server(val status: Int, message: String, val code: String?) : ApiError(message)

    class Decoding(detail: String, cause: Throwable? = null) :
        ApiError("The response could not be read: $detail", cause)

    class Transport(detail: String?, cause: Throwable? = null) :
        ApiError(detail ?: "The network request failed.", cause)
}
