import XCTest
@testable import Staza

@MainActor
final class AuthServiceTests: XCTestCase {
    private final class FakePasskeys: PasskeyAuthorizing {
        var error: Error?
        func assertion(for options: PasskeyLoginOptions) async throws -> PasskeyAssertionResponse {
            if let error { throw error }
            return PasskeyAssertionResponse(id: "cred", rawId: "cred", response: .init(clientDataJSON: "c", authenticatorData: "a", signature: "s", userHandle: nil))
        }
        func registration(for options: PasskeyRegistrationOptions, name: String?) async throws -> PasskeyAttestationResponse {
            if let error { throw error }
            return PasskeyAttestationResponse(id: "cred", rawId: "cred", response: .init(clientDataJSON: "c", attestationObject: "o"), name: name)
        }
    }

    private func makeService(_ stubs: [StubTransport.Stub], store: MemoryCredentialStore = MemoryCredentialStore(), passkeys: FakePasskeys? = nil) -> (AuthService, StubTransport, AuthState, MemoryCredentialStore) {
        let transport = StubTransport(stubs)
        let state = AuthState()
        let manager = SessionManager(store: store, refreshClient: APIClient(baseURL: baseURL, transport: transport), authState: state)
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: manager)
        return (AuthService(api: client, session: manager, passkeys: passkeys ?? FakePasskeys()), transport, state, store)
    }

    private let loginOptions = #"{"challenge":"Y2hhbGxlbmdl","rpId":"play.staza.world"}"#

    func testPasskeySignInStoresCredentialsAndSignsIn() async throws {
        let body = #"{"authenticated":true,"user":{"email":"a@b.c","emailVerified":true},"credentials":"#
            + credentialsJSON(access: "acc", refresh: "ref").dropFirst(#"{"credentials":"#.count)
        let (service, transport, state, store) = makeService([
            .init(status: 200, body: loginOptions),
            .init(status: 200, body: body)
        ])
        try await service.signInWithPasskey()
        XCTAssertEqual(transport.requests.map { $0.url?.path }, ["/api/auth/passkeys/login/options", "/api/auth/passkeys/login/verify"])
        XCTAssertNil(transport.authorization(at: 1))
        XCTAssertEqual(state.status, .signedIn)
        XCTAssertEqual(state.user?.email, "a@b.c")
        XCTAssertEqual(store.load()?.accessToken, "acc")
    }

    func testCancelledPasskeySheetDoesNotSignIn() async {
        let passkeys = FakePasskeys()
        passkeys.error = PasskeyError.cancelled
        let (service, transport, state, _) = makeService([.init(status: 200, body: loginOptions)], passkeys: passkeys)
        do { try await service.signInWithPasskey(); XCTFail("expected throw") } catch { XCTAssertEqual(error as? PasskeyError, .cancelled) }
        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertNotEqual(state.status, .signedIn)
    }

    func testPasskeyRegistrationRotatesCredentialsAndClearsPendingSetup() async throws {
        let store = MemoryCredentialStore(makeCredentials())
        let (service, transport, _, _) = makeService([
            .init(status: 200, body: #"{"challenge":"Y2hhbGxlbmdl","rp":{"id":"play.staza.world"},"user":{"id":"dXNlcg","name":"a@b.c"}}"#),
            .init(status: 200, body: credentialsJSON(access: "access-2", refresh: "refresh-2"))
        ], store: store)
        service.passkeySetupPending = true
        try await service.registerPasskey(name: "iPhone")
        XCTAssertEqual(transport.authorization(at: 0), "Bearer access-1")
        XCTAssertEqual(store.load()?.accessToken, "access-2")
        XCTAssertFalse(service.passkeySetupPending)
    }

    func testEmailRegistrationVerifyRequestsPasskeySetup() async throws {
        let (service, _, state, _) = makeService([.init(status: 200, body: credentialsJSON(access: "acc", refresh: "ref"))])
        try await service.verifyCode(email: "a@b.c", code: "123456", registering: true)
        XCTAssertEqual(state.status, .signedIn)
        XCTAssertTrue(service.passkeySetupPending)
    }

    func testBase64URLRoundTrip() {
        let data = Data([0xfb, 0xff, 0xfe, 0x01])
        XCTAssertEqual(data.base64URLEncoded, "-__-AQ")
        XCTAssertEqual(Data(base64URLEncoded: "-__-AQ"), data)
    }
}
