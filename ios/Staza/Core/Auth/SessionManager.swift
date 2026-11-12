import Foundation

/// Owns native credentials. Implements `TokenProvider` for the API client and
/// publishes state through `AuthState`. It refreshes through an unauthenticated
/// client, so it never depends on the authenticated client (no cycle).
actor SessionManager: TokenProvider {
    private let store: CredentialStore
    private let refreshClient: APIClient
    private let authState: AuthState
    private var credentials: NativeCredentials?
    private var refreshTask: Task<String?, Never>?

    init(store: CredentialStore, refreshClient: APIClient, authState: AuthState) {
        self.store = store
        self.refreshClient = refreshClient
        self.authState = authState
        self.credentials = store.load()
    }

    // MARK: TokenProvider

    func accessToken() async -> String? { credentials?.accessToken }

    func refreshAfterUnauthorized(rejectedToken: String?) async -> String? {
        // Another request already rotated the credentials.
        if let current = credentials?.accessToken, current != rejectedToken { return current }
        if let refreshTask { return await refreshTask.value }
        let task = Task { await self.performRefresh() }
        refreshTask = task
        let token = await task.value
        refreshTask = nil
        return token
    }

    func sessionRejected() async {
        await clearSession()
    }

    // MARK: Lifecycle

    /// Restores state at launch. Pass the authenticated API client.
    func bootstrap(using client: APIClient) async {
        guard credentials != nil else {
            await publish(.signedOut, user: nil)
            return
        }
        do {
            let session: SessionResponse = try await client.get("/api/auth/session")
            if session.authenticated {
                await publish(.signedIn, user: session.user)
            } else {
                await clearSession()
            }
        } catch APIError.unauthorized {
            await clearSession()
        } catch {
            // Offline or transient failure: keep credentials and stay signed in.
            await publish(.signedIn, user: nil)
        }
    }

    /// Called by a future auth UI after a successful native sign-in.
    func signIn(credentials: NativeCredentials, user: SessionUser?) async throws {
        try store.save(credentials)
        self.credentials = credentials
        await publish(.signedIn, user: user)
    }

    func logout(using client: APIClient) async {
        let _: EmptyResponse? = try? await client.post("/api/auth/logout")
        await clearSession()
    }

    // MARK: Private

    private func performRefresh() async -> String? {
        guard let current = credentials, !current.refreshTokenIsExpired else {
            await clearSession()
            return nil
        }
        do {
            let response: RefreshResponse = try await refreshClient.post(
                "/api/auth/native/refresh",
                body: RefreshRequest(refreshToken: current.refreshToken),
                authenticated: false
            )
            try store.save(response.credentials)
            credentials = response.credentials
            return response.credentials.accessToken
        } catch {
            await clearSession()
            return nil
        }
    }

    private func clearSession() async {
        credentials = nil
        store.clear()
        await publish(.signedOut, user: nil)
    }

    private func publish(_ status: AuthState.Status, user: SessionUser?) async {
        await MainActor.run { authState.update(status: status, user: user) }
    }
}
