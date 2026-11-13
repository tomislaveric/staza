import SwiftUI

struct SkillAtlasView: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.locale) private var locale
    @State private var model: SkillAtlasModel?

    var body: some View {
        Group {
            if let model { content(model) } else { Color.clear }
        }
        .background(StazaColor.canvas)
        .task(id: container.dataRevision) {
            if model == nil { model = SkillAtlasModel(api: container.apiClient) }
            await model?.load()
        }
        .accessibilityIdentifier("skillAtlasScreen")
    }

    @ViewBuilder
    private func content(_ model: SkillAtlasModel) -> some View {
        if let atlas = model.atlas {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: StazaSpacing.md) {
                    header(atlas)
                    if model.sports.count > 1 {
                        Picker("", selection: Binding(
                            get: { model.activeSport ?? "" },
                            set: { model.selectedSport = $0 }
                        )) {
                            ForEach(model.sports, id: \.self) { Text(verbatim: $0.capitalized).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }
                    if let error = model.unlockError {
                        Text(verbatim: error).font(StazaFont.caption).foregroundStyle(Color.red)
                    }
                    ForEach(model.visibleNodes) { nodeCard($0, model: model) }
                }
                .padding(StazaSpacing.md)
            }
            .refreshable { await model.load() }
        } else {
            VStack(spacing: StazaSpacing.md) {
                if model.isLoading {
                    SwiftUI.ProgressView()
                } else {
                    Text("atlas.error").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                    Button("quests.retry") { Task { await model.load() } }.buttonStyle(.bordered)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func header(_ atlas: SkillAtlasView_) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                Text("atlas.points \(atlas.balance)").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                Text("atlas.pointsDetail \(atlas.earnedPoints) \(atlas.spentPoints)")
                    .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                Text("atlas.nextPoint \(atlas.nextSkillPoint.level) \(StazaFormat.number(atlas.nextSkillPoint.xpRemaining, locale: locale))")
                    .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func nodeCard(_ node: SkillAtlasView_.Node, model: SkillAtlasModel) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                HStack {
                    Text(verbatim: node.name).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                    Spacer()
                    Text(stateLabel(node.state))
                        .font(StazaFont.caption.weight(.semibold))
                        .foregroundStyle(stateColor(node.state))
                }
                Text(verbatim: node.description).font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                Text(verbatim: node.grant.label).font(StazaFont.caption.weight(.semibold)).foregroundStyle(StazaColor.accent)
                if node.state != .unlocked {
                    Text("atlas.cost \(node.cost)").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    ForEach(node.requirements, id: \.label) { requirement in
                        Label {
                            Text(verbatim: "\(requirement.label) (\(StazaFormat.number(min(requirement.current, requirement.target), locale: locale))/\(StazaFormat.number(requirement.target, locale: locale)))")
                        } icon: {
                            Image(systemName: requirement.met ? "checkmark.circle.fill" : "circle")
                        }
                        .font(StazaFont.caption)
                        .foregroundStyle(requirement.met ? StazaColor.success : StazaColor.textMuted)
                    }
                    ForEach(node.prerequisites, id: \.self) { id in
                        Text("atlas.requiresNode \(model.name(ofNode: id))").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    }
                }
                if node.state == .unlockable {
                    Button {
                        Task { if await model.unlock(node) { container.playerDataChanged() } }
                    } label: {
                        if model.unlockingNodeId == node.id { SwiftUI.ProgressView() } else { Text("atlas.unlock") }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.unlockingNodeId != nil)
                    .accessibilityIdentifier("unlock-\(node.id)")
                }
            }
        }
        .opacity(node.state == .locked || node.state == .premiumLocked ? 0.7 : 1)
    }

    private func stateLabel(_ state: SkillAtlasView_.Node.State) -> LocalizedStringKey {
        switch state {
        case .unlocked: "atlas.state.unlocked"
        case .unlockable: "atlas.state.unlockable"
        case .locked: "quests.state.locked"
        case .premiumLocked: "atlas.state.premium"
        }
    }

    private func stateColor(_ state: SkillAtlasView_.Node.State) -> Color {
        switch state {
        case .unlocked: StazaColor.success
        case .unlockable: StazaColor.accent
        case .locked, .premiumLocked: StazaColor.textMuted
        }
    }
}
