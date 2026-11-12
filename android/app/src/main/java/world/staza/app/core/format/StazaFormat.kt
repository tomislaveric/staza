package world.staza.app.core.format

import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Locale-aware formatting. Every function takes a [Locale] so UI and tests can pin one. */
object StazaFormat {
    private const val METERS_PER_MILE = 1609.344
    private const val FEET_PER_METER = 3.280839895
    private val MILE_REGIONS = setOf("US", "GB", "LR", "MM")

    fun number(value: Double, locale: Locale, fractionDigits: Int = 0): String =
        NumberFormat.getNumberInstance(locale).apply {
            minimumFractionDigits = fractionDigits
            maximumFractionDigits = fractionDigits
        }.format(value)

    fun date(instant: Instant, locale: Locale, zone: ZoneId = ZoneId.systemDefault()): String =
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).withZone(zone).format(instant)

    /** Distance in meters rendered with the locale's measurement system (km/m or mi/ft). */
    fun distance(meters: Double, locale: Locale): String =
        if (usesMiles(locale)) {
            val miles = meters / METERS_PER_MILE
            if (miles >= 0.1) "${number(miles, locale, 1)} mi" else "${number(meters * FEET_PER_METER, locale)} ft"
        } else if (meters >= 1000) {
            "${number(meters / 1000, locale, 1)} km"
        } else {
            "${number(meters, locale)} m"
        }

    private fun usesMiles(locale: Locale) = locale.country.uppercase() in MILE_REGIONS
}
