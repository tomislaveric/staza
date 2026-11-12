package world.staza.app

import org.junit.Assert.assertEquals
import org.junit.Test
import world.staza.app.core.format.StazaFormat
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

class StazaFormatTest {
    private val en = Locale.US
    private val de = Locale.GERMANY

    @Test fun numbersUseLocaleSeparators() {
        assertEquals("1,234.5", StazaFormat.number(1234.5, en, 1))
        assertEquals("1.234,5", StazaFormat.number(1234.5, de, 1))
    }

    @Test fun datesAreLocalized() {
        val instant = Instant.parse("2026-03-14T12:00:00Z")
        assertEquals("Mar 14, 2026", StazaFormat.date(instant, en, ZoneId.of("UTC")))
        assertEquals("14.03.2026", StazaFormat.date(instant, de, ZoneId.of("UTC")))
    }

    @Test fun distanceUsesMetricOrImperial() {
        assertEquals("42,2 km", StazaFormat.distance(42195.0, de))
        assertEquals("850 m", StazaFormat.distance(850.0, de))
        assertEquals("26.2 mi", StazaFormat.distance(42195.0, en))
        assertEquals("164 ft", StazaFormat.distance(50.0, en))
    }
}
