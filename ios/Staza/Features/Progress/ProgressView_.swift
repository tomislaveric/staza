import SwiftUI

/// Named to avoid clashing with SwiftUI's `ProgressView`.
struct ProgressView_: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.locale) private var locale
    @State private var model: ProgressDashboardModel?

    var body: some View {
        Group {
            if let model { content(model) } else { Color.clear }
        }
        .background(StazaColor.canvas)
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
                    levelCard(dashboard.progress)
                    lifetimeCard(dashboard)
                    if !dashboard.sportRecords.isEmpty { recordsCard(dashboard.sportRecords) }
                    if !dashboard.recentActivities.isEmpty { recentCard(dashboard.recentActivities) }
                    if !dashboard.questHistory.isEmpty { questsCard(dashboard.questHistory) }
                    NavigationLink { ActivitiesView().navigationTitle("progress.allActivities") } label: {
                        Text("progress.allActivities").font(StazaFont.headline)
                    }
                    .accessibilityIdentifier("allActivitiesLink")
                }
                .padding(StazaSpacing.md)
            }
            .refreshable { await model.load() }
        } else {
            VStack(spacing: StazaSpacing.md) {
                if model.isLoading {
                    SwiftUI.ProgressView()
                } else {
                    Text("progress.error").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                    Button("quests.retry") { Task { await model.load() } }.buttonStyle(.bordered)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var rewardsBanner: some View {
        StazaCard {
            Label("progress.newRewards", systemImage: "sparkles")
                .font(StazaFont.headline).foregroundStyle(StazaColor.accent)
        }
        .accessibilityIdentifier("newRewardsBanner")
    }

    private func levelCard(_ progress: PlayerProgress) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                Text("progress.level \(progress.level)").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                SwiftUI.ProgressView(value: min(max(progress.progressToNextLevel, 0), 1))
                Text("progress.xpToNext \(StazaFormat.number(progress.remainingXp, locale: locale)) \(progress.level + 1)")
                    .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                Text("progress.totalXp \(StazaFormat.number(progress.totalXp, locale: locale))")
                    .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
            }
        }
    }

    private func lifetimeCard(_ dashboard: ProgressDashboard) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                Text("progress.lifetime").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                Text(verbatim: StazaFormat.distance(meters: dashboard.lifetime.distanceMeters, locale: locale))
                    .font(StazaFont.body).foregroundStyle(StazaColor.textPrimary)
                Text("progress.collectibles \(dashboard.lifetime.totalCollectibles) \(dashboard.lifetime.totalFlowlines)")
                    .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                Text("progress.milestones \(dashboard.milestones.places) \(dashboard.milestones.peaks) \(dashboard.milestones.mountainPasses)")
                    .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
            }
        }
    }

    private func recordsCard(_ records: [ProgressDashboard.SportRecord]) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                Text("progress.records").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                ForEach(records) { record in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: record.type.capitalized).font(StazaFont.body).foregroundStyle(StazaColor.textPrimary)
                        Text("progress.recordDetail \(record.activityCount) \(StazaFormat.distance(meters: record.longestDistanceMeters, locale: locale))")
                            .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    }
                }
            }
        }
    }

    private func recentCard(_ recent: [ProgressDashboard.RecentActivity]) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                Text("progress.recent").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                ForEach(recent) { item in
                    NavigationLink(value: item.activity) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(verbatim: item.activity.title).font(StazaFont.body).foregroundStyle(StazaColor.textPrimary)
                                Spacer()
                                Text("progress.xp \(StazaFormat.number(item.activity.xpEarned, locale: locale))")
                                    .font(StazaFont.caption.weight(.semibold)).foregroundStyle(StazaColor.accent)
                            }
                            SwiftUI.ProgressView(value: min(max(item.xpPercentOfBest / 100, 0), 1))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func questsCard(_ history: [ProgressDashboard.QuestHistoryEntry]) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                Text("progress.quests").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                ForEach(history) { entry in
                    HStack {
                        Text(verbatim: entry.title).font(StazaFont.body).foregroundStyle(StazaColor.textPrimary)
                        Spacer()
                        Text("progress.xp \(StazaFormat.number(entry.xp, locale: locale))")
                            .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    }
                }
            }
        }
    }
}
