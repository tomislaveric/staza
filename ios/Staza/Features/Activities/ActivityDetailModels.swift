import Foundation

struct ActivityDetailEvent: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let collectible: Collectible
    let value: Double
    let repeatClaim: Bool?

    struct Collectible: Decodable, Equatable, Sendable {
        let name: String
        let type: String
    }

    private enum CodingKeys: String, CodingKey {
        case id, collectible, value
        case repeatClaim = "repeat"
    }

    var isRepeat: Bool { repeatClaim ?? false }
}

struct ActivityNearMiss: Decodable, Equatable, Identifiable, Sendable {
    let collectibleId: String
    let name: String
    let value: Double
    let minimumDistanceMeters: Double

    var id: String { collectibleId }
}

/// `GET /api/activities/:id`. Replay internals are decoded only as far as the
/// near-miss list; the Replay tab is built in its own feature.
struct ActivityDetail: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let type: String
    let title: String
    let startedAt: String
    let distanceMeters: Double?
    let durationSeconds: Double?
    let xpEarned: Double
    let collectedCount: Int
    let revisitCount: Int?
    let flowlineCount: Int
    let events: [ActivityDetailEvent]
    let replay: Replay?

    struct Replay: Decodable, Equatable, Sendable {
        let activityResult: Result?

        struct Result: Decodable, Equatable, Sendable {
            let nearMisses: [ActivityNearMiss]?
        }
    }

    var nearMisses: [ActivityNearMiss] { replay?.activityResult?.nearMisses ?? [] }

    var startedDate: Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: startedAt) ?? ISO8601DateFormatter().date(from: startedAt)
    }
}

enum ActivityDetailSection: Hashable, CaseIterable {
    case replay, collected, nearMisses
}
