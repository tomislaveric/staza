import Foundation

struct SkillAtlasView_: Decodable, Equatable, Sendable {
    struct NextSkillPoint: Decodable, Equatable, Sendable {
        let level: Int
        let xpRemaining: Double
        let progress: Double
    }

    struct Grant: Decodable, Equatable, Sendable { let label: String }

    struct Requirement: Decodable, Equatable, Sendable {
        let label: String
        let target: Double
        let current: Double
        let met: Bool
    }

    struct Layout: Decodable, Equatable, Sendable {
        let col: Double
        let row: Double
    }

    struct Node: Decodable, Equatable, Identifiable, Sendable {
        enum State: String, Decodable, Sendable {
            case locked, unlockable, unlocked
            case premiumLocked = "premium_locked"
        }

        let id: String
        let name: String
        let description: String
        let sport: String
        let branch: String
        let cost: Int
        let premium: Bool
        let grant: Grant
        let prerequisites: [String]
        let layout: Layout
        let state: State
        let requirements: [Requirement]
    }

    let isPremium: Bool
    let earnedPoints: Int
    let spentPoints: Int
    let balance: Int
    let nextSkillPoint: NextSkillPoint
    let nodes: [Node]
}

struct SkillUnlockRequest: Encodable, Sendable { let nodeId: String }
