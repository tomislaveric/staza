package world.staza.app

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import world.staza.app.core.network.ApiClient
import world.staza.app.core.network.ApiError
import world.staza.app.core.network.EmptyResponse
import world.staza.app.core.network.StazaRetrofit
import world.staza.app.core.network.TokenProvider

@Serializable
private data class Ping(val ok: Boolean)

@Serializable
private data class Body(val name: String)

private class FakeTokens(var token: String?, var refreshed: String?) : TokenProvider {
    var refreshCalls = 0
    var rejected = false
    override suspend fun accessToken() = token
    override suspend fun refreshAfterUnauthorized(rejectedToken: String?): String? {
        refreshCalls++
        token = refreshed
        return refreshed
    }
    override suspend fun sessionRejected() { rejected = true }
}

class ApiClientTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer().apply { start() } }
    @After fun tearDown() { server.shutdown() }

    private fun client(tokens: TokenProvider) =
        ApiClient(StazaRetrofit.create(server.url("/").toString()), tokens)

    @Test fun getAttachesBearerAndNativeHeader() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true,"extra":1}"""))
        val result: Ping = client(FakeTokens("abc", null)).get("/api/ping", mapOf("a" to "b"))
        assertTrue(result.ok)
        val request = server.takeRequest()
        assertEquals("Bearer abc", request.getHeader("Authorization"))
        assertEquals("native", request.getHeader("X-Staza-Client"))
        assertEquals("/api/ping?a=b", request.path)
    }

    @Test fun postSendsJsonBody() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        val result: Ping = client(FakeTokens(null, null)).post("/api/x", Body("n"), authenticated = false)
        assertTrue(result.ok)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("""{"name":"n"}""", request.body.readUtf8())
        assertNull(request.getHeader("Authorization"))
    }

    @Test fun mapsErrorEnvelope() = runTest {
        server.enqueue(MockResponse().setResponseCode(422).setBody("""{"error":"Bad input","code":"invalid"}"""))
        val error = runCatching { client(FakeTokens(null, null)).get<Ping>("/api/x") }.exceptionOrNull()
        error as ApiError.Server
        assertEquals(422, error.status)
        assertEquals("Bad input", error.message)
        assertEquals("invalid", error.code)
    }

    @Test fun emptyResponseDecodesAsEmpty() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))
        val result: EmptyResponse = client(FakeTokens("t", null)).post("/api/auth/logout")
        assertEquals(EmptyResponse, result)
    }

    @Test fun refreshesAndRetriesOnce() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"Sign in is required."}"""))
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        val tokens = FakeTokens("old", "new")
        val result: Ping = client(tokens).get("/api/x")
        assertTrue(result.ok)
        assertEquals(1, tokens.refreshCalls)
        assertEquals("Bearer old", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer new", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun secondUnauthorizedRejectsSession() = runTest {
        repeat(2) { server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"nope"}""")) }
        val tokens = FakeTokens("old", "new")
        assertThrows(ApiError.Unauthorized::class.java) { kotlinx.coroutines.runBlocking { client(tokens).get<Ping>("/api/x") } }
        assertEquals(1, tokens.refreshCalls)
        assertTrue(tokens.rejected)
        assertEquals(2, server.requestCount)
    }

    @Test fun failedRefreshSurfacesUnauthorizedWithoutRetry() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"nope"}"""))
        val tokens = FakeTokens("old", null)
        assertThrows(ApiError.Unauthorized::class.java) { kotlinx.coroutines.runBlocking { client(tokens).get<Ping>("/api/x") } }
        assertEquals(1, server.requestCount)
    }

    @Test fun unauthorizedWithoutTokenDoesNotRefresh() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"nope"}"""))
        val tokens = FakeTokens(null, "new")
        assertThrows(ApiError.Unauthorized::class.java) { kotlinx.coroutines.runBlocking { client(tokens).get<Ping>("/api/x") } }
        assertEquals(0, tokens.refreshCalls)
    }
}
