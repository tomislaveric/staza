package world.staza.app.core.auth

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import world.staza.app.core.network.ApiClient
import world.staza.app.core.network.ApiError
import world.staza.app.core.network.EmptyResponse
import world.staza.app.core.network.TokenProvider
import java.time.Instant

/** Observable authentication state. `Unknown` until the session is restored at launch. */
data class AuthState(val status: Status = Status.Unknown, val user: SessionUser? = null) {
    enum class Status { Unknown, SignedIn, SignedOut }
}

/**
 * Owns native credentials. Implements [TokenProvider] for the API client and
 * publishes [AuthState]. It refreshes through an unauthenticated client, so it
 * never depends on the authenticated client (no cycle).
 */
class SessionManager(
    private val store: CredentialStore,
    private val refreshClient: ApiClient,
    private val now: () -> Instant = Instant::now,
) : TokenProvider {
    private val mutex = Mutex()
    private var loaded = false
    private var credentials: NativeCredentials? = null

    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    // TokenProvider

    override suspend fun accessToken(): String? = mutex.withLock { current()?.accessToken }

    override suspend fun refreshAfterUnauthorized(rejectedToken: String?): String? = mutex.withLock {
        // Another request already rotated the credentials.
        current()?.accessToken?.let { if (it != rejectedToken) return@withLock it }
        performRefresh()
    }

    override suspend fun sessionRejected() = mutex.withLock { clearSession() }

    // Lifecycle

    /** Restores state at launch using the authenticated API client. */
    suspend fun bootstrap(client: ApiClient) {
        if (mutex.withLock { current() } == null) {
            _state.value = AuthState(AuthState.Status.SignedOut)
            return
        }
        try {
            val session: SessionResponse = client.get("/api/auth/session")
            if (session.authenticated) {
                _state.value = AuthState(AuthState.Status.SignedIn, session.user)
            } else {
                mutex.withLock { clearSession() }
            }
        } catch (e: ApiError.Unauthorized) {
            mutex.withLock { clearSession() }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Offline or transient failure: keep credentials and stay signed in.
            _state.value = AuthState(AuthState.Status.SignedIn, null)
        }
    }

    /** Called by a future auth UI after a successful native sign-in. */
    suspend fun signIn(credentials: NativeCredentials, user: SessionUser?) = mutex.withLock {
        store.save(credentials)
        this.credentials = credentials
        loaded = true
        _state.value = AuthState(AuthState.Status.SignedIn, user)
    }

    suspend fun logout(client: ApiClient) {
        try {
            client.post<EmptyResponse>("/api/auth/logout")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Sign out locally regardless of the server result.
        }
        mutex.withLock { clearSession() }
    }

    // Private (callers hold the mutex)

    private suspend fun current(): NativeCredentials? {
        if (!loaded) {
            credentials = store.load()
            loaded = true
        }
        return credentials
    }

    private suspend fun performRefresh(): String? {
        val existing = current()
        if (existing == null || existing.refreshTokenIsExpired(now())) {
            clearSession()
            return null
        }
        return try {
            val response: RefreshResponse = refreshClient.post(
                "/api/auth/native/refresh",
                RefreshRequest(existing.refreshToken),
                authenticated = false,
            )
            store.save(response.credentials)
            credentials = response.credentials
            response.credentials.accessToken
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            clearSession()
            null
        }
    }

    private suspend fun clearSession() {
        credentials = null
        loaded = true
        store.clear()
        _state.value = AuthState(AuthState.Status.SignedOut)
    }
}
