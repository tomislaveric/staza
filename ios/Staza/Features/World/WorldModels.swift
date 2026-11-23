import CoreLocation
import Foundation

struct WorldCollectible: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let latitude: Double
    let longitude: Double
    let found: Bool
    let primaryCategory: String?
    var visibility: String? = nil
    var elevationMeters: Double? = nil
}

extension WorldCollectible {
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}

struct WorldFlowline: Decodable, Equatable, Identifiable, Sendable {
    struct Geometry: Decodable, Equatable, Sendable {
        let coordinates: [[Double]]
    }
    let id: String
    let name: String
    let geometry: Geometry
    let completed: Bool
    var lengthMeters: Double? = nil
    var flowScore: Double? = nil
    var enduranceScore: Double? = nil
    var exploreScore: Double? = nil
    var roadQualityScore: Double? = nil
    var character: FlowlineCharacter? = nil

    var coordinates: [CLLocationCoordinate2D] {
        geometry.coordinates.compactMap { $0.count >= 2 ? CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) : nil }
    }
}

/// A saved Exploration's route in `GET /api/world`; drawn the same way whatever its status.
struct ExplorationRoute: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let status: String
    let geometry: LineGeometry
}

struct WorldViewport: Decodable, Equatable, Sendable {
    /// Only the player's collected collectibles.
    let collectibles: [WorldCollectible]?
    /// Only the player's completed Flowlines.
    let fartleks: [WorldFlowline]?
    /// Saved Exploration routes intersecting the viewport; absent on older servers.
    var explorationRoutes: [ExplorationRoute]? = nil
    let truncated: Bool?
}

/// The World-relevant part of `GET /api/player/capabilities`.
struct WorldCapabilities: Decodable, Equatable, Sendable {
    struct LockedFilter: Decodable, Equatable, Sendable {
        let id: String
        let nodeId: String
        let nodeName: String
    }
    var worldFilters: [String] = []
    var lockedWorldFilters: [LockedFilter] = []

    static let empty = WorldCapabilities()

    init(worldFilters: [String] = [], lockedWorldFilters: [LockedFilter] = []) {
        self.worldFilters = worldFilters
        self.lockedWorldFilters = lockedWorldFilters
    }

    private enum CodingKeys: String, CodingKey { case worldFilters, lockedWorldFilters }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        worldFilters = try container.decodeIfPresent([String].self, forKey: .worldFilters) ?? []
        lockedWorldFilters = try container.decodeIfPresent([LockedFilter].self, forKey: .lockedWorldFilters) ?? []
    }
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

    func contains(_ point: GeoPoint) -> Bool {
        let inLatitude = point.lat >= south && point.lat <= north
        let inLongitude = west <= east ? point.lon >= west && point.lon <= east : point.lon >= west || point.lon <= east
        return inLatitude && inLongitude
    }

    /// The outline, closed, as map coordinates.
    var ring: [CLLocationCoordinate2D] {
        [(south, west), (south, east), (north, east), (north, west), (south, west)]
            .map { CLLocationCoordinate2D(latitude: $0.0, longitude: $0.1) }
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

extension QuestInstance {
    /// Progress as the web counts it: per target when every objective targets collectibles,
    /// otherwise per completed objective.
    var targetProgress: (completed: Int, total: Int) {
        let byTarget = !objectives.isEmpty && objectives.allSatisfy { $0.objective?.type != "flowline_rule" }
        if byTarget {
            let completed = objectives.reduce(0) { $0 + min($1.progress.completed, $1.progress.required) }
            let total = objectives.reduce(0) { $0 + $1.progress.required }
            return (Int(completed), Int(total))
        }
        return (objectives.filter(\.progress.complete).count, objectives.count)
    }
}
