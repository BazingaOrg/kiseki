import CoreText
import UIKit
import XCTest
@testable import Kiseki

final class SignatureStrokeTests: XCTestCase {
    func testEmptyTextAtFullProgressReturnsTrue() {
        let context = CGContext(data: nil, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 32, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        XCTAssertTrue(SignatureStroke.draw("", in: CGRect(x: 0, y: 0, width: 8, height: 8), fontSize: 24, progress: 1, color: .black, context: context))
    }

    @MainActor
    func testOsakaStrokeInkGrowsWithProgress() throws {
        try registerMaShanZhengIfNeeded()
        let none = inkPixels(progress: 0)
        let half = inkPixels(progress: 0.5)
        let full = inkPixels(progress: 1)
        XCTAssertLessThan(none, full / 10)
        XCTAssertGreaterThan(full, 200)
        XCTAssertGreaterThan(half, none)
        XCTAssertLessThan(half, full)
    }

    @MainActor
    private func inkPixels(progress: CGFloat) -> Int {
        let size = CGSize(width: 400, height: 200)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        var drew = false
        let image = UIGraphicsImageRenderer(size: size, format: format).image { renderer in
            UIColor.white.setFill()
            renderer.fill(CGRect(origin: .zero, size: size))
            drew = SignatureStroke.draw("大阪", in: CGRect(origin: .zero, size: size), fontSize: 120, progress: progress, color: .black, context: renderer.cgContext)
        }
        XCTAssertTrue(drew)
        guard let cgImage = image.cgImage else { return 0 }
        let width = cgImage.width
        let height = cgImage.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        var count = 0
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            if pixels[offset] < 250 || pixels[offset + 1] < 250 || pixels[offset + 2] < 250 { count += 1 }
        }
        return count
    }

    @MainActor
    private func registerMaShanZhengIfNeeded() throws {
        if UIFont(name: "MaShanZheng-Regular", size: 24) != nil { return }
        guard let url = maShanZhengURL() else { throw XCTSkip("MaShanZheng-Regular.ttf not found from #filePath") }
        var error: Unmanaged<CFError>?
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
        if UIFont(name: "MaShanZheng-Regular", size: 24) == nil {
            throw XCTSkip("MaShanZheng-Regular could not be registered")
        }
    }

    private func maShanZhengURL() -> URL? {
        var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while true {
            let candidates = [
                directory.appendingPathComponent("Resources/MaShanZheng-Regular.ttf"),
                directory.appendingPathComponent("Kiseki/Resources/MaShanZheng-Regular.ttf"),
            ]
            if let url = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) { return url }
            let parent = directory.deletingLastPathComponent()
            if parent.path == directory.path { return nil }
            directory = parent
        }
    }
}
