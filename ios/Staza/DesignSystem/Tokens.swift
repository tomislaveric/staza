import SwiftUI

/// Design tokens mirroring the Figma `Staza iOS / Color` and `Staza iOS / Layout`
/// variable collections. The app is dark only, matching the web canvas.
enum StazaColor {
    static let canvas = hex(0x0D0E10)
    static let surface = hex(0x111318)
    static let surfaceRaised = hex(0x171A20)
    static let track = hex(0x1F232B)
    static let map = hex(0x0B0C0F)

    static let textPrimary = hex(0xEDE9E2)
    static let textMuted = hex(0x9AA0AA)
    static let textSubtle = hex(0x737880)
    static let onAccent = hex(0x0D0E10)

    static let accent = hex(0xF5C823)
    static let accentPressed = hex(0xE8B80A)
    static let success = hex(0x34C76F)
    static let danger = hex(0xFF5C5C)

    static let border = hex(0x2A2D34)
    static let borderStrong = hex(0x3C3F48)

    static let rarityCommon = hex(0x8C919A)
    static let rarityRare = hex(0x5B9BD5)
    static let rarityEpic = hex(0x9B6BFF)
    static let rarityLegendary = accent

    static let route = accent
    static let markerRing = hex(0x7FBAD0)

    private static func hex(_ value: UInt32) -> Color {
        Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

enum StazaSpacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
}

enum StazaRadius {
    static let chip: CGFloat = 8
    static let card: CGFloat = 16
    static let panel: CGFloat = 24
}

/// Text styles map to system text styles so they scale with Dynamic Type.
/// Metric styles use tabular digits so changing numbers don't jitter.
enum StazaFont {
    static let display = Font.largeTitle.weight(.bold)
    static let title = Font.title2.weight(.bold)
    static let title3 = Font.title3.weight(.semibold)
    static let headline = Font.headline
    static let body = Font.body
    static let callout = Font.callout
    static let subheadline = Font.subheadline
    static let footnote = Font.footnote
    static let caption = Font.caption
    static let overline = Font.caption2.weight(.semibold)
    static let hero = Font.system(size: 72, weight: .bold).width(.condensed).monospacedDigit()
    static let metricLarge = Font.system(.largeTitle).weight(.semibold).width(.condensed).monospacedDigit()
    static let metric = Font.subheadline.weight(.medium).monospacedDigit()
    static let metricSmall = Font.caption.weight(.medium).monospacedDigit()
}
