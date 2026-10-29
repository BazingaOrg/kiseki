import XCTest
import CryptoKit
import UIKit
@testable import Kiseki

final class RegressionTests: XCTestCase {
    func testPhotoFirstDefaultsAndUniformRendering() throws {
        var project = DiaryProject()
        project.photos = (0..<8).map { DiaryPhoto(file: "media/\($0).jpg") }
        let settings = project.settings
        XCTAssertFalse(settings.dark)
        XCTAssertFalse(settings.exif)
        XCTAssertTrue(settings.captions)
        XCTAssertFalse(settings.intro)
        XCTAssertFalse(settings.recap)
        XCTAssertFalse(settings.chapters)
        XCTAssertFalse(settings.sign)
        XCTAssertTrue(settings.signature.isEmpty)
        XCTAssertTrue(settings.outro.isEmpty)
        XCTAssertEqual(settings.photoSeconds, 4)
        XCTAssertEqual(settings.transition, .album)
        let plan = try RenderPlan(project: project)
        XCTAssertEqual(plan.duration, 32)
        XCTAssertEqual(plan.introDuration + plan.recapDuration + plan.outroDuration, 0)
        XCTAssertTrue(plan.segments.allSatisfy { abs($0.end - $0.start - 4) < 0.001 })
        project.settings.template = .cinema
        project.settings.filter = .mono
        let restored = try JSONDecoder().decode(DiaryProject.self, from: JSONEncoder().encode(project))
        let restoredPlan = try RenderPlan(project: restored)
        XCTAssertEqual(restoredPlan.project.settings.template, .diary)
        XCTAssertEqual(restoredPlan.project.settings.filter, .original)
    }

    func testUntrustedNumbersCannotEnterProjects() throws {
        var project = DiaryProject()
        project.revision = Int.max
        XCTAssertThrowsError(try ProjectValidation.check(project))
        project.revision = -1
        XCTAssertThrowsError(try ProjectValidation.check(project))
        project.revision = 0
        project.audio = DiaryAudio(file: "media/music.mp3", title: "song", duration: 1e300)
        XCTAssertThrowsError(try ProjectValidation.check(project))
        project.audio = nil
        project.lyrics = [LyricLine(time: 1e300, text: "line")]
        XCTAssertThrowsError(try ProjectValidation.check(project))
        XCTAssertEqual(ProjectValidation.secondsText(1e300), "—")
        XCTAssertEqual(ProjectValidation.secondsText(.nan), "—")
    }

    func testOversizedServiceDurationsAreRejectedBeforeDisplay() throws {
        let json = """
        [{"id":1,"trackName":"bad","artistName":"artist","duration":1e300},
         {"id":2,"trackName":"valid","artistName":"artist","duration":120}]
        """
        let candidates = try LyricsService.decodeCandidates(Data(json.utf8))
        XCTAssertEqual(candidates.map(\.id), [2])
    }

