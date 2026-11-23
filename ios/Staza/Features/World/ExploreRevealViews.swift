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
        .disabled(isExploring)
        .fixedSize()
        .accessibilityIdentifier("exploreThisArea")
    }

    private var title: LocalizedStringKey {
        isExploring ? "world.explore.exploring" : "world.explore.cta.explore"
    }
}

/// Flow / Chill / Explore for "Generate route"; the names stay the same in every language.
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

/// What this Explore session found, shown at the top of the opportunities sheet: its pills and the route feel.
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

// MARK: - Discoveries

/// The Explore session's toolbar: "Generate route" replaces the close button; the session ends from the list.
struct DiscoveriesHeader: View {
    let routeStops: Int
    let onPlanRoute: () -> Void
    let onGenerate: () -> Void

    var body: some View {
        HStack(spacing: StazaSpacing.sm) {
            Text("world.discoveries.title")
                .font(StazaFont.title3)
                .foregroundStyle(StazaColor.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: StazaSpacing.xs)
            PlanRouteButton(routeStops: routeStops, onPlanRoute: onPlanRoute)
            Button(action: onGenerate) {
                Label("world.explore.generate", systemImage: "sparkles")
                    .font(StazaFont.footnote.weight(.semibold))
                    .lineLimit(1)
            }
            .buttonStyle(.stazaPrimary)
            .fixedSize()
            .accessibilityIdentifier("exploreGenerate")
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
    let onViewOnMap: (WorldFlowline) -> Void
    var onZoomOut: () -> Void = {}
    /// Ends the Explore session; until then the sheet stays in route generation.
    var onEnd: () -> Void = {}
    @State private var sort = DiscoverySort.flow
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

            if model.sessionFlowlines.isEmpty {
                Text("world.discoveries.empty").font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
            } else {
                Picker("world.discoveries.sort", selection: $sort) {
                    ForEach(DiscoverySort.allCases) { Text(label($0)).tag($0) }
                }
                .pickerStyle(.segmented)
                VStack(spacing: 0) {
                    let sorted = sort.sorted(model.sessionFlowlines, origin: origin)
                    ForEach(sorted) { flowline in
                        row(flowline)
                        if flowline.id != sorted.last?.id { Divider().overlay(StazaColor.textSubtle.opacity(0.2)) }
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
        .accessibilityIdentifier("discoveriesSheet")
    }

    /// One compact Flowline row: name and actions, then its character pill and facts.
    private func row(_ flowline: WorldFlowline) -> some View {
        let inRoute = planner.contains(.flowline(flowline))
        return HStack(alignment: .center, spacing: StazaSpacing.sm) {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                Text(verbatim: flowline.name)
                    .font(StazaFont.subheadline.weight(.semibold))
                    .foregroundStyle(StazaColor.textPrimary)
                    .lineLimit(1)
                HStack(spacing: StazaSpacing.sm) {
                    FlowlineCharacterChip(flowline: flowline)
                    MetricLine(items: facts(flowline))
                }
            }
            Spacer(minLength: StazaSpacing.xs)
            iconButton("world.discoveries.viewOnMap", systemImage: "map", tint: StazaColor.textMuted) { onViewOnMap(flowline) }
            iconButton(inRoute ? "world.route.added" : "world.route.add",
                       systemImage: inRoute ? "checkmark" : "plus",
                       tint: inRoute ? StazaColor.onAccent : StazaColor.accent,
                       filled: inRoute) { planner.toggle(.flowline(flowline)) }
                .accessibilityAddTraits(inRoute ? .isSelected : [])
        }
        .padding(.vertical, StazaSpacing.sm)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("discovery.\(flowline.id)")
    }

    private func iconButton(_ label: LocalizedStringKey, systemImage: String, tint: Color, filled: Bool = false,
                            action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.footnote.weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .background(filled ? StazaColor.accent : StazaColor.surfaceRaised, in: Circle())
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }

    /// Length, road quality and distance from the player; elevation is not known for Flowlines.
    private func facts(_ flowline: WorldFlowline) -> [String] {
        var items: [String] = []
        if let length = flowline.lengthMeters { items.append(StazaFormat.distance(meters: length, locale: locale)) }
        if let quality = flowline.roadQualityScore {
            items.append(String(localized: "world.discoveries.road \(Int(quality.rounded()))", locale: locale))
        }
        if let away = flowline.distance(from: origin) {
            items.append(String(localized: "world.discoveries.away \(StazaFormat.distance(meters: away, locale: locale))", locale: locale))
        }
        if flowline.completed { items.append(String(localized: "world.detail.completed", locale: locale)) }
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
