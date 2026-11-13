import Foundation
import Observation

struct PendingFitImport: Equatable, Sendable {
    let id = UUID()
    let fileName: String
    let fileURL: URL
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
    /// Bumped whenever player data changes (import, unlock, exploration confirm) so tabs can reload.
    private(set) var dataRevision = 0

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
        guard let staged = try? FitFileStaging.stage(url) else { return }
        // A newer share replaces one that has not been picked up yet.
        if let previous = pendingImport { FitFileStaging.discard(previous.fileURL) }
        pendingImport = PendingFitImport(fileName: url.lastPathComponent, fileURL: staged)
    }

    func playerDataChanged() {
        dataRevision += 1
    }

    func bootstrap() async {
        await sessionManager.bootstrap(using: apiClient)
    }
}
