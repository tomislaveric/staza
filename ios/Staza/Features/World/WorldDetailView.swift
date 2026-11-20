import SwiftUI

/// Sheet header for the tapped collectible or flowline: icon, name and close button.
struct WorldDetailHeader: View {
    let selection: WorldSelection
    let isQuestTarget: Bool
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: StazaSpacing.md) {
            IconBadge(systemImage: selection.systemImage, tint: selection.tint(isQuestTarget: isQuestTarget), size: 48)
            VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                Text(selection.kindLabel)
                    .font(StazaFont.footnote)
                    .foregroundStyle(StazaColor.textMuted)
                Text(verbatim: selection.name)
                    .font(StazaFont.title3)
                    .foregroundStyle(StazaColor.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: StazaSpacing.sm)
            SheetCloseButton(action: onClose)
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.md)
        .accessibilityIdentifier("worldDetailHeader")
    }
}

/// Status chips and facts about the tapped collectible or flowline. A Flowline leads with its primary
/// character; further scores stay behind "View details".
struct WorldDetailBody: View {
    let selection: WorldSelection
    let isQuestTarget: Bool
    var inRoute = false
    /// Adds the shown collectible or revealed Flowline to the route being planned, or removes it.
    var onToggleRoute: (() -> Void)? = nil
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            FlowChips {
                StazaChip(selection.statusLabel, systemImage: selection.done ? "checkmark.circle.fill" : "circle.dashed", tint: selection.done ? StazaColor.success : StazaColor.textSubtle)
                if case .flowline(let flowline) = selection {
                    FlowlineCharacterChip(flowline: flowline)
                }
                if isQuestTarget {
                    StazaChip("world.detail.questTarget", systemImage: "scope", tint: StazaColor.accent)
                }
            }
            if case .flowline(let flowline) = selection {
                flowlineFacts(flowline)
            }
            if let onToggleRoute {
                Button(action: onToggleRoute) {
                    Label(inRoute ? "world.route.added" : "world.route.add", systemImage: inRoute ? "checkmark" : "plus")
                }
                .buttonStyle(inRoute ? .stazaSecondaryWide : .stazaPrimaryWide)
                .accessibilityAddTraits(inRoute ? .isSelected : [])
                .accessibilityIdentifier("worldAddToRoute")
            }
            if case .flowline(let flowline) = selection {
                DisclosureGroup("world.detail.viewDetails") { details(flowline) }
                    .font(StazaFont.subheadline.weight(.medium))
                    .tint(StazaColor.textMuted)
                    .foregroundStyle(StazaColor.textPrimary)
                    .accessibilityIdentifier("worldFlowlineDetails")
            }
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.lg)
        .accessibilityIdentifier("worldDetailSheet")
    }

    /// Length, the primary character's score and road quality: never more than two scores at once.
    @ViewBuilder
    private func flowlineFacts(_ flowline: WorldFlowline) -> some View {
        let character = flowline.resolvedCharacter
        HStack(spacing: StazaSpacing.md) {
            if let length = flowline.lengthMeters {
                StatTile(label: "world.detail.length", value: StazaFormat.distance(meters: length, locale: locale))
            }
            if let score = flowline.score(for: character.primary) {
                StatTile(label: character.primary.scoreLabel, value: "\(Int(score.rounded()))", tint: character.primary.tint)
            }
            if let quality = flowline.roadQualityScore {
                StatTile(label: "world.detail.roadQuality", value: "\(Int(quality.rounded()))")
            }
        }
        if character.tags.count > 1 {
            HStack(spacing: StazaSpacing.sm) {
                Text("world.detail.bestFor").font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
                ForEach(character.tags, id: \.self) { tag in
                    StazaChip(tag.scoreLabel, systemImage: tag.systemImage, tint: tag.tint)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func details(_ flowline: WorldFlowline) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            HStack(spacing: StazaSpacing.md) {
                ForEach(FlowlineTag.allCases, id: \.self) { tag in
                    if let score = flowline.score(for: tag) {
                        StatTile(label: tag.scoreLabel, value: "\(Int(score.rounded()))", tint: tag.tint)
                    }
                }
            }
            if !flowline.completed {
                Text("world.detail.completeHint").font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
            }
        }
        .padding(.top, StazaSpacing.sm)
    }
}

/// Round close button used in World sheet headers.
struct SheetCloseButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.footnote.weight(.bold))
                .foregroundStyle(StazaColor.textMuted)
                .frame(width: 30, height: 30)
                .background(StazaColor.surfaceRaised, in: Circle())
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("world.sheet.close"))
        .accessibilityIdentifier("worldSheetClose")
    }
}

extension WorldSelection {
    var name: String {
        switch self {
        case .collectible(let item): item.name
        case .flowline(let item): item.name
        }
    }

    var done: Bool {
        switch self {
        case .collectible(let item): item.found
        case .flowline(let item): item.completed
        }
    }

    var systemImage: String {
        switch self {
        case .collectible(let item): WorldCategory.systemImage(item.primaryCategory)
        case .flowline: "point.topleft.down.to.point.bottomright.curvepath"
        }
    }

    func tint(isQuestTarget: Bool) -> Color {
        if done { return StazaColor.success }
        if isQuestTarget { return StazaColor.accent }
        switch self {
        case .collectible: return StazaColor.textMuted
        case .flowline: return StazaColor.rarityRare
        }
    }

    var kindLabel: LocalizedStringKey {
        switch self {
        case .collectible(let item):
            switch item.primaryCategory {
            case "viewpoint": return "world.category.viewpoint"
            case "peak", "mountain": return "world.category.peak"
            case "castle": return "world.category.castle"
            case "waterfall": return "world.category.waterfall"
            case "place": return "world.category.place"
            case "mountain_pass": return "world.category.mountainPass"
            default: return "world.detail.collectible"
            }
        case .flowline: return "world.detail.flowline"
        }
    }

    var statusLabel: LocalizedStringKey {
        switch self {
        case .collectible(let item): item.found ? "world.detail.found" : "world.detail.notFound"
        case .flowline(let item): item.completed ? "world.detail.completed" : "world.flowline.unridden"
        }
    }
}

/// Wraps chips onto multiple lines when they do not fit on one.
private struct FlowChips<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: StazaSpacing.sm) { content }
            VStack(alignment: .leading, spacing: StazaSpacing.sm) { content }
        }
    }
}

#Preview("Collectible") {
    let selection = WorldSelection.collectible(WorldCollectible(id: "c1", name: "Peak", latitude: 47, longitude: 8, found: false, primaryCategory: "peak"))
    VStack {
        WorldDetailHeader(selection: selection, isQuestTarget: true) {}
        WorldDetailBody(selection: selection, isQuestTarget: true)
    }
    .stazaScreen()
    .preferredColorScheme(.dark)
}
