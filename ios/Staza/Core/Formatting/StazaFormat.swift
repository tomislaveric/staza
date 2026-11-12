import Foundation

/// Locale-aware formatting. All functions take a `Locale` so views can pass
/// `@Environment(\.locale)` and tests can pin a locale.
enum StazaFormat {
    static func number(_ value: Double, locale: Locale, fractionDigits: Int = 0) -> String {
        value.formatted(.number.precision(.fractionLength(fractionDigits...fractionDigits)).locale(locale))
    }

    static func date(_ date: Date, locale: Locale, timeZone: TimeZone = .current) -> String {
        var style = Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale, timeZone: timeZone)
        style.locale = locale
        return date.formatted(style)
    }

    /// Distance in meters rendered with the locale's measurement system
    /// (km/m or mi/ft).
    static func distance(meters: Double, locale: Locale) -> String {
        let measurement = Measurement(value: meters, unit: UnitLength.meters)
        return measurement.formatted(
            .measurement(width: .abbreviated, usage: .road, numberFormatStyle: .number.precision(.fractionLength(0...1)))
                .locale(locale)
        )
    }
}
