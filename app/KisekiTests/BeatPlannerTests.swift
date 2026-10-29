import XCTest
@testable import Kiseki

final class BeatPlannerTests: XCTestCase {
    func testEightPhotosAt120BpmCutOnBarBeats() {
        let duration = 32.0
        let beats = (0...64).map { Double($0) * 0.5 }
        let energy = beats.enumerated().map { $0.offset % 2 == 0 ? 0.2 : 0.9 }
        let cuts = planPhotoCuts(duration: duration, nPhotos: 8, beatTimes: beats, energy: energy)
        XCTAssertEqual(cuts.count, 7)
        let times = cuts.map(\.time)
        let gaps = zip([0.0] + times, times).map { $1 - $0 }
        XCTAssertGreaterThanOrEqual(gaps.min() ?? 0, 2 - 1e-6)
        let frame = 1.0 / 60
        for time in times {
            XCTAssertTrue(beats.contains { abs($0 - time) <= frame }, "cut \(time) is not on a beat")
        }
    }

    func testSparseBeatsReturnFewerCutsWithoutCrashing() {
        let cuts = planPhotoCuts(duration: 32, nPhotos: 10, beatTimes: [1, 2, 3])
        XCTAssertLessThan(cuts.count, 9)
        XCTAssertEqual(cuts.map(\.time), cuts.map(\.time).sorted())
    }

    func testEmptyBeatsFallBackInsideDuration() {
        let duration = 32.0
        let cuts = planPhotoCuts(duration: duration, nPhotos: 8, beatTimes: [])
        XCTAssertFalse(cuts.isEmpty)
        var previous = 0.0
        for cut in cuts {
            XCTAssertGreaterThan(cut.time, 0)
            XCTAssertLessThan(cut.time, duration)
            XCTAssertGreaterThan(cut.time, previous)
            previous = cut.time
        }
    }

    func testLyricSpanPrefersNearLineEndOverMidPhrase() {
        let cuts = planPhotoCuts(
            duration: 8,
            nPhotos: 2,
            beatTimes: [2.0, 2.9],
            lyricSpans: [(1.0, 3.0)]
        )
        XCTAssertEqual(cuts.count, 1)
        XCTAssertEqual(cuts[0].time, 2.9, accuracy: 1.0 / 60)
    }

    func testMidPhraseOnlyCandidateIsNotAHardCut() {
        let cuts = planPhotoCuts(
            duration: 8,
            nPhotos: 2,
            beatTimes: [2.0],
            lyricSpans: [(1.0, 3.0)]
        )
        XCTAssertEqual(cuts.count, 1)
        XCTAssertEqual(cuts[0].time, 2.0, accuracy: 1.0 / 60)
        XCTAssertFalse(cuts[0].hard)
    }

    func testLocalDownbeatPicksThePeakInEachBar() {
        let times = (0..<8).map { Double($0) * 0.5 }
        let strength = [0.1, 0.2, 0.9, 0.2, 0.8, 0.1, 0.2, 0.1]
        XCTAssertEqual(localDownbeatTimes(beatTimes: times, strength: strength), [1.0, 2.0])
    }
}
