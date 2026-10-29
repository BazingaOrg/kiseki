import XCTest
@testable import Kiseki

final class LyricsParserTests: XCTestCase {
    func testMultipleTimestampsProduceSeparateTimedLines() {
        let lines = LyricsParser.parse("[00:01.20][00:03.45]同一句")
        XCTAssertEqual(lines.map(\.time), [1.2, 3.45])
        XCTAssertEqual(lines.map(\.text), ["同一句", "同一句"])
    }

    func testMatchingTimestampsCombineTranslation() {
        let lines = LyricsParser.parse("[00:02.00]Hello\n[00:02.00]你好")
        XCTAssertEqual(lines.count, 1)
        XCTAssertEqual(lines.first?.text, "Hello")
        XCTAssertEqual(lines.first?.translation, "你好")
    }

    func testMalformedAndOutOfRangeTimestampsAreIgnored() {
        let lines = LyricsParser.parse("[ar:Artist]\n[00:60.00]invalid\n[xx:12]invalid\n[00:04.00]valid")
        XCTAssertEqual(lines.map(\.time), [4])
        XCTAssertEqual(lines.map(\.text), ["valid"])
    }

    func testLinesAreOrderedByTimeAndKeepTranslationsAttached() {
        let lines = LyricsParser.parse("[00:12.00]later\n[00:02.00]earlier\n[00:12.00]之后\n[00:07.00]middle")
        XCTAssertEqual(lines.map(\.time), [2, 7, 12])
        XCTAssertEqual(lines.map(\.text), ["earlier", "middle", "later"])
        XCTAssertEqual(lines.last?.translation, "之后")
    }
}
