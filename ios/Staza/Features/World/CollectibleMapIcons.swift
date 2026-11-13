import MapLibre
import UIKit

/// Category icons for collectibles on MapLibre maps, mirroring the web's collectible symbol layer:
/// gold when found, muted when not, and plain circles for categories without an icon (e.g. coins).
enum CollectibleMapIcons {
    static let categories = ["castle", "mountain", "mountain_pass", "peak", "place", "viewpoint", "waterfall"]

    static let foundColor = UIColor(red: 0xE8 / 255, green: 0xB8 / 255, blue: 0x0A / 255, alpha: 1)
    static let mutedColor = UIColor(StazaColor.markerRing)
    static let unfoundFill = UIColor(red: 0x31 / 255, green: 0x5B / 255, blue: 0x68 / 255, alpha: 1)
    static let selectedColor = UIColor(red: 0xFF / 255, green: 0xF1 / 255, blue: 0xA8 / 255, alpha: 1)

    /// Style image name for a collectible, or `nil` when it renders as a fallback circle.
    static func imageName(category: String?, found: Bool) -> String? {
        guard let category, categories.contains(category) else { return nil }
        return found ? "collectible-\(category)" : "collectible-\(category)-muted"
    }

    /// Adds every category icon to the style; call once the style has finished loading.
    static func register(on style: MLNStyle) {
        for category in categories {
            let symbol = WorldCategory.systemImage(category)
            for found in [true, false] {
                guard let name = imageName(category: category, found: found),
                      let image = badge(symbol: symbol, color: found ? foundColor : mutedColor) else { continue }
                style.setImage(image, forName: name)
            }
        }
    }

    /// Icon scale per zoom, matching the web's 0.67 → 1.17 growth.
    static var iconScale: NSExpression { zoomStops([9: 0.67, 12: 0.83, 15: 1, 17: 1.17]) }

    /// Fallback circle radius per zoom, matching the web.
    static var circleRadius: NSExpression { zoomStops([9: 4, 12: 7, 15: 10, 17: 12]) }

    static func zoomStops(_ stops: [Double: Double], scale: Double = 1) -> NSExpression {
        NSExpression(
            format: "mgl_interpolate:withCurveType:parameters:stops:($zoomLevel, 'linear', nil, %@)",
            stops.reduce(into: [NSNumber: NSNumber]()) { $0[NSNumber(value: $1.key)] = NSNumber(value: $1.value * scale) }
        )
    }

    /// A dark disc with a colored ring and glyph, so icons stay legible on the dark basemap.
    private static func badge(symbol: String, color: UIColor) -> UIImage? {
        let config = UIImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
        guard let glyph = UIImage(systemName: symbol, withConfiguration: config)?
            .withTintColor(color, renderingMode: .alwaysOriginal) else { return nil }
        let size = CGSize(width: 28, height: 28)
        return UIGraphicsImageRenderer(size: size).image { _ in
            let disc = UIBezierPath(ovalIn: CGRect(origin: .zero, size: size).insetBy(dx: 1, dy: 1))
            UIColor(StazaColor.map).withAlphaComponent(0.9).setFill()
            disc.fill()
            color.setStroke()
            disc.lineWidth = 1.5
            disc.stroke()
            let fit = min(16 / glyph.size.width, 16 / glyph.size.height, 1)
            let glyphSize = CGSize(width: glyph.size.width * fit, height: glyph.size.height * fit)
            glyph.draw(in: CGRect(
                x: (size.width - glyphSize.width) / 2,
                y: (size.height - glyphSize.height) / 2,
                width: glyphSize.width,
                height: glyphSize.height
            ))
        }
    }
}
