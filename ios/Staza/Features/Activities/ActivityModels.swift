import Foundation

struct ActivityHistoryItem: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let type: String
    let title: String
    let startedAt: String
    let distanceMeters: Double?
    let durationSeconds: Double?
    let xpEarned: Double
    let collectedCount: Int
    let flowlineCount: Int

    var startedDate: Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: startedAt) ?? ISO8601DateFormatter().date(from: startedAt)
    }
}

struct ActivityHistorySummary: Decodable, Equatable, Sendable {
    let count: Int
    let distanceMeters: Double
    let xp: Double
    let collected: Int
    let flowlines: Int
}

struct ActivitiesContent: Equatable {
    let summary: ActivityHistorySummary
    /// Order is owned by the server (newest first).
    let activities: [ActivityHistoryItem]
}
