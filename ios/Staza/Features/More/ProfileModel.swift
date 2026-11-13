import Foundation
import Observation

/// Backs the profile screen: profile data, passkeys, data export, account deletion and sign-out.
@MainActor
@Observable
final class ProfileModel {
    /// Sensitive actions that require a fresh email step-up first.
    enum SensitiveAction: Identifiable { case export, delete
        var id: Self { self }
    }

    private(set) var profile: PlayerProfile?
    private(set) var capabilities: PlayerCapabilities?
    private(set) var passkeys: [PasskeyInfo] = []
    private(set) var isLoading = false
    private(set) var failed = false
    private(set) var isBusy = false
    private(set) var exportURL: URL?
    /// Development tools (game data reset) are offered only when the server reports a non-production stage.
    private(set) var devTools = false
    var actionError: String?

    private let api: APIClient
    private let auth: AuthService

    init(api: APIClient, auth: AuthService) {
        self.api = api
        self.auth = auth
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            profile = try await api.get("/api/player/profile")
            failed = false
        } catch is CancellationError {
            return
        } catch {
            failed = true
        }
        // Capabilities and passkeys are supplementary; the screen works without them.
        capabilities = try? await api.get("/api/player/capabilities")
        await reloadPasskeys()
        let session: SessionResponse? = try? await api.get("/api/auth/session")
        devTools = session?.devTools ?? false
    }

    func reloadPasskeys() async {
        if let list = try? await auth.listPasskeys() { passkeys = list }
    }

    func deletePasskey(_ passkey: PasskeyInfo) async {
        await perform {
            try await auth.deletePasskey(id: passkey.id)
            passkeys.removeAll { $0.id == passkey.id }
        }
    }

    func addPasskey() async {
        await perform {
            do { try await auth.registerPasskey() } catch PasskeyError.cancelled { return }
            await reloadPasskeys()
        }
    }

    /// Fetches the export (requires a fresh step-up) and writes it to a temporary, shareable file.
    func exportData() async {
        await perform {
            let json: JSONValue = try await api.get("/api/account/export")
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("staza-account-export.json")
            try encoder.encode(json).write(to: url, options: .atomic)
            exportURL = url
        }
    }

    /// Requires a fresh step-up. On success the local session is cleared, which signs the user out.
    func deleteAccount() async {
        await perform {
            let intent: DeletionIntent = try await api.post("/api/account/deletion-intent")
            let _: EmptyResponse = try await api.post(
                "/api/account/delete", body: DeleteAccountRequest(confirmationToken: intent.confirmationToken)
            )
            await auth.logout(everywhere: false)
        }
    }

    /// Development only: deletes the player's activities, XP, quests and media but keeps the login.
    /// Returns true on success so the caller can refresh other screens.
    func resetGameData() async -> Bool {
        var succeeded = false
        await perform {
            let _: EmptyResponse = try await api.post("/api/dev/reset-data")
            succeeded = true
        }
        if succeeded { await load() }
        return succeeded
    }

    func logout(everywhere: Bool) async {
        isBusy = true
        defer { isBusy = false }
        await auth.logout(everywhere: everywhere)
    }

    func clearExport() {
        if let exportURL { try? FileManager.default.removeItem(at: exportURL) }
        exportURL = nil
    }

    private func perform(_ work: () async throws -> Void) async {
        isBusy = true
        actionError = nil
        defer { isBusy = false }
        do { try await work() } catch is CancellationError {} catch { actionError = error.localizedDescription }
    }
}
