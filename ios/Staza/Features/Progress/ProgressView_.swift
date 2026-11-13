import SwiftUI

/// Named to avoid clashing with SwiftUI's `ProgressView`.
struct ProgressView_: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.locale) private var locale
    @State private var model: ProgressDashboardModel?

    private let gridColumns = [GridItem(.flexible(), spacing: StazaSpacing.md), GridItem(.flexible(), spacing: StazaSpacing.md)]

    var body: some View {
        Group {
            if let model { content(model) } else { StazaLoadingView(title: "home.loading") }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .stazaScreen()
        .navigationDestination(for: ActivityHistoryItem.self) { ActivityDetailView(activity: $0) }
        .task(id: container.dataRevision) {
            if model == nil { model = ProgressDashboardModel(api: container.apiClient) }
            await model?.load()
        }
        .accessibilityIdentifier("progressScreen")
    }

    @ViewBuilder
    private func content(_ model: ProgressDashboardModel) -> some View {
        if let dashboard = model.dashboard {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: StazaSpacing.md) {
                    if model.showsNewRewards { rewardsBanner }
                    LevelHeroCard(progress: dashboard.progress, showsTotalXp: true)
                    lifetimeSection(dashboard)
                    milestonesSection(dashboard.milestones)
                    if !dashboard.sportRecords.isEmpty { recordsSection(dashboard.sportRecords) }
                    if !dashboard.recentActivities.isEmpty { recentSection(dashboard.recentActivities) }
                    if !dashboard.questHistory.isEmpty { questsSection(dashboard.questHistory) }
                    allActivitiesLink
                }
                .padding(.horizontal, StazaSpacing.md)
                .padding(.vertical, StazaSpacing.sm)
            }
            .refreshable { await model.load() }
        } else if model.isLoading || !model.failed {
            StazaLoadingView(title: "home.loading")
        } else {
            ScrollView {
                StazaStateView(systemImage: "exclamationmark.triangle.fill", tint: StazaColor.danger, title: Text("progress.error")) {
                    Button("quests.retry") { Task { await model.load() } }.buttonStyle(.stazaSecondary)
                }
                .padding(.horizontal, StazaSpacing.md)
            }
            .refreshable { await model.load() }
        }
    }

    private var rewardsBanner: some View {
        StazaCard(tint: StazaColor.accent) {
            HStack(spacing: StazaSpacing.md) {
                IconBadge(systemImage: "sparkles", tint: StazaColor.accent)
                Text("progress.newRewards")
                    .font(StazaFont.headline)
                    .foregroundStyle(StazaColor.accent)
                Spacer(minLength: 0)
            }
        }
        .background(StazaColor.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: StazaRadius.card, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("newRewardsBanner")
    }

    private func lifetimeSection(_ dashboard: ProgressDashboard) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            SectionHeader("progress.lifetime")
            StazaCard {
                LazyVGrid(columns: gridColumns, alignment: .leading, spacing: StazaSpacing.md) {
                    StatTile(label: "progress.stat.totalXp", value: StazaFormat.number(dashboard.progress.totalXp, locale: locale), tint: StazaColor.accent)
                    StatTile(label: "progress.stat.distance", value: StazaFormat.distance(meters: dashboard.lifetime.distanceMeters, locale: locale))
                    StatTile(label: "progress.stat.collectibles", value: StazaFormat.number(Double(dashboard.lifetime.totalCollectibles), locale: locale))
                    StatTile(label: "progress.stat.flowlines", value: StazaFormat.number(Double(dashboard.lifetime.totalFlowlines), locale: locale))
                }
            }
        }
    }

    private func milestonesSection(_ milestones: ProgressDashboard.Milestones) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            SectionHeader("progress.milestones.header")
            HStack(spacing: StazaSpacing.sm) {
                milestoneTile("progress.milestone.places", systemImage: "mappin.and.ellipse", count: milestones.places, tint: StazaColor.rarityRare)
                milestoneTile("progress.milestone.peaks", systemImage: "mountain.2.fill", count: milestones.peaks, tint: StazaColor.rarityEpic)
                milestoneTile("progress.milestone.passes", systemImage: "road.lanes", count: milestones.mountainPasses, tint: StazaColor.rarityLegendary)
            }
        }
    }

    private func milestoneTile(_ label: LocalizedStringKey, systemImage: String, count: Int, tint: Color) -> some View {
        StazaCard(padding: StazaSpacing.sm + StazaSpacing.xs) {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                IconBadge(systemImage: systemImage, tint: tint, size: 28)
                StatTile(label: label, value: StazaFormat.number(Double(count), locale: locale))
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func recordsSection(_ records: [ProgressDashboard.SportRecord]) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            SectionHeader("progress.records")
            ForEach(records) { record in
                StazaCard {
                    HStack(alignment: .top, spacing: StazaSpacing.md) {
                        IconBadge(systemImage: Self.sportSymbol(record.type))
                        VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                            Text(verbatim: record.type.capitalized)
                                .font(StazaFont.headline)
                                .foregroundStyle(StazaColor.textPrimary)
                            Text("progress.recordDetail \(record.activityCount) \(StazaFormat.distance(meters: record.longestDistanceMeters, locale: locale))")
                                .font(StazaFont.subheadline)
                                .foregroundStyle(StazaColor.textMuted)
                            MetricLine(items: recordMetrics(record))
                        }
                        Spacer(minLength: 0)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func recordMetrics(_ record: ProgressDashboard.SportRecord) -> [String] {
        var items = [StazaFormat.distance(meters: record.distanceMeters, locale: locale)]
        if let gain = record.highestElevationGainM, gain > 0 {
            items.append("\(StazaFormat.number(gain, locale: locale)) m ↑")
        }
        return items
    }

    private func recentSection(_ recent: [ProgressDashboard.RecentActivity]) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            SectionHeader("progress.recent")
            ForEach(recent) { item in
                NavigationLink(value: item.activity) {
                    StazaCard {
                        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                            HStack(alignment: .center, spacing: StazaSpacing.md) {
                                IconBadge(systemImage: Self.sportSymbol(item.activity.type))
                                VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                                    if let date = item.activity.startedDate {
                                        OverlineText(verbatim: StazaFormat.date(date, locale: locale))
                                    }
                                    Text(verbatim: item.activity.title)
                                        .font(StazaFont.headline)
                                        .foregroundStyle(StazaColor.textPrimary)
                                        .lineLimit(1)
                                }
                                Spacer(minLength: StazaSpacing.sm)
                                Text("activities.row.xp \(StazaFormat.number(item.activity.xpEarned, locale: locale))")
                                    .font(StazaFont.metric.weight(.semibold))
                                    .foregroundStyle(StazaColor.accent)
                                Image(systemName: "chevron.right")
                                    .font(StazaFont.footnote.weight(.semibold))
                                    .foregroundStyle(StazaColor.textSubtle)
                                    .accessibilityHidden(true)
                            }
                            let metrics = activityMetrics(item.activity)
                            if !metrics.isEmpty { MetricLine(items: metrics) }
                            StazaProgressBar(value: item.xpPercentOfBest / 100, height: 4)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func activityMetrics(_ activity: ActivityHistoryItem) -> [String] {
        var items: [String] = []
        if let meters = activity.distanceMeters { items.append(StazaFormat.distance(meters: meters, locale: locale)) }
        if let seconds = activity.durationSeconds, seconds > 0 {
            let formatter = DateComponentsFormatter()
            formatter.allowedUnits = seconds >= 3600 ? [.hour, .minute] : [.minute]
            formatter.unitsStyle = .abbreviated
            var calendar = Calendar.current
            calendar.locale = locale
            formatter.calendar = calendar
            if let text = formatter.string(from: seconds) { items.append(text) }
        }
        return items
    }

    private func questsSection(_ history: [ProgressDashboard.QuestHistoryEntry]) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            SectionHeader("progress.quests")
            StazaCard(padding: 0) {
                VStack(spacing: 0) {
                    ForEach(Array(history.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { Divider().overlay(StazaColor.border).padding(.leading, 68) }
                        HStack(spacing: StazaSpacing.md) {
                            IconBadge(systemImage: "checkmark.seal.fill", tint: StazaColor.success)
                            Text(verbatim: entry.title)
                                .font(StazaFont.body)
                                .foregroundStyle(StazaColor.textPrimary)
                            Spacer(minLength: StazaSpacing.sm)
                            Text("home.quest.reward \(StazaFormat.number(entry.xp, locale: locale))")
                                .font(StazaFont.metric.weight(.semibold))
                                .foregroundStyle(StazaColor.accent)
                        }
                        .padding(.horizontal, StazaSpacing.md)
                        .padding(.vertical, StazaSpacing.sm + StazaSpacing.xs)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    private var allActivitiesLink: some View {
        NavigationLink { ActivitiesView().navigationTitle("progress.allActivities") } label: {
            StazaCard {
                HStack(spacing: StazaSpacing.md) {
                    IconBadge(systemImage: "list.bullet.rectangle.fill")
                    Text("progress.allActivities")
                        .font(StazaFont.headline)
                        .foregroundStyle(StazaColor.textPrimary)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(StazaFont.footnote.weight(.semibold))
                        .foregroundStyle(StazaColor.textSubtle)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.top, StazaSpacing.sm)
        .accessibilityIdentifier("allActivitiesLink")
    }

    private static func sportSymbol(_ type: String) -> String {
        switch type.lowercased() {
        case let t where t.contains("run"): "figure.run"
        case let t where t.contains("hik") || t.contains("walk"): "figure.hiking"
        case let t where t.contains("ski"): "figure.skiing.downhill"
        default: "bicycle"
        }
    }
}

#Preview {
    NavigationStack { ProgressView_() }
        .environment(AppContainer())
        .preferredColorScheme(.dark)
}
