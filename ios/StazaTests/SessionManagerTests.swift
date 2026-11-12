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
