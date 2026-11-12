package world.staza.app

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import world.staza.app.core.auth.AuthState
import world.staza.app.core.auth.CredentialStore
import world.staza.app.core.auth.NativeCredentials
import world.staza.app.core.auth.SessionManager
import world.staza.app.core.auth.SessionUser
import world.staza.app.core.network.ApiClient
import world.staza.app.core.network.StazaRetrofit
import java.time.Instant

private class MemoryStore(var value: NativeCredentials? = null) : CredentialStore {
    override suspend fun load() = value
    override suspend fun save(credentials: NativeCredentials) { value = credentials }
    override suspend fun clear() { value = null }
}

private fun creds(access: String, refresh: String, refreshExpires: String = "2099-01-01T00:00:00Z") = NativeCredentials(
    accessToken = access,
    accessTokenExpiresAt = Instant.parse("2099-01-01T00:00:00Z"),
    refreshToken = refresh,
    refreshTokenExpiresAt = Instant.parse(refreshExpires),
)

private const val REFRESH_BODY = """{"credentials":{"tokenType":"Bearer","accessToken":"new","accessTokenExpiresAt":"2099-01-01T00:00:00.000Z","refreshToken":"r2","refreshTokenExpiresAt":"2099-01-01T00:00:00.000Z"}}"""

class SessionManagerTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer().apply { start() } }
    @After fun tearDown() { server.shutdown() }

    private fun service() = StazaRetrofit.create(server.url("/").toString())

    private fun manager(store: CredentialStore): Pair<SessionManager, ApiClient> {
        val manager = SessionManager(store, ApiClient(service()))
        return manager to ApiClient(service(), manager)
    }

    @Test fun bootstrapWithoutCredentialsIsSignedOut() = runTest {
        val (manager, client) = manager(MemoryStore())
        manager.bootstrap(client)
        assertEquals(AuthState.Status.SignedOut, manager.state.value.status)
        assertEquals(0, server.requestCount)
    }

    @Test fun bootstrapPublishesUser() = runTest {
        server.enqueue(MockResponse().setBody("""{"authenticated":true,"user":{"email":"a@b.c","emailVerified":true}}"""))
        val (manager, client) = manager(MemoryStore(creds("tok", "r1")))
        manager.bootstrap(client)
        assertEquals(AuthState(AuthState.Status.SignedIn, SessionUser("a@b.c", true)), manager.state.value)
        assertEquals("Bearer tok", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun unauthorizedRefreshesRotatesAndPersists() = runTest {
        val store = MemoryStore(creds("old", "r1"))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"x"}"""))
        server.enqueue(MockResponse().setBody(REFRESH_BODY))
        server.enqueue(MockResponse().setBody("""{"authenticated":true,"user":{"email":"a@b.c","emailVerified":true}}"""))
        val (manager, client) = manager(store)
        manager.bootstrap(client)
        assertEquals(AuthState.Status.SignedIn, manager.state.value.status)
        assertEquals("new", store.value?.accessToken)
        assertEquals("r2", store.value?.refreshToken)
    }

    @Test fun failedRefreshClearsCredentials() = runTest {
        val store = MemoryStore(creds("old", "r1"))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"x"}"""))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"revoked"}"""))
        val (manager, client) = manager(store)
        manager.bootstrap(client)
        assertEquals(AuthState.Status.SignedOut, manager.state.value.status)
        assertNull(store.value)
    }

    @Test fun expiredRefreshTokenSignsOutWithoutNetworkRefresh() = runTest {
        val store = MemoryStore(creds("old", "r1", refreshExpires = "2000-01-01T00:00:00Z"))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"x"}"""))
        val (manager, client) = manager(store)
        manager.bootstrap(client)
        assertEquals(AuthState.Status.SignedOut, manager.state.value.status)
        assertNull(store.value)
        assertEquals(1, server.requestCount)
    }

    @Test fun logoutClearsEvenWhenServerFails() = runTest {
        val store = MemoryStore()
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":"boom"}"""))
        val (manager, client) = manager(store)
        manager.signIn(creds("tok", "r1"), SessionUser("a@b.c", true))
        assertEquals(AuthState.Status.SignedIn, manager.state.value.status)
        manager.logout(client)
        assertEquals(AuthState.Status.SignedOut, manager.state.value.status)
        assertNull(store.value)
    }

    @Test fun offlineBootstrapKeepsCredentials() = runTest {
        val store = MemoryStore(creds("tok", "r1"))
        val (manager, client) = manager(store)
        server.shutdown()
        manager.bootstrap(client)
        assertEquals(AuthState.Status.SignedIn, manager.state.value.status)
        assertEquals("tok", store.value?.accessToken)
    }
}
