import XCTest
import UIKit
@testable import Kiseki

final class FilmGradeTests: XCTestCase {
    func testOriginalAndZeroStrengthLeavePixelsUnchanged() {
        let red = solidRed()
        XCTAssertTrue(FilmGrade.apply(red, roll: "original", strength: 1) === red)
        XCTAssertTrue(FilmGrade.apply(red, roll: "classic-chrome", strength: 0) === red)
        XCTAssertEqual(sample(red).r, sample(FilmGrade.apply(red, roll: "original", strength: 0.6)).r)
    }

    func testClassicChromeChangesPureRed() {
        let red = solidRed()
        let graded = FilmGrade.apply(red, roll: "classic-chrome", strength: 1)
        XCTAssertNotEqual(sample(red).r, sample(graded).r)
    }

    func testUnknownRollLeavesPixelsUnchanged() {
        let red = solidRed()
        XCTAssertTrue(FilmGrade.apply(red, roll: "not-a-roll", strength: 1) === red)
        XCTAssertEqual(sample(red).r, sample(FilmGrade.apply(red, roll: "acros", strength: 1)).r)
    }

    func testLegacyDiarySettingsDecodeFilmRollAsOriginal() throws {
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(DiarySettings())) as! [String: Any]
        object.removeValue(forKey: "filmRoll")
        object.removeValue(forKey: "filmStrength")
        let decoded = try JSONDecoder().decode(DiarySettings.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertEqual(decoded.filmRoll, "original")
        XCTAssertEqual(decoded.filmStrength, 0.6)
    }

    private func solidRed() -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40), format: format).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
        }
    }

    private func sample(_ image: UIImage) -> (r: UInt8, g: UInt8, b: UInt8) {
        var bytes = [UInt8](repeating: 0, count: 4)
        bytes.withUnsafeMutableBytes { memory in
            let context = CGContext(
                data: memory.baseAddress,
                width: 1,
                height: 1,
                bitsPerComponent: 8,
                bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )!
            let cg = image.cgImage!
            context.draw(cg.cropping(to: CGRect(x: cg.width / 2, y: cg.height / 2, width: 1, height: 1))!, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return (bytes[0], bytes[1], bytes[2])
    }
}
