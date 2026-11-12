import Foundation
import Observation

/// Orchestrates native sign-in/registration against the E0 auth endpoints and
/// hands the resulting credentials to the `SessionManager`.
@MainActor
@Observable
final class AuthService {
    enum AuthFlowError: Error, Equatable { case missingCredentials }

    private let api: APIClient
    private let session: SessionManager
    private let passkeys: PasskeyAuthorizing

    /// Set after registration when the server asks the user to add a passkey.
    var passkeySetupPending = false

    init(api: APIClient, session: SessionManager, passkeys: PasskeyAuthorizing) {
        self.api = api
        self.session = session
        self.passkeys = passkeys
    }

    // MARK: Email code

    func requestCode(email: String, registering: Bool) async throws {
        let path = registering ? "/api/auth/register/code" : "/api/auth/email-code/request"
        let _: EmptyResponse = try await api.post(path, body: EmailCodeRequest(email: email), authenticated: false)
    }

    func verifyCode(email: String, code: String, registering: Bool) async throws {
        let path = registering ? "/api/auth/register/verify" : "/api/auth/email-code/verify"
        let response: SignInResponse = try await api.post(
            path, body: EmailCodeVerifyRequest(email: email, code: code), authenticated: false
        )
        guard let credentials = response.credentials else { throw AuthFlowError.missingCredentials }
        try await session.signIn(credentials: credentials, user: response.user ?? SessionUser(email: email, emailVerified: true))
        passkeySetupPending = registering
    }

    // MARK: Passkeys

    func signInWithPasskey() async throws {
        let options: PasskeyLoginOptions = try await api.post("/api/auth/passkeys/login/options", body: EmptyResponse(), authenticated: false)
        let assertion = try await passkeys.assertion(for: options)
        let response: SignInResponse = try await api.post("/api/auth/passkeys/login/verify", body: assertion, authenticated: false)
        guard let credentials = response.credentials else { throw AuthFlowError.missingCredentials }
        try await session.signIn(credentials: credentials, user: response.user)
    }

    func registerPasskey(name: String? = nil) async throws {
        let options: PasskeyRegistrationOptions = try await api.post("/api/auth/passkeys/register/options")
        let attestation = try await passkeys.registration(for: options, name: name)
        let response: PasskeyRegisterResponse = try await api.post("/api/auth/passkeys/register/verify", body: attestation)
        if let credentials = response.credentials { try await session.replaceCredentials(credentials) }
        passkeySetupPending = false
    }

    func listPasskeys() async throws -> [PasskeyInfo] { try await api.get("/api/auth/passkeys") }
    func deletePasskey(id: String) async throws { try await api.delete("/api/auth/passkeys/\(id)") }

    // MARK: Step-up

    func requestStepUp() async throws {
        let _: EmptyResponse = try await api.post("/api/auth/step-up/email/request")
    }

    func verifyStepUp(code: String) async throws {
        let _: EmptyResponse = try await api.post("/api/auth/step-up/email/verify", body: StepUpVerifyRequest(code: code))
    }

    func logout(everywhere: Bool) async {
        await session.logout(using: api, everywhere: everywhere)
    }
}
