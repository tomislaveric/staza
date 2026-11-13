import Foundation

struct AuthoredQuest: Decodable, Equatable, Identifiable, Sendable {
    struct Failure: Decodable, Equatable, Sendable {
        struct Criterion: Decodable, Equatable, Sendable {
            let label: String
            let met: Bool
        }
        let attemptCount: Int
        let criteria: [Criterion]?
    }
    struct RequiredNode: Decodable, Equatable, Sendable { let name: String }

    enum State: String, Decodable, Sendable { case active, completed, locked }

    let id: String
    let chainTitle: String
    let step: Int
    let totalSteps: Int
    let title: String
    let description: String
    let difficulty: String
    let xp: Double
    let state: State
    let lastFailure: Failure?
    let requiredNode: RequiredNode?
    let requiredQuestTitle: String?
}

struct AuthoredQuestsResponse: Decodable, Sendable {
    let quests: [AuthoredQuest]
}

struct QuestChain: Equatable, Identifiable, Sendable {
    let title: String
    let quests: [AuthoredQuest]
    var id: String { title }
}
