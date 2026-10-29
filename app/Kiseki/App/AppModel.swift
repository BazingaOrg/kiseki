import SwiftUI
import PhotosUI
import AVFoundation
import ImageIO
import UniformTypeIdentifiers
import CoreTransferable

struct TransferredPhoto: Transferable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            guard let size = try received.file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 100_000_000 else { throw DiaryError.message("这张照片过大，请选择 100 MB 以内的文件。") }
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: destination)
            return TransferredPhoto(url: destination)
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var loading = true
    @Published var projects: [DiaryProject] = []
    @Published var notice: String?
    @Published var statusMessage: String?
    @Published var backupStatus: String?
    @Published var importProgress: String?
    @Published var importing = false
    @Published var rendering = false
    @Published var exportIndeterminate = false
    @Published var renderingProject: UUID?
    @Published var completedProject: UUID?
    var pendingBackupURL: URL?
    @Published var progress = 0.0
    @Published var exportMessage = ""
    @Published var configuredKey = false
    @Published var captionStatus = "尚未调用"
    @Published var lyricsStatus = "尚未查询"
    @Published var captionProject: UUID?
    var captionTask: Task<Void, Never>?
    let repository = ProjectRepository()
    let engine = ExportEngine()
    private var activeExportToken: String?
    private var exportTask: Task<Void, Never>?
    private var importTask: Task<Void, Never>?
    private var beatTask: Task<Void, Never>?

    var root: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("projects", isDirectory: true) }
    func directory(_ id: UUID) -> URL { root.appendingPathComponent(id.uuidString, isDirectory: true) }
    func project(_ id: UUID) -> DiaryProject? { projects.first { $0.id == id } }
    func file(_ relative: String, project: UUID) -> URL? { try? ProjectRepository.safeFile(relative, in: directory(project)) }
    func locked(_ id: UUID) -> Bool { loading || rendering || importing || backupStatus != nil || captionProject != nil }

    func load() async {
        defer { loading = false }
        do {
            let (loaded, failures) = try await repository.load()
            projects = loaded
            if !failures.isEmpty { notice = failures.joined(separator: "\n") }
            refreshKeyStatus()
        } catch { notice = error.localizedDescription }
    }

    func refreshKeyStatus(using read: () throws -> String? = Secrets.read) {
        do {
            configuredKey = try read() != nil
            captionStatus = configuredKey ? "已配置，尚未验证" : "未配置"
        } catch {
            configuredKey = false
            captionStatus = "旁白密钥暂不可用：" + error.localizedDescription
        }
    }

    func create() async -> UUID? {
        guard !loading, !rendering, !importing, captionProject == nil else { notice = "请等当前任务结束后再新建日记。"; return nil }
        let project = DiaryProject()
        do { try await repository.save(project); projects.insert(project, at: 0); return project.id }
        catch { notice = error.localizedDescription; return nil }
    }

    func update(_ project: DiaryProject) {
        guard !locked(project.id), let index = projects.firstIndex(where: { $0.id == project.id }) else { return }
        guard projects[index].revision < ProjectValidation.maximumRevision - 1 else { notice = "此作品的版本计数已达上限，请导出并恢复备份后继续。"; return }
        var next = project
        next.revision = projects[index].revision + 1
        next.modified = Date()
        do { try ProjectValidation.check(next) } catch { notice = error.localizedDescription; return }
        projects[index] = next
        Task { do { try await repository.save(next) } catch { notice = "草稿保存失败：\(error.localizedDescription)" } }
    }

    func removeProject(_ id: UUID) async {
        guard !locked(id) else { return }
        do { try await repository.delete(id); projects.removeAll { $0.id == id } } catch { notice = error.localizedDescription }
    }

    func importPhotos(_ items: [PhotosPickerItem], into id: UUID) {
        guard !locked(id), !items.isEmpty else { return }
        importing = true
        importTask = Task {
            var failures = 0
            var reasons = Set<String>()
            for (index, item) in items.enumerated() {
                do {
                    try Task.checkCancellation()
                    importProgress = "正在准备照片 \(index + 1) / \(items.count)"
                    guard let received = try await item.loadTransferable(type: TransferredPhoto.self) else { throw DiaryError.message("不支持这张照片。") }
                    defer { try? FileManager.default.removeItem(at: received.url) }
                    try Task.checkCancellation()
                    guard var current = project(id), current.photos.count < 500 else { throw DiaryError.message("每篇日记目前最多 500 张照片。") }
                    let fingerprint = try await Task.detached(priority: .utility) { try FileDigest.sha256(received.url) }.value
                    if current.photos.contains(where: { $0.fingerprint == fingerprint }) { continue }
                    let media = directory(id).appendingPathComponent("media", isDirectory: true)
                    try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
                    guard let source = CGImageSourceCreateWithURL(received.url as CFURL, nil), CGImageSourceGetCount(source) > 0 else { throw DiaryError.message("图片无法读取。") }
                    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
                    let tiff = properties[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
                    let exif = properties[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
                    let formatter = DateFormatter()
                    formatter.locale = Locale(identifier: "en_US_POSIX")
                    formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
                    let date = (exif[kCGImagePropertyExifDateTimeOriginal] as? String).flatMap { formatter.date(from: $0) }
                    try FileDigest.checkCapacity(at: media, incoming: Int64(try received.url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0))
                    let filename = UUID().uuidString + "." + (received.url.pathExtension.isEmpty ? "image" : received.url.pathExtension)
                    try FileManager.default.copyItem(at: received.url, to: media.appendingPathComponent(filename))
                    current.photos.append(DiaryPhoto(file: "media/" + filename, sourceIdentifier: item.itemIdentifier, fingerprint: fingerprint, date: date, camera: tiff[kCGImagePropertyTIFFModel] as? String ?? ""))
                    current.revision += 1
                    current.modified = Date()
                    try await repository.save(current)
                    if let i = projects.firstIndex(where: { $0.id == id }) { projects[i] = current }
                } catch is CancellationError { break }
                catch { failures += 1; reasons.insert(error.localizedDescription) }
            }
            importing = false
            importProgress = nil
            if failures > 0 { notice = "有 \(failures) 张照片未能导入，已成功的照片已保留。\n" + reasons.sorted().prefix(3).joined(separator: "\n") }
        }
    }

    func cancelImport() { importTask?.cancel(); beatTask?.cancel() }

    func importAudio(_ url: URL, into id: UUID) {
        guard !locked(id), var current = project(id) else { return }
        importing = true
        importProgress = "正在导入音乐"
        importTask = Task {
            defer {
                importing = false
                importProgress = nil
            }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            do {
                try Task.checkCancellation()
                let source = AVURLAsset(url: url)
                let duration = try await source.load(.duration).seconds
                let tracks = try await source.loadTracks(withMediaType: .audio)
                try Task.checkCancellation()
                guard duration.isFinite, duration > 0, duration <= 1800, !tracks.isEmpty else { throw DiaryError.message("请选择 30 分钟以内、有可用音轨的音频。") }
                let media = directory(id).appendingPathComponent("media", isDirectory: true)
                try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
                let bytes = Int64(try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
                guard bytes <= 500_000_000 else { throw DiaryError.message("请选择 500 MB 以内的音频。") }
                try FileDigest.checkCapacity(at: media, incoming: bytes)
                let filename = UUID().uuidString + "." + url.pathExtension
                let copied = media.appendingPathComponent(filename)
                do {
                    try FileManager.default.copyItem(at: url, to: copied)
                    try Task.checkCancellation()
                } catch {
                    try? FileManager.default.removeItem(at: copied)
                    throw error
                }
                current.audio = DiaryAudio(file: "media/" + filename, title: url.deletingPathExtension().lastPathComponent, duration: duration)
                current.lyrics = []
                current.beatTimes = []
                current.beatEnergy = []
                current.beatOnset = []
                current.beatLowOnset = []
                current.revision += 1
                current.modified = Date()
                try Task.checkCancellation()
                try await repository.save(current)
                if let i = projects.firstIndex(where: { $0.id == id }) { projects[i] = current }
                let file = current.audio!.file
                beatTask?.cancel()
                guard !Task.isCancelled else { return }
                beatTask = Task { await self.applyBeats(from: copied, file: file, into: id) }
            } catch is CancellationError { }
            catch { if !Task.isCancelled { notice = error.localizedDescription } }
        }
    }

    private func applyBeats(from url: URL, file: String, into id: UUID) async {
        let features = await Task.detached(priority: .utility) { BeatAnalysis.analyze(url) }.value
        guard !Task.isCancelled, var current = project(id), current.audio?.file == file else { return }
        guard current.revision < ProjectValidation.maximumRevision - 1 else { return }
        current.beatTimes = features.times
        current.beatEnergy = features.energy
        current.beatOnset = features.onset
        current.beatLowOnset = features.lowOnset
        current.revision += 1
        current.modified = Date()
        do {
            try ProjectValidation.check(current)
            guard !Task.isCancelled, project(id)?.audio?.file == file else { return }
            try await repository.save(current)
            guard !Task.isCancelled, var latest = project(id), latest.audio?.file == file else { return }
            latest.beatTimes = features.times
            latest.beatEnergy = features.energy
            latest.beatOnset = features.onset
            latest.beatLowOnset = features.lowOnset
            if let i = projects.firstIndex(where: { $0.id == id }) { projects[i] = latest }
        } catch { }
    }

    func importLyrics(_ url: URL, into id: UUID) {
        guard !locked(id), var current = project(id) else { return }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        do {
            guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 2_000_000 else { throw DiaryError.message("歌词文件过大。") }
            let data = try Data(contentsOf: url)
            guard data.count <= 2_000_000, let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16) else { throw DiaryError.message("歌词需为 UTF-8 或 UTF-16 的 LRC 文件。") }
            let lines = LyricsParser.parse(text)
            guard lines.count <= 10000 else { throw DiaryError.message("歌词行数过多。") }
            guard !lines.isEmpty else { throw DiaryError.message("没有找到带时间的歌词。") }
            current.lyrics = lines
            update(current)
        } catch { notice = error.localizedDescription }
    }

    func export(_ id: UUID, video: Bool, stillIndex: Int = 0, plan: RenderPlan? = nil) {
        guard !rendering, !importing, backupStatus == nil, let snapshot = project(id) else { return }
        let resolvedPlan: RenderPlan
        do { resolvedPlan = try plan ?? RenderPlan(project: snapshot, still: !video) }
        catch { notice = error.localizedDescription; return }
        let issues = ExportReadiness.check(snapshot, directory: directory(id), video: video, plan: resolvedPlan)
        guard !issues.contains(where: \.blocking) else { notice = issues.filter(\.blocking).map(\.message).joined(separator: "\n"); return }
        rendering = true
        renderingProject = id
        completedProject = nil
        progress = 0
        exportIndeterminate = false
        exportMessage = "正在准备画面"
        UIApplication.shared.isIdleTimerDisabled = true
        let token = UUID().uuidString
        activeExportToken = token
        exportTask = Task {
            let ext = video ? "mp4" : "png"
            let relative = "outputs/\(token).\(ext)"
            let partial = "outputs/\(token).partial.\(ext)"
            defer { if let url = file(partial, project: id) { try? FileManager.default.removeItem(at: url) } }
            do {
                let directory = directory(id)
                try FileManager.default.createDirectory(at: directory.appendingPathComponent("outputs"), withIntermediateDirectories: true)
                let temporary = try ProjectRepository.safeFile(partial, in: directory)
                let final = try ProjectRepository.safeFile(relative, in: directory)
                try await repository.writeJob(ExportJob(projectID: id, revision: snapshot.revision, temporaryFile: partial))
                _ = try await engine.export(plan: resolvedPlan, directory: directory, video: video, stillIndex: min(stillIndex, max(0, snapshot.photos.count - 1)), temporary: temporary, audioComposition: {
                    Task { @MainActor in
                        guard self.activeExportToken == token, self.rendering else { return }
                        self.exportIndeterminate = true
                        self.exportMessage = "正在合成音视频"
                    }
                }) { value in
                    Task { @MainActor in guard self.activeExportToken == token, self.rendering else { return }; self.progress = value; self.exportMessage = value < 0.85 ? "正在绘制画面" : "正在保存作品" }
                }
                try Task.checkCancellation()
                let output = OutputVersion(file: relative, title: snapshot.title + (video ? " · 影像" : " · 静态图"), video: video, duration: video ? resolvedPlan.duration : 0, revision: snapshot.revision)
                try await repository.writeJob(ExportJob(projectID: id, revision: snapshot.revision, temporaryFile: partial, completed: output))
                try FileManager.default.moveItem(at: temporary, to: final)
                var completed = snapshot
                completed.outputs.append(output)
                completed.revision += 1
                completed.modified = Date()
                try await repository.save(completed)
                try await repository.finishJob(id)
                if let index = projects.firstIndex(where: { $0.id == id }) { projects[index] = completed }
                exportMessage = "这一刻，留下了。"
                completedProject = id
                if ProcessInfo.processInfo.arguments.contains("--smoke-export") || ProcessInfo.processInfo.arguments.contains("--benchmark-export") {
                    let report: [String: Any] = ["file": final.path, "frames": resolvedPlan.frames, "duration": resolvedPlan.duration, "success": true]
                    try JSONSerialization.data(withJSONObject: report).write(to: root.deletingLastPathComponent().appendingPathComponent("smoke-result.json"), options: .atomic)
                }
            } catch {
                exportMessage = Task.isCancelled ? "已取消，草稿还在。" : error.localizedDescription
                if Task.isCancelled {
                    statusMessage = exportMessage
                    try? await repository.finishJob(id)
                } else { notice = exportMessage }
            }
            activeExportToken = nil
            rendering = false
            renderingProject = nil
            exportIndeterminate = false
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    func cancelExport() { exportTask?.cancel() }

    func saveToPhotos(_ url: URL, video: Bool) async {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { notice = "未获得保存权限。作品仍在 App 内，可以通过分享保存到文件。"; return }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                if video { PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url) }
                else { PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: url) }
            }
            statusMessage = "已保存到照片。"
        } catch { notice = error.localizedDescription }
    }

    func makeSample(benchmark: Bool = false) async -> UUID? {
        guard let id = await create(), var sample = project(id) else { return nil }
        sample.title = "海风与日光 · 示例"
        sample.settings.format = .landscape
        sample.settings.intro = false
        sample.settings.outro = ""
        sample.settings.photoSeconds = benchmark ? 3 : 1
        let media = directory(id).appendingPathComponent("media")
        do {
            try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
            for i in 0..<(benchmark ? 30 : 3) {
                let image = UIGraphicsImageRenderer(size: CGSize(width: 1200, height: 900)).image { context in
                    UIColor(hue: CGFloat(i % 8) / 8, saturation: 0.2, brightness: 0.75, alpha: 1).setFill()
                    context.fill(CGRect(x: 0, y: 0, width: 1200, height: 900))
                    ("\(i + 1) · kiseki" as NSString).draw(at: CGPoint(x: 100, y: 400), withAttributes: [.font: UIFont.systemFont(ofSize: 80), .foregroundColor: UIColor.white])
                }
                let file = "media/\(i).jpg"
                try image.jpegData(compressionQuality: 0.9)!.write(to: directory(id).appendingPathComponent(file))
                sample.photos.append(DiaryPhoto(file: file, date: Date()))
            }
            try await repository.save(sample)
            if let i = projects.firstIndex(where: { $0.id == id }) { projects[i] = sample }
            return id
        } catch { notice = error.localizedDescription; return nil }
    }
}
