import SwiftUI

/// Bottom-sheet content for one Skill Atlas node: reward, description, cost,
/// requirement progress, prerequisites (tap to jump), and the Unlock action.
struct SkillAtlasNodeDetail: View {
    let node: SkillAtlasView_.Node
    let model: SkillAtlasModel
    let onUnlocked: () -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                HStack(alignment: .top, spacing: StazaSpacing.md) {
                    SkillAtlasNodeGlyph(node: node)
                    VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                        Text(verbatim: node.name)
                            .font(StazaFont.title3)
                            .foregroundStyle(StazaColor.textPrimary)
                        Text(verbatim: node.grant.label)
                            .font(StazaFont.footnote.weight(.semibold))
                            .foregroundStyle(StazaColor.accent)
                    }
                    Spacer(minLength: 0)
                    StazaChip(stateKey, tint: stateColor)
                }
                Text(verbatim: node.description)
                    .font(StazaFont.subheadline)
                    .foregroundStyle(StazaColor.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                if let error = model.unlockError {
                    Label {
                        Text(verbatim: error)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                    }
                    .font(StazaFont.footnote)
                    .foregroundStyle(StazaColor.danger)
                }
                if node.state != .unlocked {
                    Label("atlas.cost \(node.cost)", systemImage: "diamond.fill")
                        .font(StazaFont.metricSmall)
                        .foregroundStyle(StazaColor.textMuted)
                    if !node.requirements.isEmpty {
                        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                            ForEach(node.requirements, id: \.label) { requirementRow($0) }
                        }
                    }
                    if !node.prerequisites.isEmpty { prerequisites }
                }
                if node.state == .unlockable { unlockButton }
            }
            .padding(StazaSpacing.lg)
        }
        .accessibilityIdentifier("atlas-detail-\(node.id)")
    }

    private var prerequisites: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: StazaSpacing.sm) {
                ForEach(node.prerequisites, id: \.self) { id in
                    let prerequisite = model.node(withId: id)
                    let tint = prerequisite?.state == .unlocked ? StazaColor.success : StazaColor.textSubtle
                    let icon = prerequisite?.state == .unlocked ? "checkmark" : "lock.fill"
                    Button { model.select(id) } label: {
                        if let prerequisite, prerequisite.sport != node.sport {
                            StazaChip("atlas.requiresNodeInSport \(prerequisite.name) \(prerequisite.sport.capitalized)", systemImage: icon, tint: tint)
                        } else {
                            StazaChip("atlas.requiresNode \(model.name(ofNode: id))", systemImage: icon, tint: tint)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("atlas-prereq-\(id)")
                }
            }
        }
        .scrollClipDisabled()
    }

    private var unlockButton: some View {
        Button {
            Task { if await model.unlock(node) { onUnlocked() } }
        } label: {
            if model.unlockingNodeId == node.id {
                SwiftUI.ProgressView().tint(StazaColor.onAccent)
            } else {
                Label("atlas.unlock", systemImage: "lock.open.fill")
            }
        }
        .buttonStyle(.stazaPrimaryWide)
        .disabled(model.unlockingNodeId != nil)
        .accessibilityIdentifier("unlock-\(node.id)")
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

    private var stateKey: LocalizedStringKey {
        switch node.state {
        case .unlocked: "atlas.state.unlocked"
        case .unlockable: "atlas.state.unlockable"
        case .locked: "quests.state.locked"
        case .premiumLocked: "atlas.state.premium"
        }
    }

    private var stateColor: Color {
        switch node.state {
        case .unlocked: StazaColor.success
        case .unlockable: StazaColor.accent
        case .locked: StazaColor.textSubtle
        case .premiumLocked: StazaColor.rarityEpic
        }
    }
}
