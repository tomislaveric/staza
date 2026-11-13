import Foundation

struct PlayerProfile: Decodable, Equatable, Sendable {
    struct Progress: Decodable, Equatable, Sendable {
        let totalXp: Int
        let level: Int
        let progressPercent: Double
    }
    struct CollectibleStats: Decodable, Equatable, Sendable {
        let totalCollectibles: Int
        let discoveredCount: Int
    }
    let displayName: String
    let progress: Progress
    let distanceMeters: Double
    let activityCount: Int
    let flowlineCount: Int
    let collectibles: CollectibleStats?
}

struct PlayerCapabilities: Decodable, Equatable, Sendable {
    struct Entry: Decodable, Equatable, Identifiable, Sendable {
        let id: String
        let label: String
    }
    let titles: [Entry]
    let badges: [Entry]
}

struct DeletionIntent: Decodable, Equatable, Sendable {
    let confirmationToken: String
    let expiresAt: String
}

struct DeleteAccountRequest: Encodable, Sendable { let confirmationToken: String }

/// Arbitrary JSON, used to pass the account export through to a shareable file unchanged.
enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}
