import Foundation
import Observation

struct HomeContent: Equatable {
    let progress: PlayerProgress
    let activeQuests: [QuestInstance]
}

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
            async let progress: PlayerProgress = api.get("/api/player/progress")
            async let quests: QuestInstancesResponse = api.get("/api/quest-instances")
            let content = HomeContent(progress: try await progress, activeQuests: try await quests.instances.filter(\.isActive))
            state = .loaded(content)
        } catch is CancellationError {
            return
        } catch {
            // Keep stale content visible when a refresh fails.
            if case .loaded = state { return }
            state = .failed(Self.message(for: error))
        }
    }

    private static func message(for error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
