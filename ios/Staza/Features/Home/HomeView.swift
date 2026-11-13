import SwiftUI

struct HomeView: View {
    @Environment(AppContainer.self) private var container
    @State private var model: HomeModel?
    var onOpenWorld: () -> Void = {}

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
                    questsSection(content.activeQuests)
                }
            }
            .padding(.horizontal, StazaSpacing.md)
            .padding(.vertical, StazaSpacing.sm)
        }
        .stazaScreen()
        .task(id: container.dataRevision) {
            let model = self.model ?? HomeModel(api: container.apiClient)
            self.model = model
            await model.load()
        }
        .refreshable { await model?.load() }
    }

    @ViewBuilder
    private func questsSection(_ quests: [QuestInstance]) -> some View {
        SectionHeader("home.quests.header")
        if quests.isEmpty {
            StazaCard {
                StazaStateView(systemImage: "flag.checkered", tint: StazaColor.accent, title: Text("home.quests.empty")) {
                    Button("home.quests.openWorld", systemImage: "map.fill", action: onOpenWorld)
                        .buttonStyle(.stazaPrimary)
                        .accessibilityIdentifier("homeOpenWorldButton")
                }
            }
        } else {
            ForEach(quests) { QuestCard(quest: $0) }
        }
    }
}

#Preview("EN") { HomeView().environment(AppContainer()).preferredColorScheme(.dark) }
#Preview("DE dark") {
    HomeView().environment(AppContainer()).environment(\.locale, Locale(identifier: "de")).preferredColorScheme(.dark)
}
