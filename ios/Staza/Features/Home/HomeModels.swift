import Foundation

struct PlayerProgress: Decodable, Equatable, Sendable {
    let totalXp: Double
    let level: Int
    let currentLevelXp: Double
    let nextLevelXp: Double
    let progressToNextLevel: Double
    let remainingXp: Double
    let progressPercent: Double
}

struct QuestInstance: Decodable, Equatable, Identifiable, Sendable {
    struct Objective: Decodable, Equatable, Sendable {
        struct Progress: Decodable, Equatable, Sendable {
            let completed: Double
            let required: Double
            let complete: Bool
        }
        let progress: Progress
    }

    let id: String
    let title: String
    let description: String
    let status: String
    let difficulty: String
    let rewardXp: Double
    let objectives: [Objective]

    var isActive: Bool { status == "active" }

    /// Overall completion across objectives, 0...1.
    var completionFraction: Double {
        let required = objectives.reduce(0) { $0 + max($1.progress.required, 0) }
        guard required > 0 else { return 0 }
        let done = objectives.reduce(0) { $0 + min(max($1.progress.completed, 0), max($1.progress.required, 0)) }
        return min(done / required, 1)
    }
}

struct QuestInstancesResponse: Decodable, Sendable {
    let instances: [QuestInstance]
}
