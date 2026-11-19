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

/// One featured next step (web `HomeUpNext`): the easiest active quest, else an active
/// exploration, else planning one.
struct UpNextSection: View {
    enum Target: Equatable, Sendable { case quests, world }

    let highlights: HomeHighlights
    let perform: (Target) -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        SectionHeader("home.upNext.header")
        if let quest = highlights.quest {
            Button { perform(.quests) } label: { questCard(quest) }
                .buttonStyle(.stazaCardPress)
                .accessibilityIdentifier("homeUpNext.quest.\(quest.id)")
            if highlights.activeQuestCount > 1 {
                Button { perform(.quests) } label: {
                    Label { Text("home.upNext.moreQuests \(highlights.activeQuestCount - 1)") } icon: { Image(systemName: "chevron.right") }
                        .labelStyle(TrailingIconLabelStyle())
                        .font(StazaFont.footnote.weight(.medium))
                        .foregroundStyle(StazaColor.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("homeUpNext.moreQuests")
            }
            if let exploration = highlights.exploration {
                Button { perform(.world) } label: { explorationRow(exploration) }
                    .buttonStyle(.stazaCardPress)
                    .accessibilityIdentifier("homeUpNext.exploration.\(exploration.id)")
            }
        } else if let exploration = highlights.exploration {
            Button { perform(.world) } label: {
                featured(
                    tint: StazaColor.markerRing,
                    overline: Text("home.upNext.exploration"),
                    title: Text(verbatim: exploration.title),
                    goal: Text(verbatim: exploration.description),
                    xp: exploration.rewardXp
                ) { EmptyView() }
            }
            .buttonStyle(.stazaCardPress)
            .accessibilityIdentifier("homeUpNext.exploration.\(exploration.id)")
        } else {
            Button { perform(.world) } label: {
                featured(
                    tint: StazaColor.markerRing,
                    overline: Text("home.upNext.plan.overline"),
                    title: Text("home.upNext.plan.title"),
                    goal: Text("home.upNext.plan.goal"),
                    xp: nil
                ) { EmptyView() }
            }
            .buttonStyle(.stazaCardPress)
            .accessibilityIdentifier("homeUpNext.plan")
        }
    }

    private func questCard(_ quest: AuthoredQuest) -> some View {
        featured(
            tint: StazaColor.accent,
            overline: Text(verbatim: quest.chainTitle) + Text(verbatim: "  ·  ") + Text("quests.pill.step \(quest.step) \(quest.totalSteps)"),
            title: Text(verbatim: quest.title),
            goal: Text(verbatim: quest.description),
            xp: quest.xp
        ) {
            if quest.isNew == true {
                StazaChip("quests.pill.new", tint: StazaColor.accent)
            }
            if let failure = quest.lastFailure {
                StazaChip("quests.pill.fellShort", systemImage: "xmark", tint: StazaColor.danger)
                ForEach(Array((failure.criteria ?? []).filter { !$0.met }.enumerated()), id: \.offset) { _, criterion in
                    StazaChip(verbatim: QuestPills.criterion(criterion, locale: locale), tint: StazaColor.danger)
                }
            }
            StazaChip(QuestPills.difficulty(quest.difficulty))
        }
    }

    private func featured<Pills: View>(tint: Color, overline: Text, title: Text, goal: Text, xp: Double?, @ViewBuilder pills: () -> Pills) -> some View {
        let shape = RoundedRectangle(cornerRadius: StazaRadius.card, style: .continuous)
        return VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            overline
                .font(StazaFont.overline)
                .textCase(.uppercase)
                .tracking(0.9)
                .foregroundStyle(tint)
                .lineLimit(1)
            title
                .font(StazaFont.title)
                .foregroundStyle(StazaColor.textPrimary)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            goal
                .font(StazaFont.subheadline)
                .foregroundStyle(StazaColor.textMuted)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .center, spacing: StazaSpacing.sm) {
                MoreFlowLayout(spacing: StazaSpacing.xs + StazaSpacing.xxs) { pills() }
                Spacer(minLength: 0)
                if let xp {
                    Text("home.quest.reward \(StazaFormat.number(xp, locale: locale))")
                        .font(StazaFont.title3.monospacedDigit())
                        .foregroundStyle(StazaColor.accent)
                        .shadow(color: StazaColor.accent.opacity(0.35), radius: 8)
                        .lineLimit(1)
                        .fixedSize()
                }
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(StazaColor.textSubtle)
                    .accessibilityHidden(true)
            }
            .padding(.top, StazaSpacing.xs)
        }
        .padding(StazaSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            shape.fill(StazaColor.surface)
                .overlay(shape.fill(RadialGradient(colors: [tint.opacity(0.18), .clear], center: .topTrailing, startRadius: 0, endRadius: 260)))
        }
        .overlay(shape.strokeBorder(tint.opacity(0.4), lineWidth: 1))
        .contentShape(shape)
        .accessibilityElement(children: .combine)
    }

    private func explorationRow(_ exploration: QuestInstance) -> some View {
        StazaCard(padding: StazaSpacing.sm + StazaSpacing.xs) {
            HStack(spacing: StazaSpacing.sm) {
                IconBadge(systemImage: "map", tint: StazaColor.markerRing, size: 32)
                VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                    OverlineText("home.upNext.exploration")
                    Text(verbatim: exploration.title)
                        .font(StazaFont.subheadline.weight(.semibold))
                        .foregroundStyle(StazaColor.textPrimary)
                        .lineLimit(1)
                }
                Spacer(minLength: StazaSpacing.sm)
                Text("home.quest.reward \(StazaFormat.number(exploration.rewardXp, locale: locale))")
                    .font(StazaFont.metric)
                    .foregroundStyle(StazaColor.accent)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(StazaColor.textSubtle)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Skill Atlas nodes the player can unlock now and nodes that are close (web `HomeSkillHighlights`).
struct SkillHighlightsSection: View {
    let highlights: HomeHighlights
    let onOpenSkillAtlas: () -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        SectionHeader("home.skillHighlights.header") {
            if highlights.skillPoints > 0 {
                StazaChip("home.skills.points \(StazaFormat.number(Double(highlights.skillPoints), locale: locale))", tint: StazaColor.accent)
            }
        }
        if !highlights.ready.isEmpty {
            group("home.skillHighlights.ready") {
                ForEach(highlights.ready) { node in
                    Button(action: onOpenSkillAtlas) { readyCard(node) }
                        .buttonStyle(.stazaCardPress)
                        .accessibilityIdentifier("homeSkill.ready.\(node.id)")
                }
            }
        } else if highlights.skillPoints > 0 {
            Button(action: onOpenSkillAtlas) {
                Label { Text("home.skillHighlights.spend \(highlights.skillPoints)") } icon: { Image(systemName: "chevron.right") }
                    .labelStyle(TrailingIconLabelStyle())
                    .font(StazaFont.footnote.weight(.medium))
                    .foregroundStyle(StazaColor.accent)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("homeSkill.spend")
        }
        if !highlights.almost.isEmpty {
            group("home.skillHighlights.almost") {
                ForEach(highlights.almost) { item in
                    Button(action: onOpenSkillAtlas) { almostCard(item) }
                        .buttonStyle(.stazaCardPress)
                        .accessibilityIdentifier("homeSkill.almost.\(item.id)")
                }
            }
        }
    }

    private func group<Cards: View>(_ title: LocalizedStringKey, @ViewBuilder cards: () -> Cards) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            OverlineText(title)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: StazaSpacing.sm) { cards() }
                    .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollClipDisabled()
        }
    }

    private func readyCard(_ node: HomeHighlights.Node) -> some View {
        card(node, tint: StazaColor.accent) {
            Text(verbatim: node.grant.label)
                .font(StazaFont.caption)
                .foregroundStyle(StazaColor.textMuted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Text("home.skillHighlights.unlock \(node.cost)")
                .font(StazaFont.caption.weight(.bold))
                .foregroundStyle(StazaColor.onAccent)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(StazaColor.accent, in: Capsule())
        }
    }

    private func almostCard(_ item: HomeHighlights.AlmostNode) -> some View {
        card(item.node, tint: nil) {
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
                if let requirement = item.blockingRequirement {
                    Text(verbatim: requirement.label)
                        .foregroundStyle(StazaColor.textMuted)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Text(verbatim: "\(value(requirement.current))/\(value(requirement.target))")
                        .font(StazaFont.metricSmall)
                        .foregroundStyle(StazaColor.textPrimary)
                } else {
                    Text("home.skillHighlights.needsPoints \(max(item.node.cost - highlights.skillPoints, 1))")
                        .foregroundStyle(StazaColor.textMuted)
                }
            }
            .font(StazaFont.caption)
            StazaProgressBar(value: item.progress, height: 4)
        }
    }

    private func card<Content: View>(_ node: HomeHighlights.Node, tint: Color?, @ViewBuilder content: () -> Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: StazaRadius.card, style: .continuous)
        return VStack(alignment: .leading, spacing: StazaSpacing.xs + StazaSpacing.xxs) {
            Label { Self.sportLabel(node.sport) } icon: { Image(systemName: SkillAtlasNodeGlyph.sportIcon(node.sport)) }
                .font(StazaFont.overline)
                .textCase(.uppercase)
                .foregroundStyle(StazaColor.textSubtle)
            Text(verbatim: node.name)
                .font(StazaFont.headline)
                .foregroundStyle(StazaColor.textPrimary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            content()
        }
        .padding(StazaSpacing.md)
        .frame(width: 200, alignment: .leading)
        .frame(minHeight: 132, alignment: .topLeading)
        .background {
            shape.fill(StazaColor.surface)
                .overlay(shape.fill(LinearGradient(colors: [(tint ?? .clear).opacity(0.14), .clear], startPoint: .topLeading, endPoint: .bottomTrailing)))
        }
        .overlay(shape.strokeBorder(tint?.opacity(0.45) ?? StazaColor.border, lineWidth: 1))
        .contentShape(shape)
        .accessibilityElement(children: .combine)
    }

    private func value(_ number: Double) -> String {
        StazaFormat.number(number, locale: locale, fractionDigits: number.rounded() == number ? 0 : 1)
    }

    static func sportLabel(_ sport: String) -> Text {
        switch sport {
        case "running": Text("addActivity.sport.running")
        case "hiking": Text("addActivity.sport.hiking")
        default: Text("addActivity.sport.cycling")
        }
    }
}

/// Title followed by its icon, for inline "more" links.
struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: StazaSpacing.xs) {
            configuration.title
            configuration.icon.imageScale(.small)
        }
    }
}

/// Subtle press feedback for full-card buttons.
struct StazaCardPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == StazaCardPressStyle {
    static var stazaCardPress: StazaCardPressStyle { StazaCardPressStyle() }
}

/// Shown instead of Up next until the first activity exists (web `HomeOnboarding`).
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