    func testResignedBackupStillRejectsOverflowingRevision() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let package = try BackupService.create(project: DiaryProject(), directory: directory)
        defer { try? FileManager.default.removeItem(at: package) }
        let manifestURL = package.appendingPathComponent("manifest.json")
        var dictionary = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any])
        dictionary["revision"] = Int.max
        let malicious = try JSONSerialization.data(withJSONObject: dictionary)
        try malicious.write(to: manifestURL)
        let digest = SHA256.hash(data: malicious).map { String(format: "%02x", $0) }.joined()
        try JSONEncoder().encode(["manifest.json": digest]).write(to: package.appendingPathComponent("checksums.json"))
        XCTAssertThrowsError(try BackupService.restore(from: package, root: directory.appendingPathComponent("restored")))
    }

    func testStartupAndCleanupReclaimOnlyOwnedImportDirectories() async throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let root = base.appendingPathComponent("projects")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        let interrupted = root.appendingPathComponent(".import-" + UUID().uuidString)
        let unrelated = root.appendingPathComponent(".import-personal")
        let outside = base.appendingPathComponent("outside")
        for item in [interrupted, unrelated, outside] { try FileManager.default.createDirectory(at: item, withIntermediateDirectories: true) }
        try Data(repeating: 1, count: 128).write(to: interrupted.appendingPathComponent("partial"))
        let link = root.appendingPathComponent(".import-" + UUID().uuidString)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside)
        let repository = ProjectRepository(root: root)
        _ = try await repository.load()
        XCTAssertFalse(FileManager.default.fileExists(atPath: interrupted.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: outside.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: link.path))
        let second = root.appendingPathComponent(".import-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: second, withIntermediateDirectories: true)
        _ = try await repository.cleanUnused([])
        XCTAssertFalse(FileManager.default.fileExists(atPath: second.path))
    }

    func testTextLanesDoNotOverlapEachOtherOrPhotoRegion() {
        for format in CanvasFormat.allCases {
            for exif in [false, true] {
                let bounds = CGRect(origin: .zero, size: format.size)
                let layout = FrameLayout(size: format.size, caption: true, exif: exif, lyrics: true)
                let lanes = [layout.captionBox, layout.exifBox, layout.lyricsBox].compactMap { $0 }
                for lane in lanes {
                    XCTAssertTrue(bounds.contains(lane))
                    XCTAssertLessThanOrEqual(layout.photoBox.maxY, lane.minY)
                    XCTAssertLessThanOrEqual(layout.contentClip.maxY, lane.minY)
                }
                for i in lanes.indices {
                    for j in lanes.indices where j > i {
                        let overlap = lanes[i].intersection(lanes[j])
                        XCTAssertTrue(overlap.isNull || overlap.width == 0 || overlap.height == 0)
                    }
                }
            }
        }
    }

    @MainActor
    func testOptionalKeychainFailureDoesNotBecomeGlobalLaunchError() {
        let model = AppModel()
        model.refreshKeyStatus { throw DiaryError.message("Keychain unavailable") }
        XCTAssertFalse(model.configuredKey)
        XCTAssertNil(model.notice)
        XCTAssertTrue(model.captionStatus.contains("Keychain unavailable"))
        model.refreshKeyStatus { nil }
        XCTAssertEqual(model.captionStatus, "未配置")
    }

    @MainActor
    func testIncomingBackupWaitsForInitialLoad() {
        let model = AppModel()
        let url = URL(fileURLWithPath: "/tmp/sample.kisekiproject")
        model.receiveBackup(url)
        XCTAssertEqual(model.pendingBackupURL, url)
        XCTAssertTrue(model.loading)
        XCTAssertTrue(model.projects.isEmpty)
        model.receiveBackup(URL(string: "https://example.com/sample.kisekiproject")!)
        XCTAssertEqual(model.pendingBackupURL, url)
        XCTAssertNotNil(model.notice)
    }

    @MainActor
    func testCaptionLyricsExifRenderTogetherAcrossTemplatesAndFormats() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let image = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 200)).image { context in
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 300, height: 200))
        }
        try image.jpegData(compressionQuality: 0.9)!.write(to: directory.appendingPathComponent("sample.jpg"))
        var project = DiaryProject()
        project.photos = [DiaryPhoto(file: "sample.jpg", date: Date(), camera: "Camera", caption: "雨后，路面有了另一层颜色。")]
        project.lyrics = [LyricLine(time: 0, text: "Sample original lyric", translation: "测试译文")]
        project.settings.exif = true
        project.settings.intro = false
        project.settings.chapters = false
        project.settings.outro = ""
        for format in CanvasFormat.allCases {
            project.settings.format = format
            for template in DiaryTemplate.allCases {
                project.settings.template = template
                let renderer = FrameRenderer(plan: try RenderPlan(project: project), directory: directory, resolutionLimit: 500)
                let rendered = try renderer.image(at: 1, width: 360)
                XCTAssertEqual(rendered.size.width, 360)
                XCTAssertGreaterThan(rendered.size.height, 0)
            }
        }
    }
}
