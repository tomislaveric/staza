import SwiftUI

struct QuestListView: View {
    @Environment(AppContainer.self) private var container
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
                    if !model.activeQuests.isEmpty {
                        section(header: sectionHeader("quests.section.active", count: model.activeQuests.count),
                                quests: model.activeQuests)
                            .accessibilityIdentifier("questSection.active")
                    }
                    ForEach(model.upcomingChains) { chain in
                        section(header: chainHeader(chain), quests: chain.quests.filter { $0.state == .locked })
                    }
                    if !model.finishedQuests.isEmpty {
                        CollapsibleQuestGroup(label: Text("progress.quests.finished \(model.finishedQuests.count)"),
                                              systemImage: "checkmark.square.fill", quests: model.finishedQuests)
                            .padding(.top, StazaSpacing.sm)
                            .accessibilityIdentifier("questSection.finished")
                    }
                }
                .padding(.horizontal, StazaSpacing.md)
                .padding(.vertical, StazaSpacing.md)
            }
            .refreshable { await model.load() }
        }
    }

    private func section(header: some View, quests: [AuthoredQuest]) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            header
            QuestTaskList(quests: quests)
        }
    }

    private func sectionHeader(_ title: LocalizedStringKey, count: Int) -> some View {
        HStack(alignment: .firstTextBaseline) {
            OverlineText(title)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: StazaSpacing.sm)
            Text(verbatim: "\(count)")
                .font(StazaFont.metricSmall)
                .foregroundStyle(StazaColor.textSubtle)
                .accessibilityHidden(true)
        }
        .padding(.top, StazaSpacing.sm)
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
}
