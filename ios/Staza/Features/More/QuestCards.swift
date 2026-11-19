import SwiftUI

/// Generic quest row: state stripe, title (with optional NEW pill), one-line goal and pills.
/// `completed` rows are dimmed with a success stripe; `showsChevron` marks the row as navigable.
struct TaskRow<Pills: View>: View {
    let completed: Bool
    var isNew = false
    let title: Text
    var goal: Text?
    var showsChevron = false
    @ViewBuilder let pills: Pills

    var body: some View {
        HStack(alignment: .center, spacing: StazaSpacing.sm) {
            HStack(alignment: .top, spacing: StazaSpacing.sm + StazaSpacing.xs) {
                Capsule()
                    .fill(completed ? StazaColor.success : StazaColor.accent)
                    .frame(width: 3)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
                        title
                            .font(StazaFont.headline)
                            .foregroundStyle(completed ? StazaColor.textMuted : StazaColor.textPrimary)
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
                .opacity(completed ? 0.7 : 1)
            }
            .fixedSize(horizontal: false, vertical: true)
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
}

/// A quest row: title, one-line goal and pills. Shared by Progress and the Quests list.
struct QuestTaskRow: View {
    let quest: AuthoredQuest
    var showsChevron = false
    @Environment(\.locale) private var locale

    var body: some View {
        TaskRow(
            completed: quest.state == .completed,
            isNew: quest.isNew == true,
            title: Text(verbatim: quest.title),
            goal: Text(verbatim: quest.description),
            showsChevron: showsChevron
        ) {
            if quest.state == .completed {
                StazaChip("quests.state.completed", systemImage: "checkmark", tint: StazaColor.success)
            }
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

/// Quests as one card: open and finished quests as rows, locked ones with a lock pill.
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
