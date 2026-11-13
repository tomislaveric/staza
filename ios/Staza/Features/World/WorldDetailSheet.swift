import SwiftUI

/// Bottom sheet describing the tapped collectible or flowline.
struct WorldDetailSheet: View {
    let selection: WorldSelection
    let isQuestTarget: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            HStack(alignment: .center, spacing: StazaSpacing.md) {
                IconBadge(systemImage: icon, tint: stateTint, size: 64)
                Text(verbatim: name)
                    .font(StazaFont.title)
                    .foregroundStyle(StazaColor.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .accessibilityAddTraits(.isHeader)
            }
            FlowChips {
                StazaChip(kindLabel, systemImage: categoryIcon, tint: StazaColor.textMuted)
                StazaChip(statusLabel, systemImage: done ? "checkmark.circle.fill" : "circle.dashed", tint: done ? StazaColor.success : StazaColor.textSubtle)
                if isQuestTarget {
                    StazaChip("world.detail.questTarget", systemImage: "scope", tint: StazaColor.accent)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(StazaSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(StazaColor.canvas)
        .accessibilityIdentifier("worldDetailSheet")
    }

    private var stateTint: Color {
        if done { return StazaColor.success }
        if isQuestTarget { return StazaColor.accent }
        switch selection {
        case .collectible: return StazaColor.textMuted
        case .flowline: return StazaColor.rarityRare
        }
    }

    private var categoryIcon: String {
        switch selection {
        case .collectible(let item):
            switch item.primaryCategory {
            case "viewpoint": return "binoculars.fill"
            case "peak", "mountain": return "mountain.2.fill"
            case "castle": return "building.columns.fill"
            case "waterfall": return "drop.fill"
            case "mountain_pass": return "road.lanes"
            default: return "mappin"
            }
        case .flowline: return "point.topleft.down.to.point.bottomright.curvepath"
        }
    }

    private var name: String {
        switch selection {
        case .collectible(let item): item.name
        case .flowline(let item): item.name
        }
    }

    private var done: Bool {
        switch selection {
        case .collectible(let item): item.found
        case .flowline(let item): item.completed
        }
    }

    private var icon: String {
        switch selection {
        case .collectible: categoryIcon
        case .flowline: "point.topleft.down.to.point.bottomright.curvepath"
        }
    }

    private var kindLabel: LocalizedStringKey {
        switch selection {
        case .collectible(let item):
            switch item.primaryCategory {
            case "viewpoint": return "world.category.viewpoint"
            case "peak", "mountain": return "world.category.peak"
            case "castle": return "world.category.castle"
            case "waterfall": return "world.category.waterfall"
            case "mountain_pass": return "world.category.mountainPass"
            default: return "world.detail.collectible"
            }
        case .flowline: return "world.detail.flowline"
        }
    }

    private var statusLabel: LocalizedStringKey {
        switch selection {
        case .collectible(let item): item.found ? "world.detail.found" : "world.detail.notFound"
        case .flowline(let item): item.completed ? "world.detail.completed" : "world.detail.notCompleted"
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
    WorldDetailSheet(
        selection: .collectible(WorldCollectible(id: "c1", name: "Peak", latitude: 47, longitude: 8, found: false, primaryCategory: "peak")),
        isQuestTarget: true
    )
    .preferredColorScheme(.dark)
}
