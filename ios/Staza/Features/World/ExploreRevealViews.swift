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

/// Compact Explore button for the World sheet header; its label follows the area status.
struct ExploreButton: View {
    let action: ExploreAction
    let isExploring: Bool
    let onExplore: () -> Void

    var body: some View {
        Button(action: onExplore) {
            HStack(spacing: StazaSpacing.xs) {
                if isExploring {
                    SwiftUI.ProgressView().controlSize(.small).tint(StazaColor.onAccent)
                } else {
                    Image(systemName: "sparkle.magnifyingglass")
                }
                Text(title).lineLimit(1)
            }
            .font(StazaFont.footnote.weight(.semibold))
        }
        .buttonStyle(.stazaPrimary)
        .disabled(action == .zoomIn || isExploring)
        .fixedSize()
        .accessibilityIdentifier("exploreThisArea")
    }

    private var title: LocalizedStringKey {
        if isExploring { return "world.explore.exploring" }
        switch action {
        case .zoomIn: return "world.explore.cta.zoomIn"
        case .explore: return "world.explore.cta.explore"
        }
    }
}

/// Icon-only "Plan route" button; a badge counts the stops picked so far.
struct PlanRouteButton: View {
    let routeStops: Int
    let onPlanRoute: () -> Void

    var body: some View {
        Button(action: onPlanRoute) {
            Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
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

/// What this Explore session found, shown at the top of the opportunities sheet, with its actions.
struct ExploreResultBanner: View {
    let state: ExploreState
    let onZoomOut: () -> Void
    var onGenerate: () -> Void = {}
    var onViewOpportunities: () -> Void = {}

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
            header(Text("world.explore.discovered \(result.summary.total)"), systemImage: "sparkles", tint: StazaColor.accent)
            if !result.breakdown.isEmpty || !result.collectibles.isEmpty {
                MoreFlowLayout {
                    ForEach(result.breakdown, id: \.tag) { entry in
                        StazaChip(entry.tag.breakdown(entry.count), systemImage: entry.tag.systemImage, tint: entry.tag.tint)
                    }
                    if !result.collectibles.isEmpty {
                        StazaChip("world.explore.collectibles \(result.summary.collectibles ?? result.collectibles.count)", systemImage: "mappin", tint: StazaColor.textMuted)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        Text("world.explore.session.hint").font(StazaFont.caption).foregroundStyle(StazaColor.textSubtle)
        HStack(spacing: StazaSpacing.sm) {
            Button(action: onGenerate) {
                Label("world.explore.generate", systemImage: "sparkles")
            }
            .buttonStyle(.stazaPrimaryWide)
            .accessibilityIdentifier("exploreGenerate")
            if result.outcome == .discovered {
                Button(action: onViewOpportunities) {
                    Label("world.explore.viewOpportunities", systemImage: "list.bullet")
                }
                .buttonStyle(.stazaSecondary)
                .accessibilityIdentifier("exploreViewOpportunities")
            }
        }
    }

    private func header(_ title: Text, systemImage: String, tint: Color) -> some View {
        HStack(spacing: StazaSpacing.sm) {
            IconBadge(systemImage: systemImage, tint: tint, size: 28)
            title.font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary).accessibilityAddTraits(.isHeader)
        }
    }
}

// MARK: - Discoveries

struct DiscoveriesHeader: View {
    let routeStops: Int
    let onPlanRoute: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: StazaSpacing.md) {
            IconBadge(systemImage: "sparkles", tint: StazaColor.accent, size: 40)
            Text("world.discoveries.title")
                .font(StazaFont.title3)
                .foregroundStyle(StazaColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: StazaSpacing.sm)
            PlanRouteButton(routeStops: routeStops, onPlanRoute: onPlanRoute)
            SheetCloseButton(action: onClose)
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.md)
    }
}

/// The Explore session: what the explored area offers and its opportunity Flowlines, sortable.
struct DiscoveriesContent: View {
    let model: WorldModel
    let planner: RoutePlannerModel
    let origin: GeoPoint?
    var onGenerate: () -> Void = {}
    var onViewOpportunities: () -> Void = {}
    let onViewOnMap: (WorldFlowline) -> Void
    var onZoomOut: () -> Void = {}
    @State private var sort = DiscoverySort.flow
    @Environment(\.locale) private var locale

    var body: some View {
        let counts = AreaCounts(collectibles: model.sessionCollectibles, flowlines: model.sessionFlowlines)
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            if let state = model.exploreState, state != .exploring {
                ExploreResultBanner(state: state, onZoomOut: onZoomOut, onGenerate: onGenerate, onViewOpportunities: onViewOpportunities)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: StazaSpacing.sm) {
                    count("world.discoveries.flowlines", counts.flowlines, tint: StazaColor.rarityRare)
                    count("world.discoveries.places", counts.places)
                    count("world.discoveries.peaks", counts.peaks)
                    count("world.discoveries.viewpoints", counts.viewpoints)
                    if counts.castles > 0 { count("world.discoveries.castles", counts.castles) }
                    if counts.passes > 0 { count("world.discoveries.passes", counts.passes) }
                }
            }
            .scrollClipDisabled()
            .accessibilityIdentifier("discoveriesCounts")

            if model.sessionFlowlines.isEmpty {
                Text("world.discoveries.empty").font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
            } else {
                Picker("world.discoveries.sort", selection: $sort) {
                    ForEach(DiscoverySort.allCases) { Text(label($0)).tag($0) }
                }
                .pickerStyle(.segmented)
                ForEach(sort.sorted(model.sessionFlowlines, origin: origin)) { card($0) }
            }
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.lg)
        .accessibilityIdentifier("discoveriesSheet")
    }

