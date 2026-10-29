import XCTest
import UIKit
import AVFoundation
@testable import Kiseki

final class CoreTests: XCTestCase {
    func testPlanKeepsExplicitOrderAndRefusesDroppedPhotos() throws {
        var project = DiaryProject()
        project.settings.intro = false
        project.settings.outro = ""
        project.photos = [DiaryPhoto(file: "media/b.jpg"), DiaryPhoto(file: "media/a.jpg")]
        let plan = try RenderPlan(project: project)
        XCTAssertEqual(plan.project.photos.map(\.file), ["media/b.jpg", "media/a.jpg"])
        XCTAssertEqual(plan.index(at: 4), 1)
        XCTAssertEqual(plan.fps, 60)
        XCTAssertEqual(plan.frames, 480)
        project.audio = DiaryAudio(file: "media/music.mp3", title: "short", duration: 0.4)
        XCTAssertThrowsError(try RenderPlan(project: project))
        XCTAssertNoThrow(try RenderPlan(project: project, still: true))
    }

    func testUnsafePathsAreRejected() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        for path in ["../escape", "/tmp/escape", "media/../../escape", "media\\escape"] {
            XCTAssertThrowsError(try ProjectRepository.safeFile(path, in: root))
        }
        XCTAssertEqual(try ProjectRepository.safeFile("media/a.jpg", in: root).lastPathComponent, "a.jpg")
    }

    func testPersistenceIgnoresStaleSavesAndRecoversInterruptedJob() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = ProjectRepository(root: root)
        var project = DiaryProject()
        project.revision = 2
        project.title = "new"
        try await repository.save(project)
        var stale = project
        stale.revision = 1
        stale.title = "old"
        try await repository.save(stale)
        try await repository.writeJob(ExportJob(projectID: project.id, revision: 2, temporaryFile: "partial.mp4"))
        let (loaded, messages) = try await repository.load()
        XCTAssertEqual(loaded.first?.title, "new")
        XCTAssertEqual(messages.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(project.id.uuidString + "/job.json").path))
    }

    func testPersistenceRecoversCompletedJobFromPartial() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = ProjectRepository(root: root)
        var project = DiaryProject()
        project.revision = 2
        try await repository.save(project)
        let directory = root.appendingPathComponent(project.id.uuidString, isDirectory: true)
        let final = directory.appendingPathComponent("outputs/recovered.mp4")
        let partial = directory.appendingPathComponent("outputs/recovered.partial.mp4")
        try FileManager.default.createDirectory(at: partial.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("recovered".utf8).write(to: partial)
        let output = OutputVersion(file: "outputs/recovered.mp4", title: "recovered", video: true, duration: 1, revision: 5)
        try await repository.writeJob(ExportJob(projectID: project.id, revision: 5, temporaryFile: "outputs/recovered.partial.mp4", completed: output))
        let (loaded, messages) = try await repository.load()
        XCTAssertEqual(messages, [])
        XCTAssertEqual(loaded.first?.outputs, [output])
        XCTAssertEqual(loaded.first?.revision, 6)
        XCTAssertEqual(try Data(contentsOf: final), Data("recovered".utf8))
        XCTAssertFalse(FileManager.default.fileExists(atPath: partial.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("job.json").path))
    }

    func testPersistenceRejectsConflictingSameRevisionSave() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = ProjectRepository(root: root)
        var project = DiaryProject()
        project.title = "first"
        project.revision = 2
        try await repository.save(project)
        var conflicting = project
        conflicting.title = "second"
        do {
            try await repository.save(conflicting)
            XCTFail("同 revision 的不同快照不应覆盖磁盘")
        } catch {}
        let manifest = root.appendingPathComponent(project.id.uuidString + "/manifest.json")
        let saved = try JSONDecoder().decode(DiaryProject.self, from: Data(contentsOf: manifest))
        XCTAssertEqual(saved, project)
    }

    func testBackupRoundTripAndTamperDetection() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        let media = base.appendingPathComponent("source/media")
        try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
        try Data("original".utf8).write(to: media.appendingPathComponent("sample.jpg"))
        var project = DiaryProject()
        project.photos = [DiaryPhoto(file: "media/sample.jpg", caption: "雨后的路")]
        let backup = try BackupService.create(project: project, directory: media.deletingLastPathComponent())
        defer { try? FileManager.default.removeItem(at: backup) }
        let root = base.appendingPathComponent("restored")
        let restored = try BackupService.restore(from: backup, root: root)
        XCTAssertNotEqual(restored.id, project.id)
        XCTAssertEqual(restored.photos, project.photos)
        try Data("tampered".utf8).write(to: backup.appendingPathComponent("media/sample.jpg"))
        XCTAssertThrowsError(try BackupService.restore(from: backup, root: root))
    }

    @MainActor
    func testSignatureFontsAreBundledAndRegistered() {
        XCTAssertNotNil(UIFont(name: "Sacramento-Regular", size: 24))
        XCTAssertNotNil(UIFont(name: "MaShanZheng-Regular", size: 24))
    }

    func testRecapReservesTimeWithoutReorderingBodyPhotos() throws {
        var project = DiaryProject()
        project.photos = (0..<8).map { DiaryPhoto(file: "media/\($0).jpg") }
        project.settings.recap = true
        let plan = try RenderPlan(project: project)
        XCTAssertGreaterThan(plan.recapDuration, 0)
        XCTAssertEqual(plan.segments.first?.start ?? -1, plan.introDuration + plan.recapDuration, accuracy: 0.001)
        XCTAssertEqual(plan.segments.map(\.index), Array(0..<8))
    }

    @MainActor
    func testNativePNGVideoAndAudioExport() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let image = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 300)).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 400, height: 300))
        }
        try image.jpegData(compressionQuality: 0.9)!.write(to: directory.appendingPathComponent("red.jpg"))
        var project = DiaryProject()
        project.settings.format = .landscape
        project.settings.photoSeconds = 1
        project.settings.intro = false
        project.settings.outro = ""
        project.photos = [DiaryPhoto(file: "red.jpg"), DiaryPhoto(file: "red.jpg")]
        let engine = ExportEngine()
        let png = directory.appendingPathComponent("sample.png")
        _ = try await engine.export(plan: RenderPlan(project: project, still: true), directory: directory, video: false, stillIndex: 0, temporary: png, progress: { _ in })
        let exported = UIImage(contentsOfFile: png.path)
        XCTAssertEqual(exported?.size, CGSize(width: 1920, height: 1080))
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 88200)!
        buffer.frameLength = 88200
        for frame in 0..<88200 { buffer.floatChannelData![0][frame] = Float(sin(Double(frame) * 440 * 2 * .pi / 44100) * 0.1) }
        let audioURL = directory.appendingPathComponent("tone.caf")
        let audio = try AVAudioFile(forWriting: audioURL, settings: format.settings)
        try audio.write(from: buffer)
        project.audio = DiaryAudio(file: "tone.caf", title: "tone", duration: 2)
        let output = directory.appendingPathComponent("sample.mp4")
        _ = try await engine.export(plan: RenderPlan(project: project), directory: directory, video: true, stillIndex: 0, temporary: output, progress: { _ in })
        let asset = AVURLAsset(url: output)
        let duration = try await asset.load(.duration).seconds
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(duration, 2, accuracy: 0.1)
        XCTAssertEqual(videoTracks.count, 1)
        XCTAssertEqual(audioTracks.count, 1)
        let generator = AVAssetImageGenerator(asset: asset)
        let frame = try generator.copyCGImage(at: CMTime(seconds: 1, preferredTimescale: 600), actualTime: nil)
        XCTAssertEqual(frame.width, 1920)
        XCTAssertEqual(frame.height, 1080)
        var bytes = [UInt8](repeating: 0, count: 4)
        bytes.withUnsafeMutableBytes { memory in
            let context = CGContext(data: memory.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(frame.cropping(to: CGRect(x: 960, y: 540, width: 1, height: 1))!, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        XCTAssertGreaterThan(bytes[0], 180)
        XCTAssertLessThan(bytes[1], 100)
        XCTAssertLessThan(bytes[2], 100)
    }

    func testFollowMusicCutsDifferFromEvenSplit() throws {
        var project = DiaryProject()
        project.photos = (0..<8).map { DiaryPhoto(file: "media/\($0).jpg") }
        project.audio = DiaryAudio(file: "media/song.m4a", title: "song", duration: 32)
        project.settings.intro = false
        project.settings.outro = ""
        project.settings.followMusic = true
        project.beatTimes = stride(from: 0.0, through: 32.0, by: 0.5).map { $0 }
        project.beatEnergy = project.beatTimes.map { time in abs(time.truncatingRemainder(dividingBy: 4) - 3) < 0.01 ? 1.0 : 0.05 }
        let plan = try RenderPlan(project: project)
        XCTAssertEqual(plan.segments.count, 8)
        XCTAssertEqual(plan.segments.map(\.index), Array(0..<8))
        XCTAssertEqual(plan.segments.first?.start ?? -1, plan.introDuration + plan.recapDuration, accuracy: 0.001)
        XCTAssertEqual(plan.segments.last?.end ?? -1, plan.duration - plan.outroDuration, accuracy: 0.001)
        var previous = plan.segments[0].start
        for segment in plan.segments {
            XCTAssertGreaterThanOrEqual(segment.start, previous)
            XCTAssertGreaterThan(segment.end, segment.start)
            previous = segment.end
        }
        let even = (1..<8).map { Double($0) * 4 }
        let cuts = plan.segments.dropFirst().map(\.start)
        XCTAssertTrue(zip(cuts, even).contains { abs($0 - $1) > 0.2 })
        project.settings.followMusic = false
        let ignored = try RenderPlan(project: project)
        XCTAssertEqual(ignored.segments.map(\.start), (0..<8).map { Double($0) * 4 })
        project.settings.followMusic = true
        project.beatTimes = []
        let missing = try RenderPlan(project: project)
        XCTAssertEqual(missing.segments.map(\.start), (0..<8).map { Double($0) * 4 })
    }

    func testLegacyManifestDefaultsFollowMusicAndEmptyBeats() throws {
        var settingsObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(DiarySettings())) as! [String: Any]
        settingsObject.removeValue(forKey: "followMusic")
        let settings = try JSONDecoder().decode(DiarySettings.self, from: JSONSerialization.data(withJSONObject: settingsObject))
        XCTAssertTrue(settings.followMusic)
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(DiaryProject())) as! [String: Any]
        object.removeValue(forKey: "beatTimes")
        object.removeValue(forKey: "beatEnergy")
        object.removeValue(forKey: "beatOnset")
        object.removeValue(forKey: "beatLowOnset")
        if var nested = object["settings"] as? [String: Any] {
            nested.removeValue(forKey: "followMusic")
            object["settings"] = nested
        }
        let decoded = try JSONDecoder().decode(DiaryProject.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertTrue(decoded.settings.followMusic)
        XCTAssertTrue(decoded.beatTimes.isEmpty)
        XCTAssertTrue(decoded.beatEnergy.isEmpty)
        XCTAssertTrue(decoded.beatOnset.isEmpty)
        XCTAssertTrue(decoded.beatLowOnset.isEmpty)
    }

    func testPhotoTransitionFadeAndLegacyDecoding() throws {
        XCTAssertEqual(PhotoTransition.album.resolvedFade(hold: 4), 0.25)
        XCTAssertEqual(PhotoTransition.crossfade.resolvedFade(hold: 4), 0.6)
        XCTAssertEqual(PhotoTransition.cut.resolvedFade(hold: 4), 0)
        XCTAssertEqual(PhotoTransition.album.resolvedFade(hold: 0.2), 0)
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(DiarySettings())) as! [String: Any]
        object.removeValue(forKey: "transition")
        let decoded = try JSONDecoder().decode(DiarySettings.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertEqual(decoded.transition, .album)
        var project = DiaryProject()
        project.photos = [DiaryPhoto(file: "media/a.jpg"), DiaryPhoto(file: "media/b.jpg")]
        project.settings.transition = .album
        XCTAssertEqual(try RenderPlan(project: project).segments.map(\.fade), [0.25, 0.25])
        project.settings.transition = .cut
        XCTAssertTrue(try RenderPlan(project: project).segments.allSatisfy { $0.fade == 0 })
        project.settings.transition = .crossfade
        XCTAssertEqual(try RenderPlan(project: project).segments.map(\.fade), [0.6, 0.6])
    }

    func testAlbumFadeKeepsPreviousPhotoUntilIncomingSettles() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        func write(_ rgb: (UInt8, UInt8, UInt8), name: String) throws {
            let width = 800
            let height = 450
            var bytes = [UInt8](repeating: 0, count: width * height * 4)
            for index in stride(from: 0, to: bytes.count, by: 4) {
                bytes[index] = rgb.0
                bytes[index + 1] = rgb.1
                bytes[index + 2] = rgb.2
                bytes[index + 3] = 255
            }
            let context = CGContext(data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            let image = UIImage(cgImage: context.makeImage()!)
            try image.jpegData(compressionQuality: 0.9)!.write(to: directory.appendingPathComponent(name))
        }
        try write((220, 20, 20), name: "red.jpg")
        try write((20, 20, 220), name: "blue.jpg")
        var project = DiaryProject()
        project.settings.format = .landscape
        project.settings.photoSeconds = 4
        project.settings.captions = false
        project.settings.intro = false
        project.settings.outro = ""
        project.settings.transition = .album
        project.photos = [DiaryPhoto(file: "red.jpg"), DiaryPhoto(file: "blue.jpg")]
        let plan = try RenderPlan(project: project)
        XCTAssertEqual(plan.segments[1].fade, 0.25, accuracy: 0.0001)
        let renderer = FrameRenderer(plan: plan, directory: directory, resolutionLimit: 400)
        let mixed = try renderer.image(at: plan.segments[1].start + 0.02, width: 360)
        let settled = try renderer.image(at: plan.segments[1].start + 0.4, width: 360)
        let output = CGSize(width: mixed.size.width, height: mixed.size.height)
        let box = FrameLayout(size: output, caption: false, exif: false, lyrics: false).photoBox
        let x = Int(box.midX)
        let y = Int(output.height - box.midY)
        let mixedPixel = sample(mixed, x: x, y: y)
        let settledPixel = sample(settled, x: x, y: y)
        XCTAssertGreaterThan(mixedPixel.0, mixedPixel.2, "point \(x),\(y) pixel \(mixedPixel)")
        XCTAssertGreaterThan(settledPixel.2, settledPixel.0)
        XCTAssertGreaterThan(settledPixel.2, mixedPixel.2)
        project.settings.transition = .cut
        let cutPlan = try RenderPlan(project: project)
        XCTAssertEqual(cutPlan.segments[1].fade, 0)
        let cut = try FrameRenderer(plan: cutPlan, directory: directory, resolutionLimit: 400).image(at: cutPlan.segments[1].start + 0.1, width: 360)
        let cutPixel = sample(cut, x: x, y: y)
        XCTAssertGreaterThan(cutPixel.2, cutPixel.0)
    }

    private func sample(_ image: UIImage, x: Int, y: Int) -> (UInt8, UInt8, UInt8) {
        var bytes = [UInt8](repeating: 0, count: 4)
        bytes.withUnsafeMutableBytes { memory in
            let context = CGContext(data: memory.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image.cgImage!.cropping(to: CGRect(x: x, y: y, width: 1, height: 1))!, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return (bytes[0], bytes[1], bytes[2])
    }
}
