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

/// "To do" checklist: every row opens its target (web Home to-dos).
struct HomeTodoSection: View {
    let todos: [HomeTodo]
    let perform: (HomeTodo.Target) -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        SectionHeader("home.todo.header")
        StazaCard(padding: 0) {
            VStack(spacing: 0) {
                ForEach(Array(todos.enumerated()), id: \.element.id) { index, todo in
                    if index > 0 { Divider().overlay(StazaColor.border) }
                    Button { perform(todo.target) } label: {
                        row(todo).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("homeTodo.\(todo.id)")
                }
            }
            .padding(.horizontal, StazaSpacing.md)
        }
        .accessibilityIdentifier("homeTodos")
    }

    @ViewBuilder
    private func row(_ todo: HomeTodo) -> some View {
        switch todo {
        case .spendSkillPoints(let points):
            TaskRow(checked: false, title: Text("home.todo.spend \(points)"), goal: Text("home.todo.spend.goal"), showsChevron: true) {
                StazaChip("home.todo.spend.pill \(points)", tint: StazaColor.accent)
            }
        case .quest(let quest):
            QuestTaskRow(quest: quest, showsChevron: true)
        case .moreQuests(let count):
            HStack(spacing: StazaSpacing.sm) {
                Text("home.todo.moreQuests \(count)")
                    .font(StazaFont.subheadline)
                    .foregroundStyle(StazaColor.textMuted)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(StazaColor.textSubtle)
                    .accessibilityHidden(true)
            }
            .padding(.leading, TaskRow<EmptyView>.textInset)
            .padding(.vertical, StazaSpacing.sm + StazaSpacing.xs)
        case .exploration(let instance):
            TaskRow(checked: false, title: Text(verbatim: instance.title), goal: Text(verbatim: instance.description), showsChevron: true) {
                StazaChip("home.todo.exploration")
                StazaChip("home.quest.reward \(StazaFormat.number(instance.rewardXp, locale: locale))", tint: StazaColor.accent)
            }
        case .planExploration:
            TaskRow(checked: false, title: Text("home.todo.plan.title"), goal: Text("home.todo.plan.goal"), showsChevron: true) {
                EmptyView()
            }
        }
    }
}

/// Shown instead of the to-do list until the first activity exists (web `HomeOnboarding`).
struct OnboardingCard: View {
    let onAddActivity: () -> Void

    var body: some View {
        StazaCard(tint: StazaColor.accent, padding: StazaSpacing.lg) {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                OverlineText("home.onboarding.overline")
                Text("home.onboarding.title")
                    .font(StazaFont.title)
                    .foregroundStyle(StazaColor.textPrimary)
                Text("home.onboarding.body")
                    .font(StazaFont.subheadline)
                    .foregroundStyle(StazaColor.textMuted)
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    step(1, "home.onboarding.step1")
                    step(2, "home.onboarding.step2")
                    step(3, "home.onboarding.step3")
                }
                Button("home.onboarding.cta", systemImage: "plus", action: onAddActivity)
                    .buttonStyle(.stazaPrimary)
                    .padding(.top, StazaSpacing.xs)
                    .accessibilityIdentifier("homeOnboardingButton")
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityIdentifier("homeOnboarding")
    }

    private func step(_ number: Int, _ key: LocalizedStringKey) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
            Text(verbatim: "\(number).").font(StazaFont.metric).foregroundStyle(StazaColor.accent)
            Text(key).font(StazaFont.subheadline).foregroundStyle(StazaColor.textPrimary)
        }
    }
}

/// Skills, Achievements and Summary tiles (web `HomeAchievements`).
struct HomeAchievementsSection: View {
    let achievements: HomeAchievements?
    let lifetime: ProgressDashboard.Lifetime
    let totalXp: Double
    let onOpenSkillAtlas: () -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        SectionHeader("home.achievements.header")
        if let achievements {
            HStack(alignment: .top, spacing: StazaSpacing.sm) {
                Button(action: onOpenSkillAtlas) { skillsTile(achievements) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("homeSkillsTile")
                achievementsTile(achievements)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        summaryTile
    }

    private func skillsTile(_ achievements: HomeAchievements) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                OverlineText("home.skills")
                HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.xs) {
                    Text(verbatim: StazaFormat.number(Double(achievements.unlockedSkills), locale: locale))
                        .font(StazaFont.metricLarge)
                        .foregroundStyle(StazaColor.textPrimary)
                    Text(verbatim: "/ \(StazaFormat.number(Double(achievements.totalSkills), locale: locale))")
                        .font(StazaFont.metric)
                        .foregroundStyle(StazaColor.textSubtle)
                }
                StazaProgressBar(value: achievements.totalSkills > 0 ? Double(achievements.unlockedSkills) / Double(achievements.totalSkills) : 0)
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
                if achievements.skillPoints > 0 {
                    StazaChip("home.skills.points \(StazaFormat.number(Double(achievements.skillPoints), locale: locale))", tint: StazaColor.accent)
                }
            }
            .frame(maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(maxHeight: .infinity)
    }

