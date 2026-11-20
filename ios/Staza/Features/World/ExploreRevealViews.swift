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

// MARK: - Map CTA

/// The map's primary Explore button and the small "Plan route" button beside it.
struct ExploreCTA: View {
    let action: ExploreAction
    let isExploring: Bool
    let routeStops: Int
    let onExplore: () -> Void
    let onPlanRoute: () -> Void

    var body: some View {
        HStack(spacing: StazaSpacing.sm) {
            Button(action: onExplore) {
                HStack(spacing: StazaSpacing.sm) {
                    if isExploring {
                        SwiftUI.ProgressView().tint(StazaColor.onAccent)
                    } else {
                        Image(systemName: action == .showFlowlines ? "eye" : "sparkle.magnifyingglass")
                    }
                    Text(isExploring ? "world.explore.exploring" : title)
                }
            }
            .buttonStyle(.stazaPrimary)
            .disabled(action == .zoomIn || isExploring)
            .accessibilityIdentifier("exploreThisArea")

            Button(action: onPlanRoute) {
                Label {
                    if routeStops > 0 { Text("world.planRoute.count \(routeStops)") } else { Text("world.planRoute") }
                } icon: {
                    Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                }
                .font(StazaFont.footnote.weight(.semibold))
            }
            .buttonStyle(.stazaSecondary)
            .accessibilityIdentifier("worldPlanRoute")
        }
        .padding(StazaSpacing.xs)
        .stazaGlass(cornerRadius: StazaRadius.card)
    }

    private var title: LocalizedStringKey {
        switch action {
        case .zoomIn: "world.explore.cta.zoomIn"
        case .explore: "world.explore.cta.explore"
        case .exploreNew: "world.explore.cta.exploreNew"
        case .showFlowlines: "world.explore.cta.show"
        }
    }
}

// MARK: - Result card

/// The reveal moment and what Explore found: discoveries, nothing new, or an already explored area.
struct ExploreResultCard: View {
    let state: ExploreState
    let onViewDiscoveries: () -> Void
    let onPlanRoute: () -> Void
    let onZoomOut: () -> Void
    let onShowKnown: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            switch state {
            case .exploring:
                HStack(spacing: StazaSpacing.sm) {
                    SwiftUI.ProgressView().tint(StazaColor.accent)
                    Text("world.explore.exploring").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                }
            case .failed(let message):
                header(Text("world.explore.error.title"), systemImage: "exclamationmark.triangle.fill", tint: StazaColor.danger)
                if let message { Text(verbatim: message).font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted) }
            case .result(let result):
                resultContent(result)
            }
        }
        .padding(StazaSpacing.md)
        .frame(maxWidth: 420, alignment: .leading)
        .stazaGlass(cornerRadius: StazaRadius.card)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("exploreResult")
    }

    @ViewBuilder
    private func resultContent(_ result: ExploreResult) -> some View {
        switch result.outcome {
        case .nothingNew:
            header(Text("world.explore.nothing.title"), systemImage: "binoculars", tint: StazaColor.textMuted)
            Text("world.explore.nothing.body").font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
            HStack(spacing: StazaSpacing.sm) {
                Button("world.explore.zoomOut", action: onZoomOut).buttonStyle(.stazaPrimary)
                Button("world.explore.another", action: onDismiss).buttonStyle(.stazaSecondary)
            }
        case .alreadyExplored:
            header(Text("world.explore.explored.title"), systemImage: "checkmark.seal", tint: StazaColor.success)
            Text("world.explore.known \(result.knownCount)").font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
            HStack(spacing: StazaSpacing.sm) {
                Button("world.explore.showKnown", action: onShowKnown).buttonStyle(.stazaPrimary)
                Button("world.explore.done", action: onDismiss).buttonStyle(.stazaSecondary)
            }
        case .discovered, .alreadyExploredNew:
            header(Text("world.explore.discovered \(result.summary.total)"), systemImage: "sparkles", tint: StazaColor.accent)
            if result.outcome == .alreadyExploredNew {
                Text("world.explore.knownNew \(max(0, result.knownCount - result.summary.total)) \(result.summary.total)")
                    .font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
            }
            if !result.breakdown.isEmpty {
                HStack(spacing: StazaSpacing.sm) {
                    ForEach(result.breakdown, id: \.tag) { entry in
                        StazaChip(entry.tag.breakdown(entry.count), systemImage: entry.tag.systemImage, tint: entry.tag.tint)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: StazaSpacing.sm) { discoveredActions }
                VStack(alignment: .leading, spacing: StazaSpacing.sm) { discoveredActions }
            }
        }
    }

    @ViewBuilder
    private var discoveredActions: some View {
        Button("world.explore.viewDiscoveries", action: onViewDiscoveries).buttonStyle(.stazaPrimary)
            .accessibilityIdentifier("exploreViewDiscoveries")
        Button("world.explore.planRoute", action: onPlanRoute).buttonStyle(.stazaSecondary)
            .accessibilityIdentifier("explorePlanRoute")
        Button("world.explore.done", action: onDismiss).buttonStyle(.stazaPlain)
    }

    private func header(_ title: Text, systemImage: String, tint: Color) -> some View {
        HStack(spacing: StazaSpacing.sm) {
            IconBadge(systemImage: systemImage, tint: tint, size: 32)
            title.font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary).accessibilityAddTraits(.isHeader)
            Spacer(minLength: StazaSpacing.sm)
            if case .exploring = state {} else {
                SheetCloseButton(action: onDismiss)
            }
        }
    }
}

// MARK: - Discoveries

struct DiscoveriesHeader: View {
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: StazaSpacing.md) {
            IconBadge(systemImage: "sparkles", tint: StazaColor.accent, size: 40)
            Text("world.discoveries.title")
                .font(StazaFont.title3)
                .foregroundStyle(StazaColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: StazaSpacing.sm)
            SheetCloseButton(action: onClose)
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.md)
    }
}

/// "View discoveries": what the visible area holds and its revealed Flowlines, sortable.
struct DiscoveriesContent: View {
    let model: WorldModel
    let planner: RoutePlannerModel
    let origin: GeoPoint?
    let onViewOnMap: (WorldFlowline) -> Void
    @State private var sort = DiscoverySort.flow
    @Environment(\.locale) private var locale

    var body: some View {
        let counts = AreaCounts(collectibles: model.collectibles, flowlines: model.flowlines)
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
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

            if model.flowlines.isEmpty {
                Text("world.discoveries.empty").font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
            } else {
                Picker("world.discoveries.sort", selection: $sort) {
                    ForEach(DiscoverySort.allCases) { Text(label($0)).tag($0) }
                }
                .pickerStyle(.segmented)
                ForEach(sort.sorted(model.flowlines, origin: origin)) { card($0) }
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
                    Button { onViewOnMap(flowline) } label: { Label("world.discoveries.viewOnMap", systemImage: "map") }
                        .buttonStyle(.stazaSecondary)
                    Button { planner.toggle(.flowline(flowline)) } label: {
                        Label(inRoute ? "world.route.added" : "world.route.add", systemImage: inRoute ? "checkmark" : "plus")
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
