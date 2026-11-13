import CoreLocation
import Foundation

struct WorldCollectible: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let latitude: Double
    let longitude: Double
    let found: Bool
    let primaryCategory: String?
}

struct WorldFlowline: Decodable, Equatable, Identifiable, Sendable {
    struct Geometry: Decodable, Equatable, Sendable {
        let coordinates: [[Double]]
    }
    let id: String
    let name: String
    let geometry: Geometry
    let completed: Bool

    var coordinates: [CLLocationCoordinate2D] {
        geometry.coordinates.compactMap { $0.count >= 2 ? CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) : nil }
    }
}

struct WorldViewport: Decodable, Equatable, Sendable {
    let collectibles: [WorldCollectible]?
    let fartleks: [WorldFlowline]?
    let truncated: Bool?
}

struct QuestTargets: Decodable, Equatable, Sendable {
    let collectibles: [WorldCollectible]
    let flowlines: [WorldFlowline]

    static let empty = QuestTargets(collectibles: [], flowlines: [])
}

struct WorldBounds: Equatable, Sendable {
    var west: Double
    var south: Double
    var east: Double
    var north: Double

    /// The API rejects values outside the valid lat/lon range, so a zoomed-out viewport is clamped.
    var queryValue: String {
        let clamp = { (value: Double, limit: Double) in min(max(value, -limit), limit) }
        return [clamp(west, 180), clamp(south, 90), clamp(east, 180), clamp(north, 90)]
            .map { String(format: "%.5f", $0) }.joined(separator: ",")
    }
}

enum WorldSelectionKind: Sendable { case collectible, flowline }

enum WorldSelection: Equatable, Identifiable, Sendable {
    case collectible(WorldCollectible)
    case flowline(WorldFlowline)

    var id: String {
        switch self {
        case .collectible(let item): "collectible:\(item.id)"
        case .flowline(let item): "flowline:\(item.id)"
        }
    }
}
