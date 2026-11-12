import Foundation

/// Composition root. The refresh client is unauthenticated and the main client
/// is authenticated by the session manager, which keeps the two from forming a
/// dependency cycle.
@MainActor
final class AppContainer {
    let authState = AuthState()
    let apiClient: APIClient
    let sessionManager: SessionManager

    init(
        baseURL: URL = APIEnvironment.resolvedBaseURL(),
        transport: HTTPTransport = URLSession.shared,
        store: CredentialStore = KeychainCredentialStore()
    ) {
        let refreshClient = APIClient(baseURL: baseURL, transport: transport)
        let manager = SessionManager(store: store, refreshClient: refreshClient, authState: authState)
        sessionManager = manager
        apiClient = APIClient(baseURL: baseURL, transport: transport, tokenProvider: manager)
    }

    func bootstrap() async {
        await sessionManager.bootstrap(using: apiClient)
    }
}