    private func achievementsTile(_ achievements: HomeAchievements) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                OverlineText("home.achievements")
                Text(verbatim: StazaFormat.number(Double(achievements.earned.count), locale: locale))
                    .font(StazaFont.metricLarge)
                    .foregroundStyle(StazaColor.textPrimary)
                Spacer(minLength: 0)
                Group {
                    if achievements.earned.isEmpty {
                        Text("home.achievements.empty")
                    } else {
                        Text(verbatim: achievements.earned.prefix(2).map(\.label).joined(separator: " · "))
                    }
                }
                .font(StazaFont.caption)
                .foregroundStyle(StazaColor.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("homeAchievementsTile")
    }

    private var summaryTile: some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                OverlineText("home.summary")
                summaryRow("home.summary.totalXp", StazaFormat.number(totalXp, locale: locale))
                summaryRow("home.summary.distance", StazaFormat.distance(meters: lifetime.distanceMeters, locale: locale))
                summaryRow("home.summary.collected", StazaFormat.number(Double(lifetime.totalCollectibles), locale: locale))
                summaryRow("home.summary.flowlines", StazaFormat.number(Double(lifetime.totalFlowlines), locale: locale))
            }
        }
        .accessibilityIdentifier("homeSummary")
    }

    private func summaryRow(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(StazaColor.textMuted)
            Spacer(minLength: StazaSpacing.sm)
            Text(verbatim: value).font(StazaFont.metric.weight(.semibold)).foregroundStyle(StazaColor.textPrimary)
        }
        .font(StazaFont.subheadline)
        .accessibilityElement(children: .combine)
    }
}

/// Latest activity with a static route still and collected items (web `HomeRecentActivity`).
struct RecentActivityCard: View {
    let activity: ActivityHistoryItem
    let detail: ActivityDetail?
    let replay: ReplayTimeline?
    let basemap: Basemap?
    @Environment(\.locale) private var locale

    private var events: [ActivityDetailEvent] { detail?.events ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(StazaSpacing.md)
            if let replay, let basemap, let url = URL(string: basemap.styleUrl) {
                ReplayMapView(styleURL: url, timeline: replay, currentMs: replay.endMs, revealed: replay.reveals, isInteractive: false, palette: basemap.mapPalette)
                    .frame(height: 200)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            detailLine
                .font(StazaFont.metric)
                .foregroundStyle(StazaColor.textMuted)
                .padding(StazaSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(StazaColor.canvas.opacity(0.5))
            if detail != nil {
                collected.padding(StazaSpacing.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(StazaColor.surface, in: shape)
        .overlay(shape.strokeBorder(StazaColor.border, lineWidth: 1))
        .clipShape(shape)
        .contentShape(shape)
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: StazaRadius.card, style: .continuous) }

    private var header: some View {
        HStack(alignment: .top, spacing: StazaSpacing.sm) {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                if let date = activity.startedDate {
                    OverlineText(verbatim: ActivityStyle.overlineDate(date, locale: locale))
                }
                if !activity.title.isEmpty {
                    Text(verbatim: activity.title)
                        .font(StazaFont.headline)
                        .foregroundStyle(StazaColor.textPrimary)
                        .multilineTextAlignment(.leading)
                }
                Text(verbatim: activity.distanceMeters.map { StazaFormat.distance(meters: $0, locale: locale) } ?? "—")
                    .font(StazaFont.metricLarge)
                    .foregroundStyle(StazaColor.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            Spacer(minLength: StazaSpacing.sm)
            VStack(alignment: .trailing, spacing: StazaSpacing.xs) {
                OverlineText("home.recent.xpEarned")
                XPValue(xp: activity.xpEarned, font: StazaFont.metricLarge)
            }
        }
    }

    private var detailLine: Text {
        let revisits = detail?.revisitCount ?? activity.revisitCount ?? 0
        let hasVideo = detail?.hasVideo ?? activity.hasVideo ?? false
        var parts: [Text] = [Self.sportLabel(activity.type)]
        if let seconds = activity.durationSeconds { parts.append(Text(verbatim: ActivityStyle.duration(seconds: seconds, locale: locale))) }
        parts.append(Text("home.recent.detail.collected \(StazaFormat.number(Double(activity.collectedCount), locale: locale))"))
        if revisits > 0 { parts.append(Text("home.recent.detail.revisited \(StazaFormat.number(Double(revisits), locale: locale))")) }
        if activity.flowlineCount == 1 {
            parts.append(Text("home.recent.detail.flowline.one"))
        } else if activity.flowlineCount > 1 {
            parts.append(Text("home.recent.detail.flowlines \(StazaFormat.number(Double(activity.flowlineCount), locale: locale))"))
        }
        if hasVideo { parts.append(Text("home.recent.detail.pov")) }
        return parts.dropFirst().reduce(parts[0]) { $0 + Text(verbatim: " · ").foregroundStyle(StazaColor.textSubtle) + $1 }
    }

    @ViewBuilder
    private var collected: some View {
        if events.isEmpty {
            Text("home.recent.noFinds")
                .font(StazaFont.subheadline)
                .foregroundStyle(StazaColor.textMuted)
        } else {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                OverlineText("home.recent.collected")
                MoreFlowLayout {
                    ForEach(events.prefix(4)) { event in
                        StazaChip(verbatim: event.collectible.name, tint: StazaColor.textPrimary)
                    }
                }
            }
        }
    }

    static func sportLabel(_ type: String) -> Text {
        switch type {
        case "cycling": Text("home.sport.cycling")
        case "running": Text("home.sport.running")
        case "hiking": Text("home.sport.hiking")
        case "walking": Text("home.sport.walking")
        default: Text("home.sport.unknown")
        }
    }
}
