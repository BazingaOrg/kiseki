import XCTest
@testable import Kiseki

final class BeatAnalysisTests: XCTestCase {
    func testMissingFileReturnsEmpty() {
        let url = URL(fileURLWithPath: "/tmp/kiseki-missing-\(UUID().uuidString).m4a")
        let features = BeatAnalysis.analyze(url)
        XCTAssertTrue(features.times.isEmpty)
        XCTAssertTrue(features.energy.isEmpty)
        XCTAssertTrue(features.onset.isEmpty)
        XCTAssertTrue(features.lowOnset.isEmpty)
    }

    func testEmptyURLReturnsEmpty() {
        let features = BeatAnalysis.analyze(URL(fileURLWithPath: ""))
        XCTAssertTrue(features.times.isEmpty)
    }

    func testInsufficientSamplesReturnEmpty() {
        XCTAssertTrue(BeatAnalysis.analyze(samples: [], sampleRate: 22050).times.isEmpty)
        XCTAssertTrue(BeatAnalysis.analyze(samples: [0.1, 0.2, 0.3], sampleRate: 22050).times.isEmpty)
        let short = [Float](repeating: 0.2, count: Int(22050 * 2))
        XCTAssertTrue(BeatAnalysis.analyze(samples: short, sampleRate: 22050).times.isEmpty)
    }
}
