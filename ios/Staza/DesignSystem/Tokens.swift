import SwiftUI
import UIKit

/// Design tokens aligned with the web palette (`public` CSS), adapted for light
/// and dark appearance. Dark values match the web canvas.
enum StazaColor {
    static let canvas = dynamic(light: 0xF6F4EF, dark: 0x0D0E10)
    static let surface = dynamic(light: 0xFFFFFF, dark: 0x111318)
    static let surfaceRaised = dynamic(light: 0xEEEAE2, dark: 0x171A20)
    static let textPrimary = dynamic(light: 0x1B1C1F, dark: 0xEDE9E2)
    static let textMuted = dynamic(light: 0x5F636B, dark: 0x9AA0AA)
    static let accent = dynamic(light: 0xB88A00, dark: 0xF5C823)
    static let onAccent = dynamic(light: 0xFFFFFF, dark: 0x0D0E10)
    static let success = dynamic(light: 0x1E9B53, dark: 0x34C76F)
    static let border = dynamic(light: 0xD8D3C8, dark: 0x2A2D34)

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

enum StazaSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
}

enum StazaRadius {
    static let card: CGFloat = 12
    static let panel: CGFloat = 16
}

/// Text styles map to system text styles so they scale with Dynamic Type.
enum StazaFont {
    static let display = Font.system(.largeTitle, design: .rounded).weight(.bold)
    static let title = Font.system(.title2, design: .rounded).weight(.semibold)
    static let headline = Font.headline
    static let body = Font.body
    static let caption = Font.caption
    static let metric = Font.system(.title3, design: .monospaced).weight(.medium)
}