    private func count(_ label: LocalizedStringKey, _ value: Int, tint: Color = StazaColor.textPrimary) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
            Text(verbatim: "\(value)").font(StazaFont.title3.monospacedDigit()).foregroundStyle(tint)
            OverlineText(label)
        }
        .padding(.horizontal, StazaSpacing.md - 2)
        .padding(.vertical, StazaSpacing.sm)
        .background(StazaColor.surfaceRaised.opacity(0.85), in: RoundedRectangle(cornerRadius: StazaRadius.card, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func card(_ flowline: WorldFlowline) -> some View {
        let inRoute = planner.contains(.flowline(flowline))
        return StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
                    Text(verbatim: flowline.name).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary).lineLimit(2)
                    Spacer(minLength: StazaSpacing.xs)
                    FlowlineCharacterChip(flowline: flowline)
                }
                MetricLine(items: facts(flowline))
                HStack(spacing: StazaSpacing.sm) {
                    Button { onViewOnMap(flowline) } label: {
                        Label("world.discoveries.viewOnMap", systemImage: "map").labelStyle(.iconOnly)
                    }
                    .buttonStyle(.stazaSecondary)
                    Button { planner.toggle(.flowline(flowline)) } label: {
                        Label(inRoute ? "world.route.added" : "world.route.add", systemImage: inRoute ? "checkmark" : "plus").labelStyle(.iconOnly)
                    }
                    .buttonStyle(.stazaSecondary)
                    .accessibilityAddTraits(inRoute ? .isSelected : [])
                }
            }
        }
        .accessibilityIdentifier("discovery.\(flowline.id)")
    }

    private func facts(_ flowline: WorldFlowline) -> [String] {
        var items: [String] = []
        if let length = flowline.lengthMeters { items.append(StazaFormat.distance(meters: length, locale: locale)) }
        items.append(String(localized: flowline.completed ? "world.detail.completed" : "world.flowline.unridden", locale: locale))
        return items
    }

    private func label(_ sort: DiscoverySort) -> LocalizedStringKey {
        switch sort {
        case .flow: "world.discoveries.sort.flow"
        case .endurance: "world.discoveries.sort.endurance"
        case .unridden: "world.discoveries.sort.unridden"
        case .nearby: "world.discoveries.sort.nearby"
        }
    }
}
