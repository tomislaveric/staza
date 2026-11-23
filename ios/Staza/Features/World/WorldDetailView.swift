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

/// Status, tags and key facts of the tapped collectible or Flowline, each shown once.
struct WorldDetailBody: View {
    let selection: WorldSelection
    let isQuestTarget: Bool
    var inRoute = false
    /// Adds the shown collectible or revealed Flowline to the route being planned, or removes it.
    var onToggleRoute: (() -> Void)? = nil
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            HStack(alignment: .center, spacing: StazaSpacing.sm) {
                chips
                Spacer(minLength: 0)
                if let onToggleRoute {
                    CircleIconButton(inRoute ? "world.route.added" : "world.route.add",
                                     systemImage: inRoute ? "checkmark" : "plus",
                                     tint: inRoute ? StazaColor.onAccent : StazaColor.accent,
                                     filled: inRoute, action: onToggleRoute)
                        .accessibilityAddTraits(inRoute ? .isSelected : [])
                        .accessibilityIdentifier("worldAddToRoute")
                }
            }
            facts
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.md)
        .accessibilityIdentifier("worldDetailSheet")
    }

    /// Status, quest target and a Flowline's further character tags (its primary one is a fact below).
    private var chips: some View {
        FlowChips {
            StazaChip(selection.statusLabel, systemImage: selection.done ? "checkmark.circle.fill" : "circle.dashed", tint: selection.done ? StazaColor.success : StazaColor.textSubtle)
            if isQuestTarget {
                StazaChip("world.detail.questTarget", systemImage: "scope", tint: StazaColor.accent)
            }
            if case .flowline(let flowline) = selection {
                let character = flowline.resolvedCharacter
                ForEach(character.tags.filter { $0 != character.primary }, id: \.self) { tag in
                    StazaChip(tag.scoreLabel, systemImage: tag.systemImage, tint: tag.tint)
                }
            }
        }
    }

    /// Flowline: length, primary score and road quality. Collectible: elevation when known.
    @ViewBuilder
    private var facts: some View {
        switch selection {
        case .flowline(let flowline):
            let primary = flowline.resolvedCharacter.primary
            HStack(spacing: StazaSpacing.md) {
                if let length = flowline.lengthMeters {
                    StatTile(label: "world.detail.length", value: StazaFormat.distance(meters: length, locale: locale))
                }
                if let primary, let score = flowline.score(for: primary) {
                    StatTile(label: primary.scoreLabel, value: "\(Int(score.rounded()))", tint: primary.tint)
                }
                if let quality = flowline.roadQualityScore {
                    StatTile(label: "world.detail.roadQuality", value: "\(Int(quality.rounded()))")
                }
            }
        case .collectible(let item):
            if let elevation = item.elevationMeters {
                StatTile(label: "world.detail.elevation", value: "\(StazaFormat.number(elevation, locale: locale)) m")
            }
        }
    }
}

/// Small round icon button used in World lists and details, e.g. add to route or show on map.
struct CircleIconButton: View {
    let label: LocalizedStringKey
    let systemImage: String
    var tint: Color = StazaColor.textMuted
    var filled = false
    let action: () -> Void

    init(_ label: LocalizedStringKey, systemImage: String, tint: Color = StazaColor.textMuted, filled: Bool = false,
         action: @escaping () -> Void) {
        self.label = label; self.systemImage = systemImage; self.tint = tint; self.filled = filled; self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.footnote.weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .background(filled ? StazaColor.accent : StazaColor.surfaceRaised, in: Circle())
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
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
        case .collectible(let item): return LocalizedStringKey(WorldCategory.labelKey(item.primaryCategory))
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
