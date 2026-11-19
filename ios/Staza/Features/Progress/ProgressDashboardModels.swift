import Foundation

struct ProgressDashboard: Decodable, Equatable, Sendable {
    struct Lifetime: Decodable, Equatable, Sendable {
        let distanceMeters: Double
        let totalCollectibles: Int
        let totalFlowlines: Int
    }

    struct SportRecord: Decodable, Equatable, Identifiable, Sendable {
        let type: String
        let activityCount: Int
        let distanceMeters: Double
        let longestDistanceMeters: Double
        let highestElevationGainM: Double?
        var id: String { type }
    }

    struct Milestones: Decodable, Equatable, Sendable {
        let places: Int
        let peaks: Int
        let mountainPasses: Int
        let flowlines: Int
    }

    struct RecentActivity: Decodable, Equatable, Identifiable, Sendable {
        let activity: ActivityHistoryItem
        let xpPercentOfBest: Double
        var id: String { activity.id }

        init(from decoder: Decoder) throws {
            activity = try ActivityHistoryItem(from: decoder)
            xpPercentOfBest = try decoder.container(keyedBy: CodingKeys.self).decode(Double.self, forKey: .xpPercentOfBest)
        }

        private enum CodingKeys: String, CodingKey { case xpPercentOfBest }
    }

    let progress: PlayerProgress
    let lifetime: Lifetime
    let sportRecords: [SportRecord]
    let milestones: Milestones
    let recentActivities: [RecentActivity]
}

struct NewRewards: Decodable, Equatable, Sendable {
    let hasNew: Bool
    let hasNewProgress: Bool
}
