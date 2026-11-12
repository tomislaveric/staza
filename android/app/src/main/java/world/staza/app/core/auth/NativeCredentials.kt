package world.staza.app.core.auth

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant

object InstantSerializer : KSerializer<Instant> {
    override val descriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder): Instant = Instant.parse(decoder.decodeString())
    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(value.toString())
}

/** Credentials returned by the backend for native clients (`X-Staza-Client: native`). */
@Serializable
data class NativeCredentials(
    val tokenType: String = "Bearer",
    val accessToken: String,
    @Serializable(with = InstantSerializer::class) val accessTokenExpiresAt: Instant,
    val refreshToken: String,
    @Serializable(with = InstantSerializer::class) val refreshTokenExpiresAt: Instant,
) {
    fun refreshTokenIsExpired(now: Instant = Instant.now()): Boolean = !refreshTokenExpiresAt.isAfter(now)
}

@Serializable
data class SessionUser(val email: String, val emailVerified: Boolean)

/** `GET /api/auth/session` */
@Serializable
data class SessionResponse(val authenticated: Boolean, val user: SessionUser? = null)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class RefreshResponse(val credentials: NativeCredentials)
