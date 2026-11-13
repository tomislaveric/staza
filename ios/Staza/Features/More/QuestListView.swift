import SwiftUI

struct QuestListView: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.locale) private var locale
    @State private var model: QuestListModel?

    var body: some View {
        Group {
            if let model { content(model) } else { Color.clear }
        }
        .navigationTitle("quests.title")
        .navigationBarTitleDisplayMode(.inline)
        .background(StazaColor.canvas)
        .task {
            if model == nil { model = QuestListModel(api: container.apiClient) }
            await model?.load()
        }
        .accessibilityIdentifier("questListScreen")
    }

    @ViewBuilder
    private func content(_ model: QuestListModel) -> some View {
        if model.quests.isEmpty {
            VStack(spacing: StazaSpacing.md) {
                if model.isLoading {
                    SwiftUI.ProgressView()
                } else {
                    Text(model.failed ? "quests.error" : "quests.empty")
                        .font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                        .multilineTextAlignment(.center)
                    if model.failed {
                        Button("quests.retry") { Task { await model.load() } }.buttonStyle(.bordered)
                    }
                }
            }
            .padding(StazaSpacing.md)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: StazaSpacing.lg) {
                    ForEach(model.chains) { chain in
                        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                            Text(verbatim: chain.title).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                            ForEach(chain.quests) { questCard($0) }
                        }
                    }
                }
                .padding(StazaSpacing.md)
            }
            .refreshable { await model.load() }
        }
    }

    private func questCard(_ quest: AuthoredQuest) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                HStack {
                    Text(verbatim: quest.title).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                    Spacer()
                    Text(stateLabel(quest.state))
                        .font(StazaFont.caption.weight(.semibold))
                        .foregroundStyle(stateColor(quest.state))
                }
                Text("quests.step \(quest.step) \(quest.totalSteps)")
                    .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                Text(verbatim: quest.description).font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                Text("home.quest.reward \(StazaFormat.number(quest.xp, locale: locale))")
                    .font(StazaFont.caption.weight(.semibold)).foregroundStyle(StazaColor.accent)
                if quest.state == .locked {
                    if let node = quest.requiredNode {
                        Text("quests.requiresNode \(node.name)").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    } else if let previous = quest.requiredQuestTitle {
                        Text("quests.requiresQuest \(previous)").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    }
                }
                if quest.state == .active, let failure = quest.lastFailure {
                    Text("quests.lastAttempt \(failure.attemptCount)").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    ForEach((failure.criteria ?? []).filter { !$0.met }, id: \.label) { criterion in
                        Label(criterion.label, systemImage: "xmark.circle").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    }
                }
            }
        }
        .opacity(quest.state == .locked ? 0.6 : 1)
        .accessibilityElement(children: .combine)
    }

    private func stateLabel(_ state: AuthoredQuest.State) -> LocalizedStringKey {
        switch state {
        case .active: "quests.state.active"
        case .completed: "quests.state.completed"
        case .locked: "quests.state.locked"
        }
    }

    private func stateColor(_ state: AuthoredQuest.State) -> Color {
        switch state {
        case .active: StazaColor.accent
        case .completed: StazaColor.success
        case .locked: StazaColor.textMuted
        }
    }
}
