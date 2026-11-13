import SwiftUI

// MARK: - Surfaces

/// Reusable card surface. A `tint` adds a coloured leading edge and border, used for
/// highlighted cards such as quest targets and rarity-coded items.
struct StazaCard<Content: View>: View {
    var tint: Color? = nil
    var padding: CGFloat = StazaSpacing.md
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(StazaColor.surface, in: shape)
            .overlay(alignment: .leading) {
                if let tint {
                    UnevenRoundedRectangle(topLeadingRadius: StazaRadius.card, bottomLeadingRadius: StazaRadius.card)
                        .fill(tint)
                        .frame(width: 3)
                }
            }
            .overlay(shape.strokeBorder(tint?.opacity(0.45) ?? StazaColor.border, lineWidth: 1))
            .clipShape(shape)
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: StazaRadius.card, style: .continuous) }
}

extension View {
    /// Canvas background used by every screen.
    func stazaScreen() -> some View {
        background(StazaColor.canvas.ignoresSafeArea())
    }

    /// Floating panel over maps: Liquid Glass on iOS 26, material before that.
    @ViewBuilder
    func stazaGlass(cornerRadius: CGFloat = StazaRadius.panel) -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        } else {
            background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).strokeBorder(StazaColor.border, lineWidth: 1))
        }
    }
}

// MARK: - Buttons

/// Capsule buttons matching the Figma `Button` component (Primary / Secondary / Plain).
struct StazaButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, plain, destructive }
    var kind: Kind = .primary
    var fullWidth = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(StazaFont.headline)
            .labelStyle(.titleAndIcon)
            .foregroundStyle(foreground)
            .padding(.horizontal, kind == .plain ? StazaSpacing.sm : StazaSpacing.lg)
            .frame(minHeight: 50)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(background(pressed: configuration.isPressed), in: Capsule())
            .overlay {
                if kind == .secondary { Capsule().strokeBorder(StazaColor.border, lineWidth: 1) }
            }
            .contentShape(Capsule())
            .opacity(isEnabled ? 1 : 0.4)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }

    private var foreground: Color {
        switch kind {
        case .primary: StazaColor.onAccent
        case .secondary: StazaColor.textPrimary
        case .plain: StazaColor.accent
        case .destructive: StazaColor.danger
        }
    }

    private func background(pressed: Bool) -> Color {
        switch kind {
        case .primary: pressed ? StazaColor.accentPressed : StazaColor.accent
        case .secondary, .destructive: pressed ? StazaColor.track : StazaColor.surfaceRaised
        case .plain: .clear
        }
    }
}

extension ButtonStyle where Self == StazaButtonStyle {
    static var stazaPrimary: StazaButtonStyle { StazaButtonStyle(kind: .primary) }
    static var stazaPrimaryWide: StazaButtonStyle { StazaButtonStyle(kind: .primary, fullWidth: true) }
    static var stazaSecondary: StazaButtonStyle { StazaButtonStyle(kind: .secondary) }
    static var stazaSecondaryWide: StazaButtonStyle { StazaButtonStyle(kind: .secondary, fullWidth: true) }
    static var stazaPlain: StazaButtonStyle { StazaButtonStyle(kind: .plain) }
    static var stazaDestructive: StazaButtonStyle { StazaButtonStyle(kind: .destructive, fullWidth: true) }
}

// MARK: - Text and data

/// Uppercase eyebrow title with an optional trailing link (Figma `Section Header`).
struct SectionHeader<Trailing: View>: View {
    let title: LocalizedStringKey
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            OverlineText(title)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: StazaSpacing.sm)
            trailing
                .font(StazaFont.footnote.weight(.medium))
                .foregroundStyle(StazaColor.accent)
        }
        .padding(.top, StazaSpacing.sm)
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(_ title: LocalizedStringKey) {
        self.title = title
        self.trailing = EmptyView()
    }
}

extension SectionHeader {
    init(_ title: LocalizedStringKey, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.trailing = trailing()
    }
}

struct OverlineText: View {
    private let text: Text
    init(_ key: LocalizedStringKey) { text = Text(key) }
    init(verbatim: String) { text = Text(verbatim: verbatim) }

    var body: some View {
        text
            .font(StazaFont.overline)
            .textCase(.uppercase)
            .tracking(0.9)
            .foregroundStyle(StazaColor.textMuted)
    }
}

/// Large condensed number that still scales with Dynamic Type.
struct HeroNumber: View {
    let text: String
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 72

    var body: some View {
        Text(verbatim: text)
            .font(.system(size: size, weight: .bold).width(.condensed).monospacedDigit())
            .foregroundStyle(StazaColor.textPrimary)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}

/// Label above a metric value, used in stat grids.
struct StatTile: View {
    let label: LocalizedStringKey
    let value: String
    var tint: Color = StazaColor.textPrimary

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.xs) {
            OverlineText(label)
            Text(verbatim: value)
                .font(StazaFont.title3.monospacedDigit())
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Linear progress matching the Figma `Progress Bar` component.
struct StazaProgressBar: View {
    var value: Double
    var tint: Color = StazaColor.accent
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(StazaColor.track)
                Capsule()
                    .fill(tint)
                    .frame(width: proxy.size.width * min(max(value, 0), 1))
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityValue(Text(min(max(value, 0), 1), format: .percent.precision(.fractionLength(0))))
    }
}

/// Small capsule tag (Figma `Chip`). Used for rarity, status and categories.
struct StazaChip: View {
    let text: Text
    var systemImage: String? = nil
    var tint: Color = StazaColor.textMuted

