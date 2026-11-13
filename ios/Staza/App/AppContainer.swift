import Foundation
import Observation

struct PendingFitImport: Equatable, Sendable {
    let fileName: String
    let data: Data
}

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
    /// A .fit handed to the app from the share sheet / "Open in"; consumed by Add Activity.
    var pendingImport: PendingFitImport?

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

    func receive(fileURL url: URL) {
        guard url.pathExtension.lowercased() == "fit" else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        pendingImport = PendingFitImport(fileName: url.lastPathComponent, data: data)
    }

    func bootstrap() async {
        await sessionManager.bootstrap(using: apiClient)
    }
}
