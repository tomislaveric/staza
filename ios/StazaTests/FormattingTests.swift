import XCTest
@testable import Staza

final class FormattingTests: XCTestCase {
    func testNumberUsesLocaleSeparators() {
        XCTAssertEqual(StazaFormat.number(12345.5, locale: Locale(identifier: "en_US"), fractionDigits: 1), "12,345.5")
        XCTAssertEqual(StazaFormat.number(12345.5, locale: Locale(identifier: "de_DE"), fractionDigits: 1), "12.345,5")
    }

    func testDistanceUsesLocaleUnits() {
        XCTAssertTrue(StazaFormat.distance(meters: 5000, locale: Locale(identifier: "de_DE")).contains("km"))
        XCTAssertTrue(StazaFormat.distance(meters: 5000, locale: Locale(identifier: "en_US")).contains("mi"))
    }
}
