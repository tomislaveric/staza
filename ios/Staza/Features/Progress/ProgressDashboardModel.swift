import Foundation
import Observation

@MainActor
@Observable
final class ProgressDashboardModel {
    private(set) var dashboard: ProgressDashboard?
    private(set) var rewards: NewRewards?
    private(set) var quests: [AuthoredQuest] = []
    private(set) var capabilities: PlayerCapabilities?
    private(set) var isLoading = false
    private(set) var failed = false

    private let api: APIClient

    init(api: APIClient) { self.api = api }

    /// Whether the banner for freshly completed quests should show.
    var showsNewRewards: Bool { rewards?.hasNewProgress == true }

    var activeQuests: [AuthoredQuest] { quests.filter { $0.state == .active } }
    var lockedQuests: [AuthoredQuest] { quests.filter { $0.state == .locked } }
    var finishedQuests: [AuthoredQuest] { quests.filter { $0.state == .completed } }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        // Quests and capabilities are supplementary; their failure leaves those sections empty.
        async let questsRequest: AuthoredQuestsResponse = api.get("/api/authored-quests")
        async let capabilitiesRequest: PlayerCapabilities = api.get("/api/player/capabilities")
        do {
            let loaded: ProgressDashboard = try await api.get("/api/player/progress-dashboard")
            let loadedQuests = (try? await questsRequest)?.quests ?? []
            let loadedCapabilities = try? await capabilitiesRequest
            if Task.isCancelled { return }
            dashboard = loaded
            quests = loadedQuests
            capabilities = loadedCapabilities
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
