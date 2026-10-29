import Foundation
import AVFoundation
import UIKit
import ImageIO

struct ReadinessIssue: Identifiable {
    let id: String
    let message: String
    let blocking: Bool
}

enum ExportReadiness {
    static func check(_ project: DiaryProject, directory: URL, video: Bool, plan: RenderPlan? = nil) -> [ReadinessIssue] {
        var issues: [ReadinessIssue] = []
        var resolvedPlan = plan
        do { if resolvedPlan == nil { resolvedPlan = try RenderPlan(project: project, still: !video) } } catch { issues.append(.init(id: "plan", message: error.localizedDescription, blocking: true)) }
        if project.photos.contains(where: { photo in
            guard let url = try? ProjectRepository.safeFile(photo.file, in: directory) else { return true }
            return !FileManager.default.fileExists(atPath: url.path)
        }) { issues.append(.init(id: "photos", message: "有照片文件缺失，请重新添加。", blocking: true)) }
        if let audio = project.audio, video {
            if let url = try? ProjectRepository.safeFile(audio.file, in: directory), !FileManager.default.fileExists(atPath: url.path) { issues.append(.init(id: "audio", message: "音乐文件缺失，请重新导入。", blocking: true)) }
        }
        if video {
            do {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
                let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
                let size = project.settings.format.size
                if !writer.canApply(outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height)], forMediaType: .video) { issues.append(.init(id: "encoder", message: "当前输出规格不可用，请更换画幅。", blocking: true)) }
            } catch { issues.append(.init(id: "encoder", message: "无法创建视频编码器，请稍后重试。", blocking: true)) }
        }
        let duration = resolvedPlan?.duration ?? 0
        let estimated = video ? Int64(duration * 2_000_000 * (project.audio == nil ? 1 : 2) + 100_000_000) : 50_000_000
        if let values = try? directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]), let available = values.volumeAvailableCapacityForImportantUsage {
            if available < estimated { issues.append(.init(id: "space", message: "空间不足，本次制作预计需要约 \(ByteCountFormatter.string(fromByteCount: estimated, countStyle: .file))。", blocking: true)) }
        } else { issues.append(.init(id: "space", message: "暂时无法检查可用空间，请重新打开作品后再试。", blocking: true)) }
        if ProcessInfo.processInfo.thermalState == .critical { issues.append(.init(id: "thermal", message: "设备很热，请稍后再制作。", blocking: true)) }
        else if ProcessInfo.processInfo.thermalState == .serious { issues.append(.init(id: "thermal", message: "设备较热，制作可能变慢。", blocking: false)) }
        return issues
    }
}

actor ExportEngine {
    func export(plan: RenderPlan, directory: URL, video: Bool, stillIndex: Int, temporary: URL, audioComposition: @escaping @Sendable () -> Void = {}, progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        let renderer = FrameRenderer(plan: plan, directory: directory)
        let working = temporary.deletingPathExtension().appendingPathExtension("silent.mp4")
        defer { try? FileManager.default.removeItem(at: working) }
        do {
            if !video {
                let image = try renderer.image(at: 0, width: plan.project.settings.format.size.width, stillIndex: stillIndex)
                guard let data = image.pngData() else { throw DiaryError.message("静态图未能生成。") }
                try Task.checkCancellation()
                try data.write(to: temporary, options: .atomic)
                progress(1)
                return temporary
            }
            let target = plan.project.audio == nil ? temporary : working
            try await renderVideo(plan: plan, renderer: renderer, target: target, progress: progress)
            if let audio = plan.project.audio {
                try Task.checkCancellation()
                audioComposition()
                let composition = AVMutableComposition()
                let silent = AVURLAsset(url: working)
                guard let videoSource = try await silent.loadTracks(withMediaType: .video).first,
                      let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw DiaryError.message("无法读取已绘制的画面。") }
                let duration = CMTime(value: Int64(plan.frames), timescale: Int32(plan.fps))
                try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: videoSource, at: .zero)
                let source = AVURLAsset(url: try ProjectRepository.safeFile(audio.file, in: directory))
                guard let audioSource = try await source.loadTracks(withMediaType: .audio).first,
                      let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw DiaryError.message("这份文件没有可用的音频轨道。") }
                let audioDuration = try await source.load(.duration)
                try audioTrack.insertTimeRange(CMTimeRange(start: .zero, duration: CMTimeMinimum(audioDuration, duration)), of: audioSource, at: .zero)
                guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw DiaryError.message("无法创建音视频合成任务。") }
                exporter.outputURL = temporary
                exporter.outputFileType = .mp4
                await withTaskCancellationHandler {
                    await exporter.export()
                } onCancel: { exporter.cancelExport() }
                try Task.checkCancellation()
                guard exporter.status == .completed else { throw exporter.error ?? DiaryError.message("音视频合成未完成。") }
            }
            progress(1)
            return temporary
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
    }

    private func renderVideo(plan: RenderPlan, renderer: FrameRenderer, target: URL, progress: @escaping @Sendable (Double) -> Void) async throws {
        let size = plan.project.settings.format.size
        let writer = try AVAssetWriter(outputURL: target, fileType: .mp4)
        let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height), AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 12_000_000, AVVideoExpectedSourceFrameRateKey: plan.fps]]
        guard writer.canApply(outputSettings: settings, forMediaType: .video) else { throw DiaryError.message("设备不支持当前视频规格。") }
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: Int(size.width), kCVPixelBufferHeightKey as String: Int(size.height), kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true])
        guard writer.canAdd(input) else { throw DiaryError.message("无法创建视频编码轨道。") }
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? DiaryError.message("视频编码未能启动。") }
        writer.startSession(atSourceTime: .zero)
        do {
            for frame in 0..<plan.frames {
                try Task.checkCancellation()
                while !input.isReadyForMoreMediaData {
                    guard writer.status == .writing else { throw writer.error ?? DiaryError.message("视频编码已停止。") }
                    try Task.checkCancellation()
                    try await Task.sleep(nanoseconds: 2_000_000)
                }
                try autoreleasepool {
                    var buffer: CVPixelBuffer?
                    guard let pool = adaptor.pixelBufferPool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else { throw DiaryError.message("无法分配画面缓冲，请关闭其他应用后重试。") }
                    CVPixelBufferLockBaseAddress(buffer, [])
                    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
                    guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue) else { throw DiaryError.message("无法建立画布。") }
                    context.translateBy(x: 0, y: size.height)
                    context.scaleBy(x: 1, y: -1)
                    UIGraphicsPushContext(context)
                    defer { UIGraphicsPopContext() }
                    try renderer.draw(at: Double(frame) / Double(plan.fps), size: size)
                    guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: Int32(plan.fps))) else { throw writer.error ?? DiaryError.message("画面写入失败。") }
                }
                if frame % 10 == 0 { progress(Double(frame + 1) / Double(plan.frames) * (plan.project.audio == nil ? 1 : 0.85)) }
            }
            input.markAsFinished()
            writer.endSession(atSourceTime: CMTime(value: Int64(plan.frames), timescale: Int32(plan.fps)))
            await writer.finishWriting()
            guard writer.status == .completed else { throw writer.error ?? DiaryError.message("视频没有完整保存。") }
        } catch { writer.cancelWriting(); throw error }
    }
}
