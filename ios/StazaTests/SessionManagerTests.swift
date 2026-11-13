import XCTest
@testable import Staza

@MainActor
final class SessionManagerTests: XCTestCase {
    private func makeStack(_ stubs: [StubTransport.Stub], store: MemoryCredentialStore) -> (StubTransport, APIClient, SessionManager, AuthState) {
        let transport = StubTransport(stubs)
        let state = AuthState()
        let manager = SessionManager(store: store, refreshClient: APIClient(baseURL: baseURL, transport: transport), authState: state)
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: manager)
        return (transport, client, manager, state)
    }

    func testRefreshRotatesCredentialsAndRetriesOnce() async throws {
        let store = MemoryCredentialStore(makeCredentials())
        let (transport, client, _, _) = makeStack([
            .init(status: 401, body: #"{"error":"Sign in is required."}"#),
            .init(status: 200, body: credentialsJSON(access: "access-2", refresh: "refresh-2")),
            .init(status: 200, body: #"{"ok":true}"#)
        ], store: store)

        let result: Ping = try await client.get("/api/x")
        XCTAssertEqual(result, Ping(ok: true))
        XCTAssertEqual(transport.requests.count, 3)
        XCTAssertEqual(transport.authorization(at: 0), "Bearer access-1")
        XCTAssertEqual(transport.requests[1].url?.path, "/api/auth/native/refresh")
        XCTAssertNil(transport.authorization(at: 1))
        XCTAssertEqual(String(data: transport.requests[1].httpBody!, encoding: .utf8), #"{"refreshToken":"refresh-1"}"#)
        XCTAssertEqual(transport.authorization(at: 2), "Bearer access-2")
        XCTAssertEqual(store.load()?.refreshToken, "refresh-2")
    }

    func testRefreshFailureClearsSession() async throws {
        let store = MemoryCredentialStore(makeCredentials())
        let (_, client, _, state) = makeStack([
            .init(status: 401, body: #"{"error":"Sign in is required."}"#),
            .init(status: 401, body: #"{"error":"Invalid refresh token."}"#)
        ], store: store)
        let result: Result<Ping, Error> = await { do { return .success(try await client.get("/api/x")) } catch { return .failure(error) } }()
        if case .success = result { XCTFail("expected failure") }
        XCTAssertNil(store.load())
        XCTAssertEqual(state.status, .signedOut)
    }

    func testRetryStillUnauthorizedClearsSessionWithoutThirdAttempt() async {
        let store = MemoryCredentialStore(makeCredentials())
        let (transport, client, _, state) = makeStack([
            .init(status: 401, body: #"{"error":"no"}"#),
            .init(status: 200, body: credentialsJSON(access: "access-2", refresh: "refresh-2")),
            .init(status: 401, body: #"{"error":"still no"}"#)
        ], store: store)
        do {
            let _: Ping = try await client.get("/api/x")
            XCTFail("expected error")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized(message: "still no"))
        }
        XCTAssertEqual(transport.requests.count, 3)
        XCTAssertNil(store.load())
        XCTAssertEqual(state.status, .signedOut)
    }

    func testBootstrapWithoutCredentialsIsSignedOut() async {
        let (transport, client, manager, state) = makeStack([], store: MemoryCredentialStore())
        await manager.bootstrap(using: client)
        XCTAssertEqual(state.status, .signedOut)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testBootstrapLoadsCurrentUser() async {
        let (_, client, manager, state) = makeStack(
            [.init(status: 200, body: #"{"authenticated":true,"user":{"email":"a@b.c","emailVerified":true}}"#)],
            store: MemoryCredentialStore(makeCredentials())
        )
        await manager.bootstrap(using: client)
        XCTAssertEqual(state.status, .signedIn)
        XCTAssertEqual(state.user, SessionUser(email: "a@b.c", emailVerified: true))
    }

    func testLogoutFailureStillClearsLocalSession() async throws {
        let store = MemoryCredentialStore(makeCredentials())
        let (transport, client, manager, state) = makeStack([.init(status: 500, body: #"{"error":"down"}"#)], store: store)
        try await manager.signIn(credentials: makeCredentials(), user: nil)
        await manager.logout(using: client)
        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertNil(store.load())
        XCTAssertEqual(state.status, .signedOut)
    }

    func testConcurrentUnauthorizedRequestsShareOneRefresh() async throws {
        final class RotatingTransport: HTTPTransport, @unchecked Sendable {
            private let lock = NSLock()
            private(set) var refreshCount = 0
            func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
                let path = request.url!.path
                func respond(_ status: Int, _ body: String) -> (Data, HTTPURLResponse) {
                    (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
                }
                if path == "/api/auth/native/refresh" {
                    lock.withLock { refreshCount += 1 }
                    try await Task.sleep(for: .milliseconds(50))
                    return respond(200, credentialsJSON(access: "access-2", refresh: "refresh-2"))
                }
                if request.value(forHTTPHeaderField: "Authorization") == "Bearer access-2" { return respond(200, #"{"ok":true}"#) }
                // Keep both stale requests in flight together before either is rejected.
                try await Task.sleep(for: .milliseconds(20))
                return respond(401, #"{"error":"expired"}"#)
            }
        }
        let transport = RotatingTransport()
        let store = MemoryCredentialStore(makeCredentials())
        let manager = SessionManager(store: store, refreshClient: APIClient(baseURL: baseURL, transport: transport), authState: AuthState())
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: manager)

        async let first: Ping = client.get("/api/a")
        async let second: Ping = client.get("/api/b")
        let results = try await [first, second]
        XCTAssertEqual(results, [Ping(ok: true), Ping(ok: true)])
        XCTAssertEqual(transport.refreshCount, 1)
        XCTAssertEqual(store.load()?.refreshToken, "refresh-2")
    }

    func testLogoutClearsSession() async throws {
        let store = MemoryCredentialStore(makeCredentials())
        let (transport, client, manager, state) = makeStack([.init(status: 204, body: "")], store: store)
        try await manager.signIn(credentials: makeCredentials(), user: nil)
        XCTAssertEqual(state.status, .signedIn)
        await manager.logout(using: client)
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/auth/logout")
        XCTAssertNil(store.load())
        XCTAssertEqual(state.status, .signedOut)
    }
}
