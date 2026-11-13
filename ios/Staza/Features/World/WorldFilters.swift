import SwiftUI

/// World map filters, mirroring the web World page. Multi-select with union semantics;
/// an empty selection means "All".
enum WorldFilter: String, CaseIterable, Identifiable, Sendable {
    case found
    case unfound
    case flowlines = "fartleks"
    case viewpoint
    case peak
    case castle
    case waterfall
    case place
    case mountainPass = "mountain_pass"
    case undiscoveredOnly = "undiscovered-only"
    case peaksOnly = "peaks-only"
    case highFlow = "high-flow"
    case longEndurance = "long-endurance"

    static let highFlowScore = 70.0
    static let longFlowlineMeters = 5000.0
    static let categories: [WorldFilter] = [.viewpoint, .peak, .castle, .waterfall, .place, .mountainPass]
    static let advanced: [WorldFilter] = [.undiscoveredOnly, .peaksOnly, .highFlow, .longEndurance]

    var id: String { rawValue }
    var isAdvanced: Bool { Self.advanced.contains(self) }

    var title: LocalizedStringKey {
        switch self {
        case .found: "world.filter.found"
        case .unfound: "world.filter.unfound"
        case .flowlines: "world.filter.flowlines"
        case .viewpoint: "world.category.viewpoint"
        case .peak: "world.category.peak"
        case .castle: "world.category.castle"
        case .waterfall: "world.category.waterfall"
        case .place: "world.category.place"
        case .mountainPass: "world.category.mountainPass"
        case .undiscoveredOnly: "world.filter.undiscoveredOnly"
        case .peaksOnly: "world.filter.peaksOnly"
        case .highFlow: "world.filter.highFlow"
        case .longEndurance: "world.filter.longEndurance"
        }
    }

    var systemImage: String {
        switch self {
        case .found: "checkmark.circle.fill"
        case .unfound: "circle.dashed"
        case .flowlines, .highFlow, .longEndurance: "point.topleft.down.to.point.bottomright.curvepath"
        case .undiscoveredOnly: "sparkle.magnifyingglass"
        case .viewpoint: WorldCategory.systemImage("viewpoint")
        case .peak, .peaksOnly: WorldCategory.systemImage("peak")
        case .castle: WorldCategory.systemImage("castle")
        case .waterfall: WorldCategory.systemImage("waterfall")
        case .place: WorldCategory.systemImage("place")
        case .mountainPass: WorldCategory.systemImage("mountain_pass")
        }
    }

    /// Swatch colour matching the map marker the filter affects.
    var tint: Color {
        switch self {
        case .found: StazaColor.success
        case .unfound, .undiscoveredOnly: StazaColor.textMuted
        case .flowlines, .highFlow, .longEndurance: StazaColor.rarityRare
        default: StazaColor.textPrimary
        }
    }

    func matches(_ collectible: WorldCollectible) -> Bool {
        switch self {
        case .flowlines, .highFlow, .longEndurance: false
        case .found: collectible.found
        case .unfound, .undiscoveredOnly: !collectible.found
        case .peaksOnly: WorldCategory.of(collectible) == "peak"
        default: WorldCategory.of(collectible) == rawValue
        }
    }

    func matches(_ flowline: WorldFlowline) -> Bool {
        switch self {
        case .flowlines: true
        case .undiscoveredOnly: !flowline.completed
        case .highFlow: (flowline.flowScore ?? 0) >= Self.highFlowScore
        case .longEndurance: (flowline.lengthMeters ?? 0) >= Self.longFlowlineMeters
        default: false
        }
    }
}

enum WorldCategory {
    static func of(_ collectible: WorldCollectible) -> String { collectible.primaryCategory ?? "coin" }

    static func systemImage(_ category: String?) -> String {
        switch category {
        case "viewpoint": "binoculars.fill"
        case "peak", "mountain": "mountain.2.fill"
        case "castle": "building.columns.fill"
        case "waterfall": "drop.fill"
        case "mountain_pass": "road.lanes"
        default: "mappin"
        }
    }
}

enum WorldFilters {
    static func visible(_ collectibles: [WorldCollectible]) -> [WorldCollectible] {
        collectibles.filter { $0.visibility != "hidden" }
    }

    /// Filters to offer for the current viewport; granted advanced filters are always offered.
    static func available(collectibles: [WorldCollectible], flowlines: [WorldFlowline], granted: [String]) -> [WorldFilter] {
        let visible = visible(collectibles)
        var result: [WorldFilter] = []
        if visible.contains(where: \.found) { result.append(.found) }
        if visible.contains(where: { !$0.found }) { result.append(.unfound) }
        if !flowlines.isEmpty { result.append(.flowlines) }
        let categories = Set(visible.map(WorldCategory.of))
        result += WorldFilter.categories.filter { categories.contains($0.rawValue) }
        result += WorldFilter.advanced.filter { granted.contains($0.rawValue) }
        return result
    }

    static func collectibles(_ items: [WorldCollectible], selected: Set<WorldFilter>) -> [WorldCollectible] {
        let visible = visible(items)
        guard !selected.isEmpty else { return visible }
        return visible.filter { item in selected.contains { $0.matches(item) } }
    }

    /// Flowline completion is independent of collectible discovery filters.
    static func flowlines(_ items: [WorldFlowline], selected: Set<WorldFilter>) -> [WorldFlowline] {
        guard !selected.isEmpty, !selected.contains(.flowlines) else { return items }
        return items.filter { item in selected.contains { $0.matches(item) } }
    }
}
