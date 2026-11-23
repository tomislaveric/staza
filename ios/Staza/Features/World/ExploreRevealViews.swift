import SwiftUI

extension FlowlineTag {
    /// Score label, e.g. "Flow 84".
    var scoreLabel: LocalizedStringKey {
        switch self {
        case .flow: "flowline.character.flow"
        case .endurance: "flowline.character.endurance"
        case .explore: "flowline.character.explore"
        }
    }

    var tint: Color {
        switch self {
        case .flow: StazaColor.rarityRare
        case .endurance: StazaColor.rarityEpic
        case .explore: StazaColor.success
        }
    }

    var systemImage: String {
        switch self {
        case .flow: "wind"
        case .endurance: "bolt.heart"
        case .explore: "binoculars"
        }
    }

    func breakdown(_ count: Int) -> LocalizedStringKey {
        switch self {
        case .flow: "world.explore.breakdown.flow \(count)"
        case .endurance: "world.explore.breakdown.endurance \(count)"
        case .explore: "world.explore.breakdown.explore \(count)"
        }
    }
}

/// The Flowline's primary character with its score, e.g. "Flow 84".
struct FlowlineCharacterChip: View {
    let flowline: WorldFlowline

    var body: some View {
        let primary = flowline.resolvedCharacter.primary
        HStack(spacing: 5) {
            Image(systemName: primary.systemImage).font(.caption2.weight(.semibold)).accessibilityHidden(true)
            Text(primary.scoreLabel)
            if let score = flowline.score(for: primary) {
                Text(verbatim: "\(Int(score.rounded()))").monospacedDigit()
            }
        }
        .font(StazaFont.caption.weight(.semibold))
        .lineLimit(1)
        .foregroundStyle(primary.tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(primary.tint.opacity(0.16), in: Capsule())
        .overlay(Capsule().strokeBorder(primary.tint.opacity(0.45), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Sheet actions

/// Compact Explore button for the World sheet header. Always available: a wide area is clamped to a maximum frame.
struct ExploreButton: View {
    let isExploring: Bool
    /// Only the magnifier, e.g. "explore again" in the Explore session's toolbar.
    var iconOnly = false
    let onExplore: () -> Void

    var body: some View {
        Button(action: onExplore) {
            HStack(spacing: StazaSpacing.xs) {
                if isExploring {
                    SwiftUI.ProgressView().controlSize(.small).tint(StazaColor.onAccent)
                } else {
                    Image(systemName: "sparkle.magnifyingglass")
                }
                if !iconOnly { Text(title).lineLimit(1) }
            }
            .font(StazaFont.footnote.weight(.semibold))
        }
        .buttonStyle(.stazaPrimary)
        .disabled(isExploring)
        .fixedSize()
        .accessibilityLabel(Text(title))
        .accessibilityIdentifier("exploreThisArea")
    }

    private var title: LocalizedStringKey {
        isExploring ? "world.explore.exploring" : "world.explore.cta.explore"
    }
}

/// Glide / Chill / Explore for "Generate route"; the names stay the same in every language.
struct RouteIntentPicker: View {
    @Binding var intent: RouteIntent

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.xs) {
            OverlineText("route.intent.title")
            Picker("route.intent.title", selection: $intent) {
                ForEach(RouteIntent.allCases) { Text(verbatim: $0.name).tag($0) }
            }
            .pickerStyle(.segmented)
            Text(intent.summary).font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
        }
    }
}

/// "Plan" button that opens route planning; a badge counts the stops picked so far.
struct PlanRouteButton: View {
    let routeStops: Int
    let onPlanRoute: () -> Void

    var body: some View {
        Button(action: onPlanRoute) {
            HStack(spacing: StazaSpacing.xs) {
                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                Text("world.planRoute.short").lineLimit(1)
            }
                .font(StazaFont.footnote.weight(.semibold))
                .overlay(alignment: .topTrailing) {
                    if routeStops > 0 {
                        Text(verbatim: "\(routeStops)")
                            .font(Font.caption2.weight(.bold).monospacedDigit())
                            .foregroundStyle(StazaColor.onAccent)
                            .padding(.horizontal, 4)
                            .background(StazaColor.accent, in: Capsule())
                            .offset(x: 10, y: -10)
                    }
                }
        }
        .buttonStyle(.stazaSecondary)
        .fixedSize()
        .accessibilityLabel(routeStops > 0 ? Text("world.planRoute.count \(routeStops)") : Text("world.planRoute"))
        .accessibilityIdentifier("worldPlanRoute")
    }
}

// MARK: - Result banner

/// The top of the Explore sheet: errors or "nothing new", the clamp note and the route feel.
struct ExploreResultBanner: View {
    let state: ExploreState
    let onZoomOut: () -> Void
    var intent: Binding<RouteIntent> = .constant(.default)
    var clamped = false

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            switch state {
            case .exploring:
                EmptyView()
            case .failed(let message):
                header(Text("world.explore.error.title"), systemImage: "exclamationmark.triangle.fill", tint: StazaColor.danger)
                if let message { Text(verbatim: message).font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted) }
            case .result(let result):
                resultContent(result)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("exploreResult")
    }

    @ViewBuilder
    private func resultContent(_ result: ExploreResult) -> some View {
        switch result.outcome {
        case .nothingNew:
            HStack(spacing: StazaSpacing.sm) {
                header(Text("world.explore.nothing.title"), systemImage: "binoculars", tint: StazaColor.textMuted)
                Spacer(minLength: StazaSpacing.xs)
                Button(action: onZoomOut) {
                    Label("world.explore.zoomOut", systemImage: "minus.magnifyingglass").labelStyle(.iconOnly)
                }
                .buttonStyle(.stazaSecondary)
            }
            Text("world.explore.nothing.body").font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
        case .discovered:
            EmptyView()
        }
        if clamped {
            Label("world.explore.clamped", systemImage: "viewfinder")
                .font(StazaFont.caption)
                .foregroundStyle(StazaColor.textMuted)
                .accessibilityIdentifier("exploreClamped")
        }
        RouteIntentPicker(intent: intent).accessibilityIdentifier("exploreIntent")
    }

    private func header(_ title: Text, systemImage: String, tint: Color) -> some View {
        HStack(spacing: StazaSpacing.sm) {
            IconBadge(systemImage: systemImage, tint: tint, size: 28)
            title.font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary).accessibilityAddTraits(.isHeader)
        }
    }
}

/// What the explored area holds, e.g. "11 High-Flow · 1 Endurance · 4 collectibles".
/// Each pill filters the list; no selection shows everything.
struct ExploreFindings: View {
    let result: ExploreResult
    @Binding var filters: Set<DiscoveryFilter>

