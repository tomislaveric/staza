import Foundation
import Observation

/// Composition root. The refresh client is unauthenticated and the main client
/// is authenticated by the session manager, which keeps the two from forming a
/// dependency cycle.
@MainActor
@Observable
final class AppContainer {
    let authState = AuthState()
    let apiClient: APIClient
    let sessionManager: SessionManager
    let authService: AuthService

    init(
        baseURL: URL = APIEnvironment.resolvedBaseURL(),
        transport: HTTPTransport = URLSession.shared,
        store: CredentialStore = KeychainCredentialStore(),
        passkeys: PasskeyAuthorizing? = nil
    ) {
        let refreshClient = APIClient(baseURL: baseURL, transport: transport)
        let manager = SessionManager(store: store, refreshClient: refreshClient, authState: authState)
        sessionManager = manager
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: manager)
        apiClient = client
        authService = AuthService(api: client, session: manager, passkeys: passkeys ?? SystemPasskeyAuthorizer())
    }

    func bootstrap() async {
        await sessionManager.bootstrap(using: apiClient)
    }
}
