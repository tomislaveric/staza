import SwiftUI

struct HomeView: View {
    @Environment(\.locale) private var locale
    @Environment(AppContainer.self) private var container
    @State private var model: HomeModel?
    var onOpenWorld: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                switch model?.state ?? .loading {
                case .loading:
                    ProgressView("home.loading")
                        .frame(maxWidth: .infinity)
                        .padding(.top, StazaSpacing.xl)
                case .failed(let message):
                    errorCard(message)
                case .loaded(let content):
                    progressCard(content.progress)
                    questsSection(content.activeQuests)
                }
            }
            .padding(StazaSpacing.md)
        }
        .background(StazaColor.canvas)
        .task(id: container.dataRevision) {
            let model = self.model ?? HomeModel(api: container.apiClient)
            self.model = model
            await model.load()
        }
        .refreshable { await model?.load() }
    }

    private func progressCard(_ progress: PlayerProgress) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                Text("home.level \(StazaFormat.number(Double(progress.level), locale: locale))")
                    .font(StazaFont.title)
                    .foregroundStyle(StazaColor.textPrimary)
                Text("home.xp \(StazaFormat.number(progress.currentLevelXp, locale: locale)) \(StazaFormat.number(progress.nextLevelXp, locale: locale))")
                    .font(StazaFont.metric)
                    .foregroundStyle(StazaColor.textPrimary)
                SwiftUI.ProgressView(value: min(max(progress.progressPercent, 0), 100), total: 100)
                    .tint(StazaColor.accent)
                    .accessibilityLabel(Text("home.progress.accessibility"))
                Text("home.remaining \(StazaFormat.number(progress.remainingXp, locale: locale)) \(StazaFormat.number(Double(progress.level + 1), locale: locale))")
                    .font(StazaFont.caption)
                    .foregroundStyle(StazaColor.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func questsSection(_ quests: [QuestInstance]) -> some View {
        Text("home.quests.header").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
        if quests.isEmpty {
            StazaCard {
                VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                    Text("home.quests.empty").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                    Button("home.quests.openWorld", action: onOpenWorld)
                        .buttonStyle(.borderedProminent)
                        .tint(StazaColor.accent)
                        .accessibilityIdentifier("homeOpenWorldButton")
                }
            }
        } else {
            ForEach(quests) { quest in questCard(quest) }
        }
    }

    private func questCard(_ quest: QuestInstance) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                HStack(alignment: .firstTextBaseline) {
                    Text(quest.title).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                    Spacer()
                    Text("home.quest.reward \(StazaFormat.number(quest.rewardXp, locale: locale))")
                        .font(StazaFont.caption.weight(.semibold))
                        .foregroundStyle(StazaColor.accent)
                }
                Text(quest.description).font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                SwiftUI.ProgressView(value: quest.completionFraction)
                    .tint(StazaColor.accent)
                    .accessibilityLabel(Text("home.quest.progress.accessibility"))
                    .accessibilityValue(Text(quest.completionFraction, format: .percent))
            }
        }
    }

    private func errorCard(_ message: String) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                Text("home.error.title").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                Text(message).font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                Button("home.error.retry") { Task { await model?.load() } }
                    .buttonStyle(.bordered)
            }
        }
    }
}

#Preview("EN") { HomeView().environment(AppContainer()) }
#Preview("DE dark") {
    HomeView().environment(AppContainer()).environment(\.locale, Locale(identifier: "de")).preferredColorScheme(.dark)
}
