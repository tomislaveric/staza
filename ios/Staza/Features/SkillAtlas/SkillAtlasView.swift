import SwiftUI

struct SkillAtlasView: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.locale) private var locale
    @State private var model: SkillAtlasModel?

    var body: some View {
        Group {
            if let model { content(model) } else { Color.clear }
        }
        .stazaScreen()
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
                        Label {
                            Text(verbatim: error)
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                        }
                        .font(StazaFont.footnote)
                        .foregroundStyle(StazaColor.danger)
                    }
                    ForEach(model.visibleNodes) { nodeCard($0, model: model) }
                }
                .padding(.horizontal, StazaSpacing.md)
                .padding(.bottom, StazaSpacing.lg)
            }
            .refreshable { await model.load() }
        } else if model.isLoading {
            StazaLoadingView(title: "atlas.loading")
                .frame(maxHeight: .infinity)
        } else {
            StazaStateView(systemImage: "exclamationmark.triangle.fill", tint: StazaColor.danger, title: Text("atlas.error")) {
                Button("quests.retry") { Task { await model.load() } }.buttonStyle(.stazaSecondary)
            }
            .frame(maxHeight: .infinity)
        }
    }

    private func header(_ atlas: SkillAtlasView_) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                HStack(alignment: .center, spacing: StazaSpacing.md) {
                    HeroNumber(text: StazaFormat.number(Double(atlas.balance), locale: locale))
                        .foregroundStyle(atlas.balance > 0 ? StazaColor.accent : StazaColor.textPrimary)
                    VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                        OverlineText("tab.skillAtlas")
                        Text("atlas.points \(atlas.balance)")
                            .font(StazaFont.headline)
                            .foregroundStyle(StazaColor.textPrimary)
                    }
                }
                HStack(spacing: StazaSpacing.md) {
                    StatTile(label: "atlas.stat.earned", value: StazaFormat.number(Double(atlas.earnedPoints), locale: locale))
                    StatTile(label: "atlas.stat.spent", value: StazaFormat.number(Double(atlas.spentPoints), locale: locale))
                }
                VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                    StazaProgressBar(value: atlas.nextSkillPoint.progress)
                    Text("atlas.nextPoint \(atlas.nextSkillPoint.level) \(StazaFormat.number(atlas.nextSkillPoint.xpRemaining, locale: locale))")
                        .font(StazaFont.caption)
                        .foregroundStyle(StazaColor.textMuted)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func nodeCard(_ node: SkillAtlasView_.Node, model: SkillAtlasModel) -> some View {
        let tint = stateColor(node.state)
        return StazaCard(tint: node.state == .locked ? nil : tint) {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                HStack(alignment: .top, spacing: StazaSpacing.md) {
                    IconBadge(systemImage: stateIcon(node.state), tint: tint, size: 40)
                    VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                        Text(verbatim: node.name)
                            .font(StazaFont.headline)
                            .foregroundStyle(node.state == .locked ? StazaColor.textMuted : StazaColor.textPrimary)
                        Text(verbatim: node.grant.label)
                            .font(StazaFont.footnote.weight(.semibold))
                            .foregroundStyle(StazaColor.accent)
                    }
                    Spacer(minLength: 0)
                    StazaChip(stateLabel(node.state), tint: tint)
                }
                Text(verbatim: node.description)
                    .font(StazaFont.subheadline)
                    .foregroundStyle(StazaColor.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                if node.state != .unlocked {
                    Label("atlas.cost \(node.cost)", systemImage: "diamond.fill")
                        .font(StazaFont.metricSmall)
                        .foregroundStyle(StazaColor.textMuted)
                    if !node.requirements.isEmpty {
                        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                            ForEach(node.requirements, id: \.label) { requirementRow($0) }
                        }
                        .padding(.top, StazaSpacing.xs)
                    }
                    if !node.prerequisites.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: StazaSpacing.sm) {
                                ForEach(node.prerequisites, id: \.self) { id in
                                    StazaChip("atlas.requiresNode \(model.name(ofNode: id))", systemImage: "lock.fill", tint: StazaColor.textSubtle)
                                }
                            }
                        }
                        .scrollClipDisabled()
                    }
                }
                if node.state == .unlockable {
                    Button {
                        Task { if await model.unlock(node) { container.playerDataChanged() } }
                    } label: {
                        if model.unlockingNodeId == node.id {
                            SwiftUI.ProgressView().tint(StazaColor.onAccent)
                        } else {
                            Label("atlas.unlock", systemImage: "lock.open.fill")
                        }
                    }
                    .buttonStyle(.stazaPrimaryWide)
                    .disabled(model.unlockingNodeId != nil)
                    .padding(.top, StazaSpacing.xs)
                    .accessibilityIdentifier("unlock-\(node.id)")
                }
            }
        }
    }

    private func requirementRow(_ requirement: SkillAtlasView_.Requirement) -> some View {
        let progress = requirement.target > 0 ? min(requirement.current / requirement.target, 1) : (requirement.met ? 1 : 0)
        return VStack(alignment: .leading, spacing: StazaSpacing.xs) {
            HStack(spacing: StazaSpacing.xs) {
                Image(systemName: requirement.met ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(requirement.met ? StazaColor.success : StazaColor.textSubtle)
                    .accessibilityHidden(true)
                Text(verbatim: requirement.label)
                    .foregroundStyle(requirement.met ? StazaColor.textPrimary : StazaColor.textMuted)
                    .lineLimit(2)
                Spacer(minLength: StazaSpacing.sm)
                Text(verbatim: "\(StazaFormat.number(min(requirement.current, requirement.target), locale: locale)) / \(StazaFormat.number(requirement.target, locale: locale))")
                    .font(StazaFont.metricSmall)
                    .foregroundStyle(StazaColor.textMuted)
            }
            .font(StazaFont.footnote)
            StazaProgressBar(value: progress, tint: requirement.met ? StazaColor.success : StazaColor.accent, height: 4)
        }
        .accessibilityElement(children: .combine)
    }

    private func stateIcon(_ state: SkillAtlasView_.Node.State) -> String {
        switch state {
        case .unlocked: "checkmark.seal.fill"
        case .unlockable: "sparkles"
        case .locked: "lock.fill"
        case .premiumLocked: "crown.fill"
        }
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
        case .locked: StazaColor.textSubtle
        case .premiumLocked: StazaColor.rarityEpic
        }
    }
}
