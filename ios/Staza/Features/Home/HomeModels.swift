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
        struct Spec: Decodable, Equatable, Sendable {
            struct Target: Decodable, Equatable, Sendable { let id: String }
            let type: String
            let targets: [Target]?
        }
        let progress: Progress
        let objective: Spec?
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

/// Skill, achievement and authored-quest data shown on Home. Optional as a whole: Home still
/// renders when any of its sources fails.
struct HomeAchievements: Equatable, Sendable {
    let skillPoints: Int
    let unlockedSkills: Int
    let totalSkills: Int
    let earned: [PlayerCapabilities.Entry]
    let authoredQuests: [AuthoredQuest]
}

/// One Home to-do row, mirroring the web Home to-do list. Order: spend Skill Points, up to three active
/// authored quests (plus a "view all" row beyond that), active explorations, otherwise plan one.
enum HomeTodo: Equatable, Identifiable, Sendable {
    enum Target: Equatable, Sendable { case skillAtlas, quests, world }

    static let questLimit = 3

    case spendSkillPoints(Int)
    case quest(AuthoredQuest)
    case moreQuests(Int)
    case exploration(QuestInstance)
    case planExploration

    static func list(skillPoints: Int, authoredQuests: [AuthoredQuest], instances: [QuestInstance]) -> [HomeTodo] {
        var todos: [HomeTodo] = []
        if skillPoints > 0 { todos.append(.spendSkillPoints(skillPoints)) }
        let quests = authoredQuests.filter { $0.state == .active }
        todos += quests.prefix(questLimit).map(HomeTodo.quest)
        if quests.count > questLimit { todos.append(.moreQuests(quests.count)) }
        let explorations = instances.filter(\.isActive)
        todos += explorations.map(HomeTodo.exploration)
        if quests.isEmpty && explorations.isEmpty { todos.append(.planExploration) }
        return todos
    }

    var id: String {
        switch self {
        case .spendSkillPoints: "skillPoints"
        case .quest(let quest): "quest.\(quest.id)"
        case .moreQuests: "moreQuests"
        case .exploration(let instance): "exploration.\(instance.id)"
        case .planExploration: "planExploration"
        }
    }

    var target: Target {
        switch self {
        case .spendSkillPoints: .skillAtlas
        case .quest, .moreQuests: .quests
        case .exploration, .planExploration: .world
        }
    }
}

struct HomeContent: Equatable {
    let progress: PlayerProgress
    let lifetime: ProgressDashboard.Lifetime
    /// Newest activity summary; `latestDetail` adds events and replay when it could be loaded.
    let latest: ActivityHistoryItem?
    let latestDetail: ActivityDetail?
    let replay: ReplayTimeline?
    let basemap: Basemap?
    let instances: [QuestInstance]
    let achievements: HomeAchievements?

    var todos: [HomeTodo] {
        HomeTodo.list(skillPoints: achievements?.skillPoints ?? 0, authoredQuests: achievements?.authoredQuests ?? [], instances: instances)
    }
}
