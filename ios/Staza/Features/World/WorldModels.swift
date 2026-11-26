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

/// A Flowline offered as an optional enhancement of a generated cycling route.
struct WorldFlowline: Decodable, Equatable, Identifiable, Sendable {
    struct Geometry: Decodable, Equatable, Sendable {
        let coordinates: [[Double]]
    }
    let id: String
    let name: String
    let geometry: Geometry
    var lengthMeters: Double? = nil

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

/// `GET /api/world`: curated POIs and saved Exploration routes in the viewport. Flowlines are ignored;
/// Explore only offers them after a route is generated.
struct WorldViewport: Decodable, Equatable, Sendable {
    let collectibles: [WorldCollectible]?
    var explorationRoutes: [ExplorationRoute]? = nil
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

    var center: GeoPoint { GeoPoint(lat: (south + north) / 2, lon: (west + east) / 2) }
}

enum WorldCategory {
    static func of(_ collectible: WorldCollectible) -> String { collectible.primaryCategory ?? "coin" }

    /// Localization key of the category's name.
    static func labelKey(_ category: String?) -> String {
        switch category {
        case "viewpoint": "world.category.viewpoint"
        case "peak", "mountain": "world.category.peak"
        case "castle": "world.category.castle"
        case "waterfall": "world.category.waterfall"
        case "place": "world.category.place"
        case "mountain_pass": "world.category.mountainPass"
        default: "world.detail.collectible"
        }
    }

    static func systemImage(_ category: String?) -> String {
        switch category {
        case "viewpoint": "binoculars.fill"
        case "peak", "mountain": "mountain.2.fill"
        case "castle": "building.columns.fill"
        case "waterfall": "drop.fill"
        case "mountain_pass": "road.lanes"
        case "place": "mappin.and.ellipse"
        default: "mappin"
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
