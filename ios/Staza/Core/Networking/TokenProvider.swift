import Foundation

/// Boundary between the networking layer and session management. The API
/// client depends only on this protocol; the session store implements it, so
/// session bootstrap (which itself calls the API) never creates a cycle.
protocol TokenProvider: Sendable {
    /// Access token to attach, or nil when signed out.
    func accessToken() async -> String?
    /// Called after a 401. Refreshes credentials and returns the new access
    /// token, or nil when the session is unrecoverable (and has been cleared).
    func refreshAfterUnauthorized(rejectedToken: String?) async -> String?
    /// Called when a request is still unauthorized after a refresh retry.
    func sessionRejected() async
}

struct NoTokenProvider: TokenProvider {
    func accessToken() async -> String? { nil }
    func refreshAfterUnauthorized(rejectedToken: String?) async -> String? { nil }
    func sessionRejected() async {}
}
