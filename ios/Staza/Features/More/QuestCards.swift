import SwiftUI

/// Generic checklist row: checkbox, title (with optional NEW pill), one-line goal and pills.
/// Shared by quest rows and Home to-dos; `showsChevron` marks the row as navigable.
struct TaskRow<Pills: View>: View {
    let checked: Bool
    var isNew = false
    let title: Text
    var goal: Text?
    var showsChevron = false
    @ViewBuilder let pills: Pills

    /// Leading offset of the title column, for rows that align with task text but have no checkbox.
    static var textInset: CGFloat { checkboxSize + checkboxSpacing }
    private static var checkboxSize: CGFloat { 20 }
    private static var checkboxSpacing: CGFloat { StazaSpacing.sm + StazaSpacing.xs }

    var body: some View {
        HStack(alignment: .center, spacing: StazaSpacing.sm) {
            HStack(alignment: .top, spacing: Self.checkboxSpacing) {
                checkbox
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
                        title
                            .font(StazaFont.headline)
                            .foregroundStyle(checked ? StazaColor.textMuted : StazaColor.textPrimary)
                            .lineLimit(1)
                        if isNew {
                            StazaChip("quests.pill.new", tint: StazaColor.accent)
                        }
                        Spacer(minLength: 0)
                    }
                    if let goal {
                        goal
                            .font(StazaFont.subheadline)
                            .foregroundStyle(StazaColor.textMuted)
                            .lineLimit(1)
                    }
                    if Pills.self != EmptyView.self {
                        MoreFlowLayout(spacing: StazaSpacing.xs + StazaSpacing.xxs) { pills }
                            .padding(.top, StazaSpacing.xxs)
                    }
                }
                .opacity(checked ? 0.6 : 1)
            }
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(StazaColor.textSubtle)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, StazaSpacing.sm + StazaSpacing.xs)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var checkbox: some View {
        let shape = RoundedRectangle(cornerRadius: 5, style: .continuous)
        if checked {
            shape.fill(StazaColor.accent)
                .overlay(Image(systemName: "checkmark").font(.caption2.weight(.heavy)).foregroundStyle(StazaColor.surface))
                .frame(width: Self.checkboxSize, height: Self.checkboxSize)
                .padding(.top, 1)
                .accessibilityLabel(Text("quests.state.completed"))
        } else {
            shape.strokeBorder(StazaColor.accent, lineWidth: 1.5)
                .frame(width: Self.checkboxSize, height: Self.checkboxSize)
                .padding(.top, 1)
                .accessibilityHidden(true)
        }
    }
}

/// A quest as a to-do item: checkbox, title, one-line goal and pills. Shared by Progress, the Quests list and Home.
struct QuestTaskRow: View {
    let quest: AuthoredQuest
    var showsChevron = false
    @Environment(\.locale) private var locale

    var body: some View {
        TaskRow(
            checked: quest.state == .completed,
            isNew: quest.isNew == true,
            title: Text(verbatim: quest.title),
            goal: Text(verbatim: quest.description),
            showsChevron: showsChevron
        ) {
            if quest.state == .active, let failure = quest.lastFailure {
                StazaChip("quests.pill.fellShort", systemImage: "xmark", tint: StazaColor.danger)
                ForEach(Array((failure.criteria ?? []).filter { !$0.met }.enumerated()), id: \.offset) { _, criterion in
                    StazaChip(verbatim: QuestPills.criterion(criterion, locale: locale), tint: StazaColor.danger)
                }
            }
            StazaChip(QuestPills.difficulty(quest.difficulty))
            StazaChip("quests.pill.step \(quest.step) \(quest.totalSteps)")
            StazaChip("home.quest.reward \(StazaFormat.number(quest.xp, locale: locale))", tint: StazaColor.accent)
        }
    }
}

/// Quests as one checklist card: open orders get a checkbox, locked ones a lock pill.
struct QuestTaskList: View {
    let quests: [AuthoredQuest]

    var body: some View {
        StazaCard(padding: 0) {
            VStack(spacing: 0) {
                ForEach(Array(quests.enumerated()), id: \.element.id) { index, quest in
                    if index > 0 { Divider().overlay(StazaColor.border) }
                    if quest.state == .locked {
                        LockedQuestRow(quest: quest).padding(.vertical, StazaSpacing.xs)
                    } else {
                        QuestTaskRow(quest: quest)
                    }
                }
            }
            .padding(.horizontal, StazaSpacing.md)
        }
    }
}

/// Collapsed card listing quests behind a disclosure label (locked or finished quests).
struct CollapsibleQuestGroup: View {
    let label: Text
    let systemImage: String
    let quests: [AuthoredQuest]

    var body: some View {
        StazaCard(padding: StazaSpacing.sm + StazaSpacing.xs) {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(quests.enumerated()), id: \.element.id) { index, quest in
                        if index > 0 { Divider().overlay(StazaColor.border) }
                        if quest.state == .locked {
                            LockedQuestRow(quest: quest)
                        } else {
                            QuestTaskRow(quest: quest)
                        }
                    }
                }
                .padding(.top, StazaSpacing.xs)
            } label: {
                Label { label } icon: { Image(systemName: systemImage) }
                    .font(StazaFont.subheadline.weight(.medium))
                    .foregroundStyle(StazaColor.textMuted)
            }
            .tint(StazaColor.textMuted)
        }
    }
}

/// One-line locked quest with a pill naming what unlocks it.
struct LockedQuestRow: View {
    let quest: AuthoredQuest

    var body: some View {
        HStack(spacing: StazaSpacing.sm) {
            Text(verbatim: quest.title)
                .font(StazaFont.subheadline)
                .foregroundStyle(StazaColor.textMuted)
                .lineLimit(1)
            Spacer(minLength: StazaSpacing.sm)
            if let node = quest.requiredNode {
                StazaChip(verbatim: node.premium == true ? "\(node.name) · PRO" : node.name, systemImage: "lock.fill", tint: StazaColor.textSubtle)
            } else if let previous = quest.requiredQuestTitle {
                StazaChip("quests.pill.after \(previous)", systemImage: "lock.fill", tint: StazaColor.textSubtle)
            } else {
                StazaChip("quests.state.locked", systemImage: "lock.fill", tint: StazaColor.textSubtle)
            }
        }
        .padding(.vertical, StazaSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}

enum QuestPills {
    static func difficulty(_ difficulty: String) -> LocalizedStringKey {
        switch difficulty {
        case "easy": "quests.difficulty.easy"
        case "medium": "quests.difficulty.medium"
        case "hard": "quests.difficulty.hard"
        case "prestige": "quests.difficulty.prestige"
        default: LocalizedStringKey(difficulty.prefix(1).uppercased() + difficulty.dropFirst())
        }
    }

    /// "12/30 km" for a missed criterion; falls back to its label when values are absent.
    static func criterion(_ criterion: AuthoredQuest.Failure.Criterion, locale: Locale) -> String {
        guard let current = criterion.current, let required = criterion.required else { return criterion.label }
        let values = "\(value(current, locale: locale))/\(value(required, locale: locale))"
        guard let unit = criterion.unit, !unit.isEmpty else { return values }
        return "\(values) \(unit)"
    }

    private static func value(_ number: Double, locale: Locale) -> String {
        StazaFormat.number(number, locale: locale, fractionDigits: number.rounded() == number ? 0 : 1)
    }
}
