import SwiftUI

struct HomeView: View {
    @Environment(AppContainer.self) private var container
    @State private var model: HomeModel?
    @State private var isShowingQuests = false
    var onSelectTab: (AppTab) -> Void = { _ in }
    var onAddActivity: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                switch model?.state ?? .loading {
                case .loading:
                    StazaLoadingView(title: "home.loading")
                case .failed(let message):
                    StazaErrorView(title: "home.error.title", message: message) {
                        Task { await model?.load() }
                    }
                case .loaded(let content):
                    LevelHeroCard(progress: content.progress)
                    let highlights = content.highlights
                    if content.latest == nil {
                        OnboardingCard(onAddActivity: onAddActivity)
                    } else {
                        UpNextSection(highlights: highlights, perform: open)
                    }
                    if highlights.showsSkills {
                        SkillHighlightsSection(highlights: highlights) { onSelectTab(.skillAtlas) }
                    }
                    HomeAchievementsSection(
                        achievements: content.achievements,
                        lifetime: content.lifetime,
                        totalXp: content.progress.totalXp,
                        onOpenSkillAtlas: { onSelectTab(.skillAtlas) }
                    )
                    recentActivity(content)
                }
            }
            .padding(.horizontal, StazaSpacing.md)
            .padding(.vertical, StazaSpacing.sm)
        }
        .stazaScreen()
        .navigationDestination(for: ActivityHistoryItem.self) { ActivityDetailView(activity: $0) }
        .navigationDestination(isPresented: $isShowingQuests) { QuestListView() }
        .task(id: container.dataRevision) {
            let model = self.model ?? HomeModel(api: container.apiClient)
            self.model = model
            await model.load()
        }
        .refreshable { await model?.load() }
    }

    private func open(_ target: UpNextSection.Target) {
        switch target {
        case .world: onSelectTab(.world)
        case .quests: isShowingQuests = true
        }
    }

    @ViewBuilder
    private func recentActivity(_ content: HomeContent) -> some View {
        SectionHeader("home.recent.header")
        if let latest = content.latest {
            NavigationLink(value: latest) {
                RecentActivityCard(activity: latest, detail: content.latestDetail, replay: content.replay, basemap: content.basemap)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("home.recent.accessibility"))
            .accessibilityIdentifier("homeRecentActivity")
        } else {
            StazaCard {
                StazaStateView(systemImage: "figure.outdoor.cycle", title: Text("home.recent.empty.title"), message: Text("home.recent.empty.body"))
            }
        }
    }
}

#Preview("EN") { NavigationStack { HomeView() }.environment(AppContainer()).preferredColorScheme(.dark) }
#Preview("DE dark") {
    NavigationStack { HomeView() }.environment(AppContainer()).environment(\.locale, Locale(identifier: "de")).preferredColorScheme(.dark)
}
