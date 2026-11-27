import SwiftUI

/// The player's saved Explorations below a fresh plan: show a route on the map or delete it.
struct SavedExplorationsList: View {
    let model: WorldModel
    let onChanged: () -> Void
    @Environment(\.locale) private var locale
    @State private var deleting: QuestInstance?

    var body: some View {
        if !model.instances.isEmpty {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                SectionHeader("world.explorations.header")
                if model.instanceActionFailed {
                    Label("world.explorations.error", systemImage: "exclamationmark.triangle.fill")
                        .font(StazaFont.footnote)
                        .foregroundStyle(StazaColor.danger)
                }
                ForEach(sortedInstances) { card($0) }
            }
            .padding(.horizontal, StazaSpacing.md)
            .padding(.bottom, StazaSpacing.lg)
            .confirmationDialog("world.explorations.delete.title", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                                titleVisibility: .visible, presenting: deleting) { instance in
                Button("world.explorations.delete.confirm", role: .destructive) {
                    Task { if await model.delete(instance.id) { onChanged() } }
                }
            }
        }
    }

    private var sortedInstances: [QuestInstance] {
        let rank = ["active": 0, "partially_completed": 0, "completed": 1]
        return model.instances.enumerated()
            .sorted { (rank[$0.element.status] ?? 3, $0.offset) < (rank[$1.element.status] ?? 3, $1.offset) }
            .map(\.element)
    }

    private func card(_ instance: QuestInstance) -> some View {
        let highlighted = model.highlightedInstanceId == instance.id
        let progress = instance.targetProgress
        return StazaCard(tint: highlighted ? StazaColor.accent : nil) {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                Button { model.highlight(instance.id) } label: {
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
                                StazaProgressBar(value: Double(progress.completed) / Double(progress.total),
                                                 tint: instance.status == "completed" ? StazaColor.success : StazaColor.accent)
                                Text(verbatim: "\(progress.completed)/\(progress.total)")
                                    .font(StazaFont.metricSmall)
                                    .foregroundStyle(StazaColor.textMuted)
                            }
                        }
                        if let route = model.plannedRoutes[instance.id] {
                            MetricLine(items: [StazaFormat.distance(meters: route.distanceM, locale: locale),
                                               ActivityStyle.duration(seconds: route.durationS, locale: locale)])
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(highlighted ? .isSelected : [])
                .accessibilityHint(Text("world.explorations.show.hint"))

                HStack {
                    Button("world.explorations.delete", role: .destructive) { deleting = instance }
                        .buttonStyle(.stazaSecondary)
                        .accessibilityIdentifier("worldExplorationDelete.\(instance.id)")
                    if model.pendingInstanceId == instance.id { SwiftUI.ProgressView().tint(StazaColor.accent) }
                }
                .disabled(model.pendingInstanceId != nil)
            }
        }
        .animation(.snappy(duration: 0.2), value: highlighted)
        .accessibilityIdentifier("worldExploration.\(instance.id)")
    }

    /// Only progress is labelled; an Exploration in progress has no status chip.
    @ViewBuilder
    private func statusChip(_ status: String) -> some View {
        switch status {
        case "partially_completed": StazaChip("world.explorations.status.partiallyCompleted", systemImage: "circle.lefthalf.filled", tint: StazaColor.accent)
        case "completed": StazaChip("world.explorations.status.completed", systemImage: "checkmark.seal.fill", tint: StazaColor.success)
        default: EmptyView()
        }
    }
}