    init(_ key: LocalizedStringKey, systemImage: String? = nil, tint: Color = StazaColor.textMuted) {
        text = Text(key); self.systemImage = systemImage; self.tint = tint
    }

    init(verbatim: String, systemImage: String? = nil, tint: Color = StazaColor.textMuted) {
        text = Text(verbatim: verbatim); self.systemImage = systemImage; self.tint = tint
    }

    var body: some View {
        HStack(spacing: 5) {
            if let systemImage {
                Image(systemName: systemImage).font(.caption2.weight(.semibold)).accessibilityHidden(true)
            }
            text.font(StazaFont.caption.weight(.medium)).lineLimit(1)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(tint.opacity(0.16), in: Capsule())
        .overlay(Capsule().strokeBorder(tint.opacity(0.45), lineWidth: 1))
    }
}

/// Leading SF Symbol in a tinted rounded square, used in rows.
struct IconBadge: View {
    let systemImage: String
    var tint: Color = StazaColor.accent
    var size: CGFloat = 36

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Inline row of metric values separated by dots, e.g. "842 m · 26.2 km/h".
struct MetricLine: View {
    let items: [String]

    var body: some View {
        HStack(spacing: StazaSpacing.sm) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                if index > 0 {
                    Text(verbatim: "·").foregroundStyle(StazaColor.textSubtle).accessibilityHidden(true)
                }
                Text(verbatim: item)
            }
        }
        .font(StazaFont.metric)
        .foregroundStyle(StazaColor.textMuted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
}

// MARK: - Screen states

struct StazaLoadingView: View {
    let title: LocalizedStringKey

    var body: some View {
        VStack(spacing: StazaSpacing.md) {
            ProgressView().controlSize(.large).tint(StazaColor.accent)
            Text(title).font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 64)
    }
}

/// Centred icon, title, message and optional action, used for empty and error states.
struct StazaStateView<Actions: View>: View {
    var systemImage: String
    var tint: Color = StazaColor.textMuted
    let title: Text
    var message: Text? = nil
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(spacing: StazaSpacing.md) {
            Image(systemName: systemImage)
                .font(.system(size: 32, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 72, height: 72)
                .background(tint.opacity(0.12), in: Circle())
                .accessibilityHidden(true)
            VStack(spacing: StazaSpacing.xs) {
                title.font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                message?.font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
            }
            .multilineTextAlignment(.center)
            actions
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, StazaSpacing.xl)
        .padding(.horizontal, StazaSpacing.md)
    }
}

extension StazaStateView where Actions == EmptyView {
    init(systemImage: String, tint: Color = StazaColor.textMuted, title: Text, message: Text? = nil) {
        self.init(systemImage: systemImage, tint: tint, title: title, message: message) { EmptyView() }
    }
}

/// Standard load-failure state with a retry button.
struct StazaErrorView: View {
    let title: LocalizedStringKey
    let message: String
    var retryTitle: LocalizedStringKey = "home.error.retry"
    let retry: () -> Void

    var body: some View {
        StazaStateView(systemImage: "exclamationmark.triangle.fill", tint: StazaColor.danger, title: Text(title), message: Text(verbatim: message)) {
            Button(retryTitle, action: retry).buttonStyle(.stazaSecondary)
        }
    }
}

/// Placeholder body for tabs whose feature screens are built later.
struct PlaceholderScreen: View {
    let title: LocalizedStringKey
    let systemImage: String

    var body: some View {
        ScrollView {
            StazaStateView(systemImage: systemImage, tint: StazaColor.accent, title: Text(title), message: Text("placeholder.comingSoon"))
                .padding(StazaSpacing.md)
        }
        .stazaScreen()
    }
}

#Preview("Components") {
    ScrollView {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            SectionHeader("home.quests.header") { Text(verbatim: "All rides ›") }
            StazaCard {
                VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                    HeroNumber(text: "7")
                    StazaProgressBar(value: 0.62)
                    MetricLine(items: ["842 m", "26.2 km/h", "5 collected"])
                }
            }
            HStack { StatTile(label: "home.quests.header", value: "18.450"); StatTile(label: "home.quests.header", value: "4 days") }
            HStack {
                StazaChip(verbatim: "Castle Gate", systemImage: "building.columns.fill", tint: StazaColor.rarityRare)
                StazaChip(verbatim: "Epic", tint: StazaColor.rarityEpic)
            }
            StazaCard(tint: StazaColor.rarityEpic) { Text(verbatim: "Turmberg Summit").font(StazaFont.headline) }
            Button("action.addActivity", systemImage: "plus") {}.buttonStyle(.stazaPrimaryWide)
            Button("home.error.retry") {}.buttonStyle(.stazaSecondary)
            StazaErrorView(title: "home.error.title", message: "The network connection was lost.") {}
        }
        .padding(StazaSpacing.md)
    }
    .stazaScreen()
    .preferredColorScheme(.dark)
}
