import SwiftUI

/// Sheet header while browsing: Explore and Plan route; no counts that change with every pan.
struct WorldBrowseHeader: View {
    let model: WorldModel
    let routeStops: Int
    let onExplore: () -> Void
    let onPlanRoute: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: StazaSpacing.sm) {
            VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                Text("world.sheet.title")
                    .font(StazaFont.title3)
                    .foregroundStyle(StazaColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                summary
            }
            Spacer(minLength: StazaSpacing.xs)
            ExploreButton(isExploring: model.isExploring, onExplore: onExplore)
            PlanRouteButton(routeStops: routeStops, onPlanRoute: onPlanRoute)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.md)
        .accessibilityIdentifier("worldBrowseHeader")
    }

    @ViewBuilder
    private var summary: some View {
        if model.viewportFailed {
            Label("world.viewportFailed", systemImage: "exclamationmark.triangle.fill")
                .font(StazaFont.footnote)
                .foregroundStyle(StazaColor.danger)
        }
    }
}

/// Sheet body while browsing: map filters and the player's explorations.
struct WorldBrowseContent: View {
    let model: WorldModel
    let onChanged: () -> Void
    @Environment(\.locale) private var locale
    @State private var lockedInfo: LockedFilterInfo?
    @State private var deleting: QuestInstance?

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.lg) {
            filters
            explorations
        }
        .padding(.bottom, StazaSpacing.lg)
        .alert(item: $lockedInfo) { info in
            Alert(title: Text(info.title), message: Text("world.filter.locked.message \(info.nodeName)"))
        }
        .confirmationDialog("world.explorations.delete.title", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { instance in
            Button("world.explorations.delete.confirm", role: .destructive) {
                Task { if await model.delete(instance.id) { onChanged() } }
            }
        }
    }

    // MARK: Filters

    private var filters: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            SectionHeader("world.filters.header") {
                if !model.selectedFilters.isEmpty {
                    Button("world.filters.clear") { withAnimation(.snappy) { model.clearFilters() } }
                        .accessibilityIdentifier("worldFilterClear")
                }
            }
            .padding(.horizontal, StazaSpacing.md)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: StazaSpacing.sm) {
                    FilterChip(title: "world.filter.all", systemImage: "square.grid.2x2.fill", tint: StazaColor.accent, selected: model.selectedFilters.isEmpty) {
                        withAnimation(.snappy) { model.clearFilters() }
                    }
                    .accessibilityIdentifier("worldFilter.all")
                    ForEach(model.availableFilters) { filter in
                        FilterChip(title: filter.title, systemImage: filter.systemImage, tint: filter.tint, selected: model.selectedFilters.contains(filter)) {
                            withAnimation(.snappy) { model.toggle(filter) }
                        }
                        .accessibilityIdentifier("worldFilter.\(filter.rawValue)")
                    }
                    ForEach(model.lockedFilters, id: \.filter) { locked in
                        FilterChip(title: locked.filter.title, systemImage: "lock.fill", tint: StazaColor.textSubtle, selected: false, locked: true) {
                            lockedInfo = LockedFilterInfo(filter: locked.filter, nodeName: locked.nodeName)
                        }
                        .accessibilityIdentifier("worldFilter.\(locked.filter.rawValue)")
                    }
                }
                .padding(.horizontal, StazaSpacing.md)
                .padding(.vertical, StazaSpacing.xxs)
            }
        }
    }

    // MARK: Explorations

    private var sortedInstances: [QuestInstance] {
        let rank = ["active": 0, "partially_completed": 0, "planned": 1, "completed": 2]
        return model.instances.enumerated()
            .sorted { (rank[$0.element.status] ?? 3, $0.offset) < (rank[$1.element.status] ?? 3, $1.offset) }
            .map(\.element)
    }

    private var explorations: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            SectionHeader("world.explorations.header")
            if model.instanceActionFailed {
                Label("world.explorations.error", systemImage: "exclamationmark.triangle.fill")
                    .font(StazaFont.footnote)
                    .foregroundStyle(StazaColor.danger)
            }
            if model.instances.isEmpty {
                Text("world.explorations.empty")
                    .font(StazaFont.subheadline)
                    .foregroundStyle(StazaColor.textMuted)
                    .padding(.vertical, StazaSpacing.sm)
            } else {
                ForEach(sortedInstances) { explorationCard($0) }
            }
        }
        .padding(.horizontal, StazaSpacing.md)
    }

    private func explorationCard(_ instance: QuestInstance) -> some View {
        let highlighted = model.highlightedInstanceId == instance.id
        let progress = instance.targetProgress
        let pending = model.pendingInstanceId == instance.id
        return StazaCard(tint: highlighted ? StazaColor.accent : nil) {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                Button {
                    Task { await model.highlight(instance.id) }
                } label: {
                    VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                        HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
                            Text(verbatim: instance.title)
                                .font(StazaFont.headline)
                                .foregroundStyle(StazaColor.textPrimary)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: StazaSpacing.xs)
                            statusChip(instance.status)
                        }
                        if progress.total > 0 {
                            HStack(spacing: StazaSpacing.sm) {
                                StazaProgressBar(value: Double(progress.completed) / Double(progress.total), tint: instance.status == "completed" ? StazaColor.success : StazaColor.accent)
                                Text(verbatim: "\(progress.completed)/\(progress.total)")
                                    .font(StazaFont.metricSmall)
                                    .foregroundStyle(StazaColor.textMuted)
                            }
                        }
                        if let route = model.plannedRoutes[instance.id] {
                            MetricLine(items: [StazaFormat.distance(meters: route.distanceM, locale: locale), duration(route.durationS)])
                        }
                        Label(highlighted ? "world.explorations.shown" : "world.explorations.show", systemImage: highlighted ? "scope" : "map")
                            .font(StazaFont.footnote.weight(.medium))
                            .foregroundStyle(highlighted ? StazaColor.accent : StazaColor.textMuted)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(highlighted ? .isSelected : [])
                .accessibilityHint(Text("world.explorations.show.hint"))

                HStack {
                    if instance.isPlanned {
                        Button {
                            Task { if await model.start(instance.id) { onChanged() } }
                        } label: {
                            Label("world.explorations.start", systemImage: "flag.fill")
                        }
                        .buttonStyle(.stazaPrimary)
                        .accessibilityIdentifier("worldExplorationStart.\(instance.id)")
                    }
                    Button("world.explorations.delete", role: .destructive) { deleting = instance }
                        .buttonStyle(.stazaSecondary)
                        .accessibilityIdentifier("worldExplorationDelete.\(instance.id)")
                    if pending { SwiftUI.ProgressView().tint(StazaColor.accent) }
                }
                .disabled(model.pendingInstanceId != nil)
            }
        }
        .animation(.snappy(duration: 0.2), value: highlighted)
        .accessibilityIdentifier("worldExploration.\(instance.id)")
    }

    private func statusChip(_ status: String) -> some View {
        switch status {
        case "planned": StazaChip("world.explorations.status.planned", systemImage: "calendar", tint: StazaColor.textMuted)
        case "active": StazaChip("world.explorations.status.active", systemImage: "flag.fill", tint: StazaColor.accent)
        case "partially_completed": StazaChip("world.explorations.status.partiallyCompleted", systemImage: "circle.lefthalf.filled", tint: StazaColor.accent)
        case "completed": StazaChip("world.explorations.status.completed", systemImage: "checkmark.seal.fill", tint: StazaColor.success)
        default: StazaChip(verbatim: status.capitalized)
        }
    }

    private func duration(_ seconds: Double) -> String {
        let minutes = Int((seconds / 60).rounded())
        return minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min"
    }
}

