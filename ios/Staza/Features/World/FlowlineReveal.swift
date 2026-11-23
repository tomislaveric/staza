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

/// A findings pill used as a filter of the Explore list.
enum DiscoveryFilter: Hashable, Sendable {
    case character(FlowlineTag)
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

    /// Flowlines by their primary score, then visible collectibles by category and name.
    /// No filter shows everything; several filters show their union.
    static func list(flowlines: [WorldFlowline], collectibles: [WorldCollectible],
                     filters: Set<DiscoveryFilter>) -> [DiscoveryItem] {
        let byName: (String, String) -> Bool = { $0.localizedStandardCompare($1) == .orderedAscending }
        let lines = flowlines
            .filter { filters.isEmpty || filters.contains(.character($0.resolvedCharacter.primary)) }
            .sorted { left, right in
                let l = left.score(for: left.resolvedCharacter.primary) ?? -1
                let r = right.score(for: right.resolvedCharacter.primary) ?? -1
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
