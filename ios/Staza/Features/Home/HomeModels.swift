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
    /// `active`, `partially_completed` or `completed`; unknown values are kept as is.
    let status: String
    let difficulty: String
    let rewardXp: Double
    let objectives: [Objective]
    /// When the Exploration was saved; activities from then on count.
    var startedAt: String? = nil

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
    var nodes: [SkillAtlasView_.Node] = []
}

/// What Home suggests next, mirroring web `homeHighlights`: the easiest active quest (or an
/// exploration), Skill Atlas nodes that can be unlocked now and nodes that are close.
struct HomeHighlights: Equatable, Sendable {
    typealias Node = SkillAtlasView_.Node

    struct AlmostNode: Equatable, Identifiable, Sendable {
        let node: Node
        /// Average requirement completion, 0...1.
        let progress: Double
        var id: String { node.id }

        /// The unmet requirement with the least progress; nil when only Skill Points are missing.
        var blockingRequirement: SkillAtlasView_.Requirement? {
            node.requirements.filter { !$0.met }.min { $0.current / $0.target < $1.current / $1.target }
        }
    }

    static let limit = 3
    private static let difficultyRank = ["easy": 0, "medium": 1, "hard": 2, "prestige": 3]

    let quest: AuthoredQuest?
    let activeQuestCount: Int
    let exploration: QuestInstance?
    let skillPoints: Int
    let ready: [Node]
    let almost: [AlmostNode]

    var showsSkills: Bool { !ready.isEmpty || !almost.isEmpty || skillPoints > 0 }

    init(skillPoints: Int, authoredQuests: [AuthoredQuest], instances: [QuestInstance], nodes: [Node]) {
        let active = authoredQuests.filter { $0.state == .active }
        quest = Self.featuredQuest(active)
        activeQuestCount = active.count
        exploration = instances.first(where: \.isActive)
        self.skillPoints = skillPoints
        ready = Self.readyNodes(nodes)
        almost = Self.almostNodes(nodes)
    }

    /// Lowest difficulty, then lowest XP, then catalog order.
    static func featuredQuest(_ quests: [AuthoredQuest]) -> AuthoredQuest? {
        let rank = { (quest: AuthoredQuest) in difficultyRank[quest.difficulty] ?? difficultyRank.count }
        return quests.enumerated()
            .filter { $0.element.state == .active }
            .min { a, b in
                (rank(a.element), a.element.xp, a.offset) < (rank(b.element), b.element.xp, b.offset)
            }?.element
    }

    /// Unlockable nodes, cheapest first.
    static func readyNodes(_ nodes: [Node]) -> [Node] {
        nodes.enumerated()
            .filter { $0.element.state == .unlockable }
            .sorted { ($0.element.cost, $0.offset) < ($1.element.cost, $1.offset) }
            .prefix(limit)
            .map(\.element)
    }

    /// Started, locked nodes whose prerequisites are met, closest to unlockable first.
    static func almostNodes(_ nodes: [Node]) -> [AlmostNode] {
        nodes.enumerated()
            .filter { $0.element.state == .locked && $0.element.prerequisitesMet == true }
            .map { (offset: $0.offset, item: AlmostNode(node: $0.element, progress: requirementProgress($0.element))) }
            .filter { $0.item.progress > 0 }
            .sorted { a, b in
                if a.item.progress != b.item.progress { return a.item.progress > b.item.progress }
                return (a.item.node.cost, a.offset) < (b.item.node.cost, b.offset)
            }
            .prefix(limit)
            .map(\.item)
    }

    /// Average requirement completion, each requirement capped at 100%; 1 when there are none.
    static func requirementProgress(_ node: Node) -> Double {
        guard !node.requirements.isEmpty else { return 1 }
        let total = node.requirements.reduce(0.0) { sum, requirement in
            sum + (requirement.met || requirement.target <= 0 ? 1 : min(max(requirement.current / requirement.target, 0), 1))
        }
        return total / Double(node.requirements.count)
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

    var highlights: HomeHighlights {
        HomeHighlights(
            skillPoints: achievements?.skillPoints ?? 0,
            authoredQuests: achievements?.authoredQuests ?? [],
            instances: instances,
            nodes: achievements?.nodes ?? []
        )
    }
}
