import Foundation
import Observation

@MainActor
@Observable
final class HomeModel {
    enum State: Equatable {
        case loading
        case loaded(HomeContent)
        case failed(String)
    }

    private(set) var state: State = .loading
    private let api: APIClient

    init(api: APIClient) { self.api = api }

    func load() async {
        if case .failed = state { state = .loading }
        do {
            async let dashboard: ProgressDashboard = api.get("/api/player/progress-dashboard")
            async let activities: [ActivityHistoryItem] = api.get("/api/activities")
            async let quests: QuestInstancesResponse = api.get("/api/quest-instances")
            async let achievements = loadAchievements()
            let (dashboardValue, activityList, questValue) = try await (dashboard, activities, quests)
            let latest = activityList.first
            let detail: ActivityDetail? = if let latest { try? await api.get("/api/activities/\(latest.id)") } else { nil }
            let replay = detail.flatMap(ReplayTimeline.init(detail:))
            let basemap: Basemap? = replay == nil ? nil : try? await api.get("/api/world/basemap")
            state = .loaded(HomeContent(
                progress: dashboardValue.progress,
                lifetime: dashboardValue.lifetime,
                latest: latest,
                latestDetail: detail,
                replay: replay,
                basemap: basemap,
                instances: questValue.instances,
                achievements: await achievements
            ))
        } catch is CancellationError {
            return
        } catch {
            // Keep stale content visible when a refresh fails.
            if case .loaded = state { return }
            state = .failed(Self.message(for: error))
        }
    }

    /// Secondary data: Home must still render if it cannot load.
    private func loadAchievements() async -> HomeAchievements? {
        async let tree: SkillAtlasView_ = api.get("/api/skill-tree")
        async let capabilities: PlayerCapabilities = api.get("/api/player/capabilities")
        async let quests: AuthoredQuestsResponse = api.get("/api/authored-quests")
        guard let tree = try? await tree, let capabilities = try? await capabilities else { return nil }
        let authored = (try? await quests)?.quests ?? []
        return HomeAchievements(
            skillPoints: tree.balance,
            unlockedSkills: tree.nodes.filter { $0.state == .unlocked }.count,
            totalSkills: tree.nodes.count,
            earned: capabilities.titles + capabilities.badges,
            authoredQuests: authored
        )
    }

    private static func message(for error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