private struct LockedFilterInfo: Identifiable {
    let filter: WorldFilter
    let nodeName: String
    var id: String { filter.rawValue }
    var title: LocalizedStringKey { filter.title }
}

/// Selectable capsule with a marker swatch icon, like the web World filter buttons.
private struct FilterChip: View {
    let title: LocalizedStringKey
    let systemImage: String
    let tint: Color
    let selected: Bool
    var locked = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: StazaSpacing.xs + 2) {
                Image(systemName: systemImage)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(selected ? StazaColor.onAccent : tint)
                    .accessibilityHidden(true)
                Text(title)
                    .font(StazaFont.subheadline.weight(.medium))
                    .lineLimit(1)
            }
            .foregroundStyle(selected ? StazaColor.onAccent : (locked ? StazaColor.textSubtle : StazaColor.textPrimary))
            .padding(.horizontal, StazaSpacing.md - 2)
            .frame(minHeight: 36)
            .background(selected ? StazaColor.accent : StazaColor.surfaceRaised.opacity(0.85), in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? StazaColor.accent : StazaColor.border, style: StrokeStyle(lineWidth: 1, dash: locked ? [3, 3] : [])))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityHint(locked ? Text("world.filter.locked.hint") : Text(verbatim: ""))
        .sensoryFeedback(.selection, trigger: selected)
    }
}
