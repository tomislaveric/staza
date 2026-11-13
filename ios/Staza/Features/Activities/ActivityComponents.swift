import SwiftUI

/// Presentation helpers shared by the Rides list, activity detail and replay.
enum ActivityStyle {
    /// Rarity-like tint derived from the XP value, since the API no longer carries rarity.
    static func tint(xp: Double, isRepeat: Bool = false) -> Color {
        if isRepeat { return StazaColor.textMuted }
        switch xp {
        case 500...: return StazaColor.rarityLegendary
        case 250..<500: return StazaColor.rarityEpic
        case 100..<250: return StazaColor.rarityRare
        default: return StazaColor.rarityCommon
        }
    }

    static func icon(collectibleType type: String) -> String {
        switch type {
        case "viewpoint": "binoculars.fill"
        case "peak", "mountain": "mountain.2.fill"
        case "castle": "building.columns.fill"
        case "waterfall": "drop.fill"
        case "mountain_pass": "road.lanes"
        default: "mappin.circle.fill"
        }
    }

    static let flowlineIcon = "point.topleft.down.to.point.bottomright.curvepath"

    static func duration(seconds: Double, locale: Locale) -> String {
        let units: Set<Duration.UnitsFormatStyle.Unit> = seconds >= 3600 ? [.hours, .minutes] : [.minutes]
        return Duration.seconds(seconds).formatted(.units(allowed: units, width: .narrow).locale(locale))
    }

    /// Overline such as "SAT 26 SEP 2026" (uppercased by `OverlineText`).
    static func overlineDate(_ date: Date, locale: Locale) -> String {
        var style = Date.FormatStyle(locale: locale).weekday(.abbreviated).day().month(.abbreviated).year()
        style.locale = locale
        return date.formatted(style)
    }
}

/// Big condensed distance with optional duration, as on the web "Last ride" card.
struct ActivityDistanceLine: View {
    @Environment(\.locale) private var locale
    let meters: Double?
    let seconds: Double?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
            if let meters {
                Text(verbatim: StazaFormat.distance(meters: meters, locale: locale))
                    .font(StazaFont.metricLarge)
                    .foregroundStyle(StazaColor.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            if let seconds, seconds > 0 {
                Text(verbatim: ActivityStyle.duration(seconds: seconds, locale: locale))
                    .font(StazaFont.metric)
                    .foregroundStyle(StazaColor.textMuted)
                    .lineLimit(1)
            }
        }
    }
}

/// Accent "+N XP" value used on ride cards and rows.
struct XPValue: View {
    @Environment(\.locale) private var locale
    let xp: Double
    var font: Font = StazaFont.title3.monospacedDigit()

    var body: some View {
        Text("activities.row.xp \(StazaFormat.number(xp, locale: locale))")
            .font(font)
            .foregroundStyle(StazaColor.accent)
            .lineLimit(1)
    }
}
