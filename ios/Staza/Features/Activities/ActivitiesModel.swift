import Foundation
import Observation

@MainActor
@Observable
final class ActivitiesModel {
    enum State: Equatable {
        case loading
        case loaded(ActivitiesContent)
        case failed(String)
    }

    private(set) var state: State = .loading
    private let api: APIClient

    init(api: APIClient) { self.api = api }

    func load() async {
        if case .failed = state { state = .loading }
        do {
            async let activities: [ActivityHistoryItem] = api.get("/api/activities")
            async let summary: ActivityHistorySummary = api.get("/api/activities/summary")
            state = .loaded(ActivitiesContent(summary: try await summary, activities: try await activities))
        } catch is CancellationError {
            return
        } catch {
            // Keep stale content visible when a refresh fails.
            if case .loaded = state { return }
            state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
    }
}
