import XCTest
@testable import Staza

@MainActor
final class ProfileModelTests: XCTestCase {
    private final class NoPasskeys: PasskeyAuthorizing {
        func assertion(for options: PasskeyLoginOptions) async throws -> PasskeyAssertionResponse { throw PasskeyError.cancelled }
        func registration(for options: PasskeyRegistrationOptions, name: String?) async throws -> PasskeyAttestationResponse { throw PasskeyError.cancelled }
    }

    private func makeModel(_ stubs: [StubTransport.Stub]) -> (ProfileModel, StubTransport, AuthState, MemoryCredentialStore) {
        let transport = StubTransport(stubs)
        let state = AuthState()
        let store = MemoryCredentialStore(makeCredentials())
        let manager = SessionManager(store: store, refreshClient: APIClient(baseURL: baseURL, transport: transport), authState: state)
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: manager)
        let auth = AuthService(api: client, session: manager, passkeys: NoPasskeys())
        return (ProfileModel(api: client, auth: auth), transport, state, store)
    }

    private let profileJSON = #"{"displayName":"Ada","progress":{"totalXp":120,"level":3,"progressPercent":40},"distanceMeters":5000,"activityCount":2,"flowlineCount":1,"collectibles":{"totalCollectibles":10,"discoveredCount":4}}"#

    func testLoadFetchesProfileCapabilitiesAndPasskeys() async {
        let (model, transport, _, _) = makeModel([
            .init(status: 200, body: profileJSON),
            .init(status: 200, body: #"{"titles":[{"id":"t","label":"Scout"}],"badges":[]}"#),
            .init(status: 200, body: #"[{"id":"p1","name":"Phone","createdAt":"2026-01-01T00:00:00Z","lastUsedAt":null}]"#)
        ])
        await model.load()
        XCTAssertEqual(model.profile?.displayName, "Ada")
        XCTAssertEqual(model.capabilities?.titles.map(\.label), ["Scout"])
        XCTAssertEqual(model.passkeys.map(\.id), ["p1"])
        XCTAssertEqual(transport.requests.map { $0.url?.path }, ["/api/player/profile", "/api/player/capabilities", "/api/auth/passkeys"])
    }

    func testDeleteAccountUsesIntentTokenAndSignsOut() async {
        let (model, transport, state, store) = makeModel([
            .init(status: 201, body: #"{"confirmationToken":"tok","expiresAt":"2030-01-01T00:00:00Z"}"#),
            .init(status: 204, body: ""),
            .init(status: 204, body: "")
        ])
        await model.deleteAccount()
        XCTAssertEqual(transport.requests.map { $0.url?.path }, ["/api/account/deletion-intent", "/api/account/delete", "/api/auth/logout"])
        XCTAssertEqual(String(data: transport.requests[1].httpBody ?? Data(), encoding: .utf8), #"{"confirmationToken":"tok"}"#)
        XCTAssertNil(store.load())
        XCTAssertNotEqual(state.status, .signedIn)
    }

    func testExportRequiresStepUpErrorSurfacedAndWritesFileOnSuccess() async throws {
        let (failing, _, _, _) = makeModel([.init(status: 400, body: #"{"error":"Recent step-up authentication is required."}"#)])
        await failing.exportData()
        XCTAssertEqual(failing.actionError, "Recent step-up authentication is required.")
        XCTAssertNil(failing.exportURL)

        let (model, _, _, _) = makeModel([.init(status: 200, body: #"{"user":{"email":"a@b.c"},"activities":[]}"#)])
        await model.exportData()
        let url = try XCTUnwrap(model.exportURL)
        XCTAssertTrue(try String(contentsOf: url, encoding: .utf8).contains("a@b.c"))
        model.clearExport()
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }

    func testLogoutAllCallsLogoutAllEndpoint() async {
        let (model, transport, _, store) = makeModel([.init(status: 204, body: "")])
        await model.logout(everywhere: true)
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/auth/logout-all")
        XCTAssertNil(store.load())
    }
}
