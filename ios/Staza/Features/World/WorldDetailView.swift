import SwiftUI

/// Sheet header for the tapped POI: icon, name and close button.
struct WorldDetailHeader: View {
    let item: WorldCollectible
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: StazaSpacing.md) {
            IconBadge(systemImage: WorldCategory.systemImage(item.primaryCategory),
                      tint: item.found ? StazaColor.success : StazaColor.textMuted, size: 48)
            VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                Text(LocalizedStringKey(WorldCategory.labelKey(item.primaryCategory)))
                    .font(StazaFont.footnote)
                    .foregroundStyle(StazaColor.textMuted)
                Text(verbatim: item.name)
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

/// What the tapped POI can do for the plan.
enum WorldDetailAction {
    /// No route yet: generate one leading to this POI.
    case routeHere
    /// A route exists: add the POI as a stop, or remove it.
    case toggleStop(inRoute: Bool)
}

/// Found state and elevation of the tapped POI, with its route action.
struct WorldDetailBody: View {
    let item: WorldCollectible
    let action: WorldDetailAction
    let onAction: () -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            HStack(alignment: .center, spacing: StazaSpacing.sm) {
                StazaChip(item.found ? "world.detail.found" : "world.detail.notFound",
                          systemImage: item.found ? "checkmark.circle.fill" : "circle.dashed",
                          tint: item.found ? StazaColor.success : StazaColor.textSubtle)
                if let elevation = item.elevationMeters {
                    StazaChip(verbatim: "\(StazaFormat.number(elevation, locale: locale)) m", systemImage: "arrow.up.right")
                }
                Spacer(minLength: 0)
            }
            actionButton
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.md)
        .accessibilityIdentifier("worldDetailSheet")
    }

    @ViewBuilder
    private var actionButton: some View {
        switch action {
        case .routeHere:
            Button(action: onAction) { Label("world.route.here", systemImage: "arrow.triangle.turn.up.right.diamond") }
                .buttonStyle(.stazaPrimaryWide)
                .accessibilityIdentifier("worldRouteHere")
        case .toggleStop(let inRoute):
            Button(action: onAction) {
                Label(inRoute ? "world.route.remove" : "world.route.add", systemImage: inRoute ? "minus" : "plus")
            }
            .buttonStyle(.stazaSecondary)
            .accessibilityIdentifier("worldAddToRoute")
        }
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

#Preview("POI") {
    let item = WorldCollectible(id: "c1", name: "Peak", latitude: 47, longitude: 8, found: false, primaryCategory: "peak", elevationMeters: 1200)
    VStack {
        WorldDetailHeader(item: item) {}
        WorldDetailBody(item: item, action: .routeHere) {}
    }
    .stazaScreen()
    .preferredColorScheme(.dark)
}
