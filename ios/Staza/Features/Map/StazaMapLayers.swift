import MapLibre
import UIKit

/// Native ports of the web's shared map layer vocabulary (`public/components/shared/map/`),
/// so routes and Flowlines read the same on every client.
enum StazaMapLayers {
    /// `routeWidth` from `staza-route-layers.js`: 2 → 3.5 → 6 across zoom 8–16, scaled.
    static func routeWidth(_ scale: Double) -> NSExpression {
        CollectibleMapIcons.zoomStops([8: 2, 12: 3.5, 16: 6], scale: scale)
    }

    /// Glow, casing and accent line, drawn in that order (`stazaRouteLayers`).
    static func addRoute(to style: MLNStyle, source: MLNSource, id: String, accent: UIColor, palette: MapPalette) {
        let glow = line(id: "\(id)-glow", source: source, color: accent, opacity: 0.16, width: routeWidth(3.2))
        glow.lineBlur = NSExpression(forConstantValue: 4)
        style.addLayer(glow)
        style.addLayer(line(id: "\(id)-casing", source: source, color: palette.color(\.casing), opacity: 0.75, width: routeWidth(1.9)))
        style.addLayer(line(id: "\(id)-line", source: source, color: accent, opacity: 0.95, width: routeWidth(1)))
    }

    /// Muted context route: casing plus a subdued line (`stazaSubduedRouteLayers`).
    static func addSubduedRoute(to style: MLNStyle, source: MLNSource, id: String, palette: MapPalette) {
        style.addLayer(line(id: "\(id)-casing", source: source, color: palette.color(\.casing), opacity: 0.5, width: routeWidth(1.4)))
        style.addLayer(line(id: "\(id)-line", source: source, color: palette.color(\.activityRouteSubdued), opacity: 0.5, width: routeWidth(0.7)))
    }

    /// Flowline casing and line; completed segments are gold, the rest a muted blue-teal
    /// (`staza-fartlek-layers.js`). Features need a boolean `completed` attribute.
    /// Returns the line layer identifier for hit testing.
    @discardableResult
    static func addFlowlines(to style: MLNStyle, source: MLNSource, id: String, palette: MapPalette) -> String {
        style.addLayer(line(id: "\(id)-casing", source: source, color: palette.color(\.casing), opacity: 0.6,
                            width: CollectibleMapIcons.zoomStops([9: 2.4, 12: 3.4, 15: 4.6, 17: 5.6])))
        let layer = line(id: "\(id)-line", source: source, color: palette.color(\.flowline), opacity: 0.68,
                         width: CollectibleMapIcons.zoomStops([9: 1.2, 12: 1.8, 15: 2.6, 17: 3.4]))
        layer.lineColor = NSExpression(format: "TERNARY(completed == YES, %@, %@)", palette.color(\.flowlineCompleted), palette.color(\.flowline))
        layer.lineOpacity = NSExpression(format: "TERNARY(completed == YES, 0.95, 0.68)")
        style.addLayer(layer)
        return layer.identifier
    }

    static func line(id: String, source: MLNSource, color: UIColor, opacity: Double, width: NSExpression) -> MLNLineStyleLayer {
        let layer = MLNLineStyleLayer(identifier: id, source: source)
        layer.lineColor = NSExpression(forConstantValue: color)
        layer.lineOpacity = NSExpression(forConstantValue: opacity)
        layer.lineWidth = width
        layer.lineCap = NSExpression(forConstantValue: "round")
        layer.lineJoin = NSExpression(forConstantValue: "round")
        return layer
    }
}
