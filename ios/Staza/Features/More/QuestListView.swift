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
        .stazaScreen()
        .task {
            if model == nil { model = QuestListModel(api: container.apiClient) }
            await model?.load()
        }
        .accessibilityIdentifier("questListScreen")
    }

    @ViewBuilder
    private func content(_ model: QuestListModel) -> some View {
        if model.quests.isEmpty {
            ScrollView {
                Group {
                    if model.isLoading {
                        StazaLoadingView(title: "quests.loading")
                    } else if model.failed {
                        StazaStateView(systemImage: "exclamationmark.triangle.fill", tint: StazaColor.danger, title: Text("quests.error")) {
                            Button("quests.retry") { Task { await model.load() } }.buttonStyle(.stazaSecondary)
                        }
                    } else {
                        StazaStateView(systemImage: "flag.checkered", tint: StazaColor.accent, title: Text("quests.empty"))
                    }
                }
                .padding(StazaSpacing.md)
                .padding(.top, StazaSpacing.xl)
            }
            .refreshable { await model.load() }
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: StazaSpacing.lg) {
                    ForEach(model.chains) { chain in
                        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                            chainHeader(chain)
                            ForEach(chain.quests) { questCard($0) }
                        }
                    }
                }
                .padding(.horizontal, StazaSpacing.md)
                .padding(.vertical, StazaSpacing.md)
            }
            .refreshable { await model.load() }
        }
    }

    private func chainHeader(_ chain: QuestChain) -> some View {
        let completed = chain.quests.filter { $0.state == .completed }.count
        return HStack(alignment: .firstTextBaseline) {
            OverlineText(verbatim: chain.title)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: StazaSpacing.sm)
            Text(verbatim: "\(completed)/\(chain.quests.count)")
                .font(StazaFont.metricSmall)
                .foregroundStyle(completed == chain.quests.count ? StazaColor.success : StazaColor.textSubtle)
                .accessibilityHidden(true)
        }
        .padding(.top, StazaSpacing.sm)
    }

    private func questCard(_ quest: AuthoredQuest) -> some View {
        let tint = stateColor(quest.state)
        return StazaCard(tint: tint) {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                HStack(spacing: StazaSpacing.sm) {
                    StazaChip(verbatim: "\(quest.step)/\(quest.totalSteps)", tint: StazaColor.textMuted)
                        .accessibilityLabel(Text("quests.step \(quest.step) \(quest.totalSteps)"))
                    StazaChip(stateLabel(quest.state), systemImage: stateIcon(quest.state), tint: tint)
                    Spacer(minLength: StazaSpacing.sm)
                    Text("home.quest.reward \(StazaFormat.number(quest.xp, locale: locale))")
                        .font(StazaFont.metric.weight(.semibold))
                        .foregroundStyle(quest.state == .locked ? StazaColor.textSubtle : StazaColor.accent)
                }
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text(verbatim: quest.title)
                        .font(StazaFont.headline)
                        .foregroundStyle(quest.state == .locked ? StazaColor.textMuted : StazaColor.textPrimary)
                    Text(verbatim: quest.description)
                        .font(StazaFont.subheadline)
                        .foregroundStyle(StazaColor.textMuted)
                }
                if quest.state == .locked {
                    if let node = quest.requiredNode {
                        Label("quests.requiresNode \(node.name)", systemImage: "lock.fill")
                            .font(StazaFont.footnote).foregroundStyle(StazaColor.textSubtle)
                    } else if let previous = quest.requiredQuestTitle {
                        Label("quests.requiresQuest \(previous)", systemImage: "lock.fill")
                            .font(StazaFont.footnote).foregroundStyle(StazaColor.textSubtle)
                    }
                }
                if quest.state == .active, let failure = quest.lastFailure {
                    VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                        Text("quests.lastAttempt \(failure.attemptCount)")
                            .font(StazaFont.footnote.weight(.medium))
                            .foregroundStyle(StazaColor.textMuted)
                        ForEach(failure.criteria ?? [], id: \.label) { criterion in
                            Label {
                                Text(verbatim: criterion.label).foregroundStyle(criterion.met ? StazaColor.textMuted : StazaColor.textPrimary)
                            } icon: {
                                Image(systemName: criterion.met ? "checkmark.circle.fill" : "xmark.circle.fill")
                                    .foregroundStyle(criterion.met ? StazaColor.success : StazaColor.danger)
                            }
                            .font(StazaFont.footnote)
                        }
                    }
                    .padding(StazaSpacing.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(StazaColor.surfaceRaised, in: RoundedRectangle(cornerRadius: StazaRadius.chip, style: .continuous))
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func stateLabel(_ state: AuthoredQuest.State) -> LocalizedStringKey {
        switch state {
        case .active: "quests.state.active"
        case .completed: "quests.state.completed"
        case .locked: "quests.state.locked"
        }
    }

    private func stateIcon(_ state: AuthoredQuest.State) -> String {
        switch state {
        case .active: "flag.fill"
        case .completed: "checkmark"
        case .locked: "lock.fill"
        }
    }

    private func stateColor(_ state: AuthoredQuest.State) -> Color {
        switch state {
        case .active: StazaColor.accent
        case .completed: StazaColor.success
        case .locked: StazaColor.textSubtle
        }
    }
}
