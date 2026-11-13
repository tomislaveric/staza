import Foundation
import Observation

@MainActor
@Observable
final class ActivityDetailModel {
    enum State: Equatable {
        case loading
        case loaded(ActivityDetail)
        case failed(String)
    }

    private(set) var state: State = .loading
    var section: ActivityDetailSection = .replay
    private let api: APIClient
    private let activityId: String

    init(api: APIClient, activityId: String) {
        self.api = api
        self.activityId = activityId
    }

    func load() async {
        if case .failed = state { state = .loading }
        do {
            let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
            let id = activityId.addingPercentEncoding(withAllowedCharacters: allowed) ?? activityId
            state = .loaded(try await api.get("/api/activities/\(id)"))
        } catch is CancellationError {
            return
        } catch {
            // Keep stale content visible when a refresh fails.
            if case .loaded = state { return }
            state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
    }
}
