import SwiftUI

/// Bottom sheet describing the tapped collectible or flowline.
struct WorldDetailSheet: View {
    let selection: WorldSelection
    let isQuestTarget: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            HStack(alignment: .top) {
                Image(systemName: icon)
                    .font(StazaFont.title)
                    .foregroundStyle(StazaColor.accent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text(verbatim: name).font(StazaFont.title).foregroundStyle(StazaColor.textPrimary)
                    Text(kindLabel).font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                }
            }
            HStack(spacing: StazaSpacing.sm) {
                badge(statusLabel, systemImage: done ? "checkmark.circle.fill" : "circle", tint: done ? StazaColor.success : StazaColor.textMuted)
                if isQuestTarget {
                    badge("world.detail.questTarget", systemImage: "scope", tint: StazaColor.accent)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(StazaSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(StazaColor.canvas)
        .accessibilityIdentifier("worldDetailSheet")
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
        case .collectible: "mappin.circle.fill"
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

    private func badge(_ title: LocalizedStringKey, systemImage: String, tint: Color) -> some View {
        Label(title, systemImage: systemImage)
            .font(StazaFont.caption.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, StazaSpacing.sm)
            .padding(.vertical, StazaSpacing.xs)
            .background(StazaColor.surfaceRaised, in: Capsule())
    }
}

#Preview("Collectible") {
    WorldDetailSheet(
        selection: .collectible(WorldCollectible(id: "c1", name: "Peak", latitude: 47, longitude: 8, found: false, primaryCategory: "peak")),
        isQuestTarget: true
    )
}
