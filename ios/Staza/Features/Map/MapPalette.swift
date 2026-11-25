import UIKit

/// Overlay colors (routes, Flowlines, markers) served with `GET /api/world/basemap`, so native maps
/// match the web. Missing or malformed entries fall back to the web's values.
struct MapPalette: Decodable, Equatable, Sendable {
    var casing = "#0b0c0f"
    var questRoute = "#e8b80a"
    var plannedRoute = "#4c8dff"
    var alternateRoute = "#c9b46a"
    var activityRoute = "#5ec8c2"
    var activityRouteSubdued = "#4a4f59"
    var position = "#e8b80a"
    var positionCore = "#f5f7fa"
    var flowline = "#6b9eac"
    var flowlineCompleted = "#e8b80a"
    var highlight = "#e8b80a"
    var highlightSelected = "#fff1a8"
    var collectibleVisited = "#e8b80a"
    var collectibleUnvisited = "#315b68"
    var collectibleUnvisitedRing = "#7fbad0"

    static let standard = MapPalette()

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        func value(_ key: CodingKeys, _ fallback: String) -> String {
            guard let hex = try? container.decodeIfPresent(String.self, forKey: key), UIColor(hex: hex) != nil else { return fallback }
            return hex
        }
        let defaults = MapPalette.standard
        casing = value(.casing, defaults.casing)
        questRoute = value(.questRoute, defaults.questRoute)
        plannedRoute = value(.plannedRoute, defaults.plannedRoute)
        alternateRoute = value(.alternateRoute, defaults.alternateRoute)
        activityRoute = value(.activityRoute, defaults.activityRoute)
        activityRouteSubdued = value(.activityRouteSubdued, defaults.activityRouteSubdued)
        position = value(.position, defaults.position)
        positionCore = value(.positionCore, defaults.positionCore)
        flowline = value(.flowline, defaults.flowline)
        flowlineCompleted = value(.flowlineCompleted, defaults.flowlineCompleted)
        highlight = value(.highlight, defaults.highlight)
        highlightSelected = value(.highlightSelected, defaults.highlightSelected)
        collectibleVisited = value(.collectibleVisited, defaults.collectibleVisited)
        collectibleUnvisited = value(.collectibleUnvisited, defaults.collectibleUnvisited)
        collectibleUnvisitedRing = value(.collectibleUnvisitedRing, defaults.collectibleUnvisitedRing)
    }

    private enum CodingKeys: String, CodingKey {
        case casing, questRoute, plannedRoute, alternateRoute, activityRoute, activityRouteSubdued, position, positionCore
        case flowline, flowlineCompleted, highlight, highlightSelected
        case collectibleVisited, collectibleUnvisited, collectibleUnvisitedRing
    }

    /// The UIColor for a palette entry; entries are validated on decode.
    func color(_ keyPath: KeyPath<MapPalette, String>) -> UIColor {
        UIColor(hex: self[keyPath: keyPath]) ?? .magenta
    }
}

extension UIColor {
    /// `#rrggbb` (or `rrggbb`) hex color.
    convenience init?(hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(red: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255,
                  blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }
}
