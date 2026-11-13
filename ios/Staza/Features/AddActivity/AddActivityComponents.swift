import SwiftUI

/// Large tappable option card used for the upload and Strava import choices.
struct AddActivityOptionCard: View {
    let systemImage: String
    let title: LocalizedStringKey
    let caption: LocalizedStringKey
    var isSelected = false

    var body: some View {
        HStack(spacing: StazaSpacing.md) {
            IconBadge(systemImage: systemImage, size: 52)
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                Text(title).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                Text(caption)
                    .font(StazaFont.subheadline)
                    .foregroundStyle(isSelected ? StazaColor.accent : StazaColor.textMuted)
                    .lineLimit(2)
            }
            .multilineTextAlignment(.leading)
            Spacer(minLength: StazaSpacing.sm)
            Image(systemName: "chevron.right")
                .font(StazaFont.footnote.weight(.semibold))
                .foregroundStyle(StazaColor.textSubtle)
                .accessibilityHidden(true)
        }
        .padding(StazaSpacing.md)
        .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
        .background(StazaColor.surface, in: shape)
        .overlay(shape.strokeBorder(isSelected ? StazaColor.accent.opacity(0.6) : StazaColor.border, lineWidth: 1))
        .contentShape(shape)
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: StazaRadius.card, style: .continuous) }
}

/// Press feedback for full-card buttons and links.
struct AddActivityCardButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.5)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

#Preview {
    VStack(spacing: StazaSpacing.md) {
        AddActivityOptionCard(systemImage: "doc.badge.plus", title: "addActivity.fit.title", caption: "addActivity.hint")
        AddActivityOptionCard(systemImage: "arrow.down.circle", title: "addActivity.strava", caption: "strava.connect.hint")
    }
    .padding(StazaSpacing.md)
    .stazaScreen()
    .preferredColorScheme(.dark)
}
