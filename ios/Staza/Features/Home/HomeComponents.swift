import SwiftUI

/// Game-style level hero shared by Home and Progress: big level number, XP metric and progress bar.
struct LevelHeroCard: View {
    let progress: PlayerProgress
    var showsTotalXp = false
    @Environment(\.locale) private var locale

    private var fraction: Double { min(max(progress.progressPercent, 0), 100) / 100 }

    var body: some View {
        StazaCard(padding: StazaSpacing.lg) {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                HStack(alignment: .center, spacing: StazaSpacing.md) {
                    HeroNumber(text: StazaFormat.number(Double(progress.level), locale: locale))
                        .fixedSize()
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                        OverlineText("home.level \(StazaFormat.number(Double(progress.level), locale: locale))")
                        Text("home.xp \(StazaFormat.number(progress.currentLevelXp, locale: locale)) \(StazaFormat.number(progress.nextLevelXp, locale: locale))")
                            .font(StazaFont.title3.monospacedDigit())
                            .foregroundStyle(StazaColor.textPrimary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    Spacer(minLength: 0)
                }
                StazaProgressBar(value: fraction, height: 8)
                    .accessibilityLabel(Text("home.progress.accessibility"))
                HStack(alignment: .firstTextBaseline) {
                    Text("home.remaining \(StazaFormat.number(progress.remainingXp, locale: locale)) \(StazaFormat.number(Double(progress.level + 1), locale: locale))")
                    Spacer(minLength: StazaSpacing.sm)
                    if showsTotalXp {
                        Text("progress.totalXp \(StazaFormat.number(progress.totalXp, locale: locale))")
                    }
                }
                .font(StazaFont.caption)
                .foregroundStyle(StazaColor.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Quest card with an accent leading edge, reward and completion bar.
struct QuestCard: View {
    let quest: QuestInstance
    @Environment(\.locale) private var locale

    var body: some View {
        StazaCard(tint: StazaColor.accent) {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
                    Text(verbatim: quest.title)
                        .font(StazaFont.headline)
                        .foregroundStyle(StazaColor.textPrimary)
                    Spacer(minLength: StazaSpacing.sm)
                    Text("home.quest.reward \(StazaFormat.number(quest.rewardXp, locale: locale))")
                        .font(StazaFont.metric.weight(.semibold))
                        .foregroundStyle(StazaColor.accent)
                }
                if !quest.description.isEmpty {
                    Text(verbatim: quest.description)
                        .font(StazaFont.subheadline)
                        .foregroundStyle(StazaColor.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                StazaProgressBar(value: quest.completionFraction)
                    .accessibilityLabel(Text("home.quest.progress.accessibility"))
                    .padding(.top, StazaSpacing.xs)
            }
        }
    }
}