    var body: some View {
        if result.outcome == .discovered, !result.breakdown.isEmpty || !result.collectibles.isEmpty {
            MoreFlowLayout {
                ForEach(result.breakdown, id: \.tag) { entry in
                    pill(.character(entry.tag)) {
                        StazaChip(entry.tag.breakdown(entry.count), systemImage: entry.tag.systemImage, tint: entry.tag.tint)
                    }
                }
                if !result.collectibles.isEmpty {
                    pill(.collectibles) {
                        StazaChip("world.explore.collectibles \(result.summary.collectibles ?? result.collectibles.count)",
                                  systemImage: "mappin", tint: StazaColor.textMuted)
                    }
                }
            }
            .accessibilityIdentifier("exploreFindings")
        }
    }

    private func pill(_ filter: DiscoveryFilter, @ViewBuilder chip: () -> StazaChip) -> some View {
        let selected = filters.contains(filter)
        return Button {
            withAnimation(.snappy) {
                if selected { filters.remove(filter) } else { filters.insert(filter) }
            }
        } label: {
            chip()
                .overlay(Capsule().strokeBorder(StazaColor.textPrimary, lineWidth: selected ? 1.5 : 0))
                .opacity(filters.isEmpty || selected ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Discoveries

/// The Explore session's toolbar: route planning with its stop count, the title, and "explore again"
/// for wherever the map has been moved to. Routes are generated from route planning.
struct DiscoveriesHeader: View {
    let routeStops: Int
    let isExploring: Bool
    let onPlanRoute: () -> Void
    let onExplore: () -> Void

    var body: some View {
        HStack(spacing: StazaSpacing.sm) {
            PlanRouteButton(routeStops: routeStops, onPlanRoute: onPlanRoute)
            Text("world.discoveries.title")
                .font(StazaFont.title3)
                .foregroundStyle(StazaColor.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
            ExploreButton(isExploring: isExploring, iconOnly: true, onExplore: onExplore)
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.md)
    }
}

/// The Explore session: what the explored area offers, filterable by its findings pills.
struct DiscoveriesContent: View {
    let model: WorldModel
    let planner: RoutePlannerModel
    let onViewOnMap: (WorldSelection) -> Void
    var onZoomOut: () -> Void = {}
    /// Ends the Explore session; until then the sheet stays in route generation.
    var onEnd: () -> Void = {}
    @State private var filters: Set<DiscoveryFilter> = []
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            if let state = model.exploreState, state != .exploring {
                ExploreResultBanner(
                    state: state,
                    onZoomOut: onZoomOut,
                    intent: Binding(get: { planner.intent }, set: { planner.intent = $0 }),
                    clamped: model.exploreFrame != nil
                )
            }

            let items = DiscoveryItem.list(flowlines: model.sessionFlowlines, collectibles: model.sessionCollectibles, filters: filters)
            if model.sessionFlowlines.isEmpty && model.sessionCollectibles.isEmpty {
                Text("world.discoveries.empty").font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
            } else {
                if case .result(let result) = model.exploreState { ExploreFindings(result: result, filters: $filters) }
                VStack(spacing: 0) {
                    ForEach(items) { item in
                        row(item)
                        if item.id != items.last?.id { Divider().overlay(StazaColor.textSubtle.opacity(0.2)) }
                    }
                }
            }

            Button(role: .destructive, action: onEnd) {
                Label("world.explore.end", systemImage: "xmark.circle")
            }
            .buttonStyle(.stazaDestructive)
            .accessibilityIdentifier("exploreEnd")
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.lg)
        .onChange(of: model.exploreState) { _, _ in filters = [] }
        .accessibilityIdentifier("discoveriesSheet")
    }

    /// One row: icon and name, its facts below, map and add on the right. Tapping the row shows it on the map.
    private func row(_ item: DiscoveryItem) -> some View {
        let stop = plannerStop(item)
        let inRoute = planner.contains(stop)
        return HStack(alignment: .center, spacing: StazaSpacing.sm) {
            Button { onViewOnMap(item.selection) } label: {
                HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
                    icon(item)
                    VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                        Text(verbatim: name(item))
                            .font(StazaFont.subheadline.weight(.semibold))
                            .foregroundStyle(StazaColor.textPrimary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        let facts = facts(item)
                        if !facts.isEmpty { MetricLine(items: facts) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            CircleIconButton("world.discoveries.viewOnMap", systemImage: "map", tint: StazaColor.textMuted) { onViewOnMap(item.selection) }
            CircleIconButton(inRoute ? "world.route.added" : "world.route.add",
                       systemImage: inRoute ? "checkmark" : "plus",
                       tint: inRoute ? StazaColor.onAccent : StazaColor.accent,
                       filled: inRoute) { planner.toggle(stop) }
                .accessibilityAddTraits(inRoute ? .isSelected : [])
        }
        .padding(.vertical, StazaSpacing.md)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("discovery.\(item.id)")
    }

    @ViewBuilder
    private func icon(_ item: DiscoveryItem) -> some View {
        switch item {
        case .flowline(let flowline):
            let primary = flowline.resolvedCharacter.primary
            Image(systemName: primary.systemImage)
                .foregroundStyle(primary.tint)
                .accessibilityLabel(Text(primary.scoreLabel))
        case .collectible(let collectible):
            Image(systemName: WorldCategory.systemImage(collectible.primaryCategory))
                .foregroundStyle(StazaColor.textMuted)
                .accessibilityHidden(true)
        }
    }

    private func name(_ item: DiscoveryItem) -> String {
        switch item {
        case .flowline(let flowline): flowline.name
        case .collectible(let collectible): collectible.name
        }
    }

    private func plannerStop(_ item: DiscoveryItem) -> PlannerStop {
        switch item {
        case .flowline(let flowline): .flowline(flowline)
        case .collectible(let collectible): .collectible(collectible)
        }
    }

    /// Flowlines: length (no elevation data exists for them). Collectibles: category and elevation.
    private func facts(_ item: DiscoveryItem) -> [String] {
        var items: [String] = []
        switch item {
        case .flowline(let flowline):
            if let length = flowline.lengthMeters { items.append(StazaFormat.distance(meters: length, locale: locale)) }
            if flowline.completed { items.append(String(localized: "world.detail.completed", locale: locale)) }
        case .collectible(let collectible):
            items.append(Bundle.main.localizedString(forKey: WorldCategory.labelKey(collectible.primaryCategory), value: nil, table: nil))
            if let elevation = collectible.elevationMeters {
                items.append(String(localized: "world.discoveries.elevation \(StazaFormat.number(elevation, locale: locale))", locale: locale))
            }
        }
        return items
    }
}
