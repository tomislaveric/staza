import Foundation
import Observation

@MainActor
@Observable
final class ProgressDashboardModel {
    private(set) var dashboard: ProgressDashboard?
    private(set) var rewards: NewRewards?
    private(set) var isLoading = false
    private(set) var failed = false

    private let api: APIClient

    init(api: APIClient) { self.api = api }

    /// Whether the banner for freshly completed quests should show.
    var showsNewRewards: Bool { rewards?.hasNewProgress == true }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            dashboard = try await api.get("/api/player/progress-dashboard")
            failed = false
        } catch is CancellationError {
            return
        } catch {
            failed = true
            return
        }
        await loadRewards()
    }

    /// Fetches unseen rewards, then marks them seen so the banner shows once.
    private func loadRewards() async {
        do {
            let fetched: NewRewards = try await api.get("/api/rewards/new")
            rewards = fetched
            if fetched.hasNew || fetched.hasNewProgress {
                let _: EmptyResponse = try await api.post("/api/rewards/seen")
            }
        } catch {
            // Rewards are supplementary; the dashboard stays usable without them.
        }
    }
}
