import CoreLocation
import Foundation

/// One length-aware specialist character, or a plain Flowline.
struct FlowlineCharacter: Decodable, Equatable, Sendable {
    let primary: FlowlineTag?
    let tags: [FlowlineTag]
    var policyVersion: Int? = nil

    static func classify(lengthMeters: Double?, flowScore: Double?, enduranceScore: Double?, exploreScore: Double?) -> Self {
        func validScore(_ value: Double?) -> Bool {
            guard let value else { return false }
            return value.isFinite && (0...100).contains(value)
        }
        let validLength = lengthMeters.map { $0.isFinite && $0 > 0 } ?? false
        let primary: FlowlineTag?
        if validLength, let lengthMeters, lengthMeters < 5000, validScore(flowScore), let flowScore, flowScore > 82 {
            primary = .flow
        } else if validLength, let lengthMeters, lengthMeters >= 5000, validScore(enduranceScore), let enduranceScore, enduranceScore >= 65 {
            primary = .endurance
        } else if validScore(exploreScore), let exploreScore, exploreScore >= 65 {
            primary = .explore
        } else {
            primary = nil
        }
        return Self(primary: primary, tags: primary.map { [$0] } ?? [], policyVersion: 2)
    }
}

enum FlowlineTag: String, Decodable, CaseIterable, Sendable {
    case flow, endurance, explore
}

extension WorldFlowline {
    var resolvedCharacter: FlowlineCharacter {
        if let character, character.policyVersion == 2 || character.primary == nil { return character }
        return .classify(lengthMeters: lengthMeters, flowScore: flowScore, enduranceScore: enduranceScore, exploreScore: exploreScore)
    }

    var opportunityScore: Double {
        let entries = [(flowScore, 70.0), (enduranceScore, 65.0), (exploreScore, 65.0)]
            .compactMap { score, threshold -> (score: Double, threshold: Double)? in
                guard let score, score.isFinite, (0...100).contains(score) else { return nil }
                return (score, threshold)
            }
        let qualifying = entries.filter { $0.score >= $0.threshold }
        return (qualifying.isEmpty ? entries : qualifying).map(\.score).max() ?? 0
    }

    func score(for tag: FlowlineTag) -> Double? {
        switch tag {
        case .flow: flowScore
        case .endurance: enduranceScore
        case .explore: exploreScore
        }
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
        var unclassifiedFlowlineCount: Int? = nil
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
            let count = summary.unclassifiedFlowlineCount == nil && !flowlines.isEmpty
                ? flowlines.filter { $0.resolvedCharacter.primary == tag }.count
                : summary.byCharacter[tag.rawValue] ?? 0
            return count > 0 ? Count(tag: tag, count: count) : nil
        }
    }

    var unclassifiedFlowlineCount: Int {
        summary.unclassifiedFlowlineCount ?? flowlines.filter { $0.resolvedCharacter.primary == nil }.count
    }
}

/// Servers that know circles explore `circle`; older ones fall back to `bbox`.
struct ExploreRequest: Encodable, Sendable {
    let bbox: String
    var circle: ExploreCircle? = nil
}

/// A circular Explore area.
struct ExploreCircle: Codable, Equatable, Sendable {
    let center: GeoPoint
    let radiusMeters: Double

    private static let metersPerDegreeLatitude = 111_320.0

    /// Closed outline for drawing and framing the circle.
    func ring(segments: Int = 72) -> [CLLocationCoordinate2D] {
        let metersPerDegreeLongitude = Self.metersPerDegreeLatitude * max(cos(center.lat * .pi / 180), 1e-6)
        return (0...segments).map { index in
            let angle = Double(index) / Double(segments) * 2 * .pi
            return CLLocationCoordinate2D(
                latitude: center.lat + radiusMeters * sin(angle) / Self.metersPerDegreeLatitude,
                longitude: center.lon + radiusMeters * cos(angle) / metersPerDegreeLongitude
            )
        }
    }

    /// The square enclosing the circle.
    var bounds: WorldBounds {
        let halfLat = radiusMeters / Self.metersPerDegreeLatitude
        let halfLon = radiusMeters / (Self.metersPerDegreeLatitude * max(cos(center.lat * .pi / 180), 1e-6))
        return WorldBounds(west: center.lon - halfLon, south: center.lat - halfLat, east: center.lon + halfLon, north: center.lat + halfLat)
    }
}

/// The area an Explore session covers: a circle, or a viewport clamped to a centered maximum-size frame.
struct ExploredArea: Decodable, Equatable, Sendable {
    let bbox: String
    let center: GeoPoint
    let clamped: Bool
    var circle: ExploreCircle? = nil

    var bounds: WorldBounds? {
        let values = bbox.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard values.count == 4 else { return nil }
        return WorldBounds(west: values[0], south: values[1], east: values[2], north: values[3])
    }
}

/// A findings pill used as a filter of the Explore list.
enum DiscoveryFilter: Hashable, Sendable {
    case character(FlowlineTag)
    case plainFlowlines
    case collectibles
}

/// One row of the Explore list.
enum DiscoveryItem: Identifiable, Equatable, Sendable {
    case flowline(WorldFlowline)
    case collectible(WorldCollectible)

    var id: String { selection.id }

    var selection: WorldSelection {
        switch self {
        case .flowline(let flowline): .flowline(flowline)
        case .collectible(let item): .collectible(item)
        }
    }

    /// Flowlines by opportunity score, then visible collectibles by category and name.
    /// No filter shows everything; several filters show their union.
    static func list(flowlines: [WorldFlowline], collectibles: [WorldCollectible],
                     filters: Set<DiscoveryFilter>) -> [DiscoveryItem] {
        let byName: (String, String) -> Bool = { $0.localizedStandardCompare($1) == .orderedAscending }
        let lines = flowlines
            .filter { flowline in
                let filter = flowline.resolvedCharacter.primary.map { DiscoveryFilter.character($0) } ?? .plainFlowlines
                return filters.isEmpty || filters.contains(filter)
            }
            .sorted { left, right in
                let l = left.opportunityScore
                let r = right.opportunityScore
                return l != r ? l > r : byName(left.name, right.name)
            }
        let places = filters.isEmpty || filters.contains(.collectibles)
            ? WorldFilters.visible(collectibles).sorted { left, right in
                let (l, r) = (WorldCategory.of(left), WorldCategory.of(right))
                return l != r ? l < r : byName(left.name, right.name)
            }
            : []
        return lines.map(DiscoveryItem.flowline) + places.map(DiscoveryItem.collectible)
    }
}
