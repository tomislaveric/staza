import CoreLocation
import Foundation

/// A Flowline's character tags; `primary` is its strongest qualifying one.
struct FlowlineCharacter: Decodable, Equatable, Sendable {
    let primary: FlowlineTag
    let tags: [FlowlineTag]
}

enum FlowlineTag: String, Decodable, CaseIterable, Sendable {
    case flow, endurance, explore
}

extension WorldFlowline {
    /// Flowlines from older payloads carry no character; they read as flow.
    var resolvedCharacter: FlowlineCharacter { character ?? FlowlineCharacter(primary: .flow, tags: []) }

    func score(for tag: FlowlineTag) -> Double? {
        switch tag {
        case .flow: flowScore
        case .endurance: enduranceScore
        case .explore: exploreScore
        }
    }

    /// The midpoint coordinate, used to sort discoveries by distance.
    var midpoint: CLLocationCoordinate2D? {
        let coordinates = self.coordinates
        return coordinates.isEmpty ? nil : coordinates[coordinates.count / 2]
    }
}

/// `POST /api/world/explore`: the area's opportunities for this Explore session only. Nothing is persisted.
struct ExploreResult: Decodable, Equatable, Sendable {
    enum Outcome: String, Decodable, Sendable {
        case discovered
        case nothingNew = "nothing_new"

        /// Unknown outcomes from newer servers read as `discovered`.
        init(from decoder: Decoder) throws {
            let value = try decoder.singleValueContainer().decode(String.self)
            self = Outcome(rawValue: value) ?? .discovered
        }
    }
    struct Summary: Decodable, Equatable, Sendable {
        let total: Int
        var byCharacter: [String: Int] = [:]
        var collectibles: Int? = nil
    }
    let outcome: Outcome
    /// Eligible unridden Flowlines in the area.
    let flowlines: [WorldFlowline]
    /// Uncollected collectibles in the area.
    let collectibles: [WorldCollectible]
    var collectiblesTruncated: Bool? = nil
    /// Eligible Flowlines left out by the cap.
    let availableCount: Int
    let summary: Summary
    /// The explored area; absent on older servers, which explore the requested viewport as is.
    var area: ExploredArea? = nil

    struct Count: Equatable, Sendable {
        let tag: FlowlineTag
        let count: Int
    }

    /// Opportunity Flowlines per primary character, in the fixed tag order, without zero counts.
    var breakdown: [Count] {
        FlowlineTag.allCases.compactMap { tag in
            let count = summary.byCharacter[tag.rawValue] ?? 0
            return count > 0 ? Count(tag: tag, count: count) : nil
        }
    }
}

struct ExploreRequest: Encodable, Sendable {
    let bbox: String
}

/// The area an Explore session covers. A wide viewport is clamped to a centered maximum-size frame.
struct ExploredArea: Decodable, Equatable, Sendable {
    let bbox: String
    let center: GeoPoint
    let clamped: Bool

    var bounds: WorldBounds? {
        let values = bbox.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard values.count == 4 else { return nil }
        return WorldBounds(west: values[0], south: values[1], east: values[2], north: values[3])
    }
}

/// Tabs of the discoveries sheet.
enum DiscoverySort: String, CaseIterable, Identifiable, Sendable {
    case flow, endurance, unridden, nearby
    var id: String { rawValue }

    /// Flowlines ordered for this tab; ties keep name order so the list is stable.
    func sorted(_ flowlines: [WorldFlowline], origin: GeoPoint?) -> [WorldFlowline] {
        let byName: (WorldFlowline, WorldFlowline) -> Bool = { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        func score(_ tag: FlowlineTag) -> (WorldFlowline) -> Double { { $0.score(for: tag) ?? -1 } }
        func by(_ key: @escaping (WorldFlowline) -> Double, descending: Bool = true) -> [WorldFlowline] {
            flowlines.sorted { left, right in
                let (l, r) = (key(left), key(right))
                if l != r { return descending ? l > r : l < r }
                return byName(left, right)
            }
        }
        switch self {
        case .flow: return by(score(.flow))
        case .endurance: return by(score(.endurance))
        case .unridden:
            let unridden = flowlines.filter { !$0.completed }
            let ridden = flowlines.filter(\.completed)
            return DiscoverySort.flow.sorted(unridden, origin: origin) + DiscoverySort.flow.sorted(ridden, origin: origin)
        case .nearby:
            guard let origin else { return by(score(.flow)) }
            return by({ flowline in
                guard let mid = flowline.midpoint else { return .infinity }
                let dLat = mid.latitude - origin.lat
                let dLon = (mid.longitude - origin.lon) * cos(origin.lat * .pi / 180)
                return dLat * dLat + dLon * dLon
            }, descending: false)
        }
    }
}

/// Collectible counts for the discoveries sheet.
struct AreaCounts: Equatable, Sendable {
    var flowlines = 0
    var places = 0
    var peaks = 0
    var viewpoints = 0
    var castles = 0
    var passes = 0

    init(collectibles: [WorldCollectible], flowlines: [WorldFlowline]) {
        self.flowlines = flowlines.count
        for item in collectibles {
            switch item.primaryCategory {
            case "place": places += 1
            case "peak", "mountain": peaks += 1
            case "viewpoint": viewpoints += 1
            case "castle": castles += 1
            case "mountain_pass": passes += 1
            default: break
            }
        }
    }
}
