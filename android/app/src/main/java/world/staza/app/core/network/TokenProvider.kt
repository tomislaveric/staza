package world.staza.app.core.network

/**
 * Supplies and renews bearer credentials for [ApiClient]. Implemented by the
 * session manager; the API client never touches credential storage directly.
 */
interface TokenProvider {
    suspend fun accessToken(): String?

    /**
     * Called after a 401. Returns a fresh access token, or null when the
     * session can no longer be refreshed.
     */
    suspend fun refreshAfterUnauthorized(rejectedToken: String?): String?

    /** Called when a retried request is still unauthorized. */
    suspend fun sessionRejected()
}

object NoTokenProvider : TokenProvider {
    override suspend fun accessToken(): String? = null
    override suspend fun refreshAfterUnauthorized(rejectedToken: String?): String? = null
    override suspend fun sessionRejected() = Unit
}
