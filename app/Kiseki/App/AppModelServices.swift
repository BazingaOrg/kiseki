import Foundation

extension AppModel {
    func receiveBackup(_ url: URL) {
        guard url.isFileURL, url.pathExtension == "kisekiproject" else { notice = "这个文件不是 Kiseki 草稿备份。"; return }
        if loading { pendingBackupURL = url }
        else { Task { await restoreBackup(url) } }
    }

    func saveKey(_ value: String) throws {
        try Secrets.save(value)
        cancelCaptions()
        configuredKey = true
        captionStatus = "Key 已更新，尚未验证"
    }

    func removeKey() throws {
        try Secrets.remove()
        cancelCaptions()
        configuredKey = false
        captionStatus = "未配置"
    }

    func generateCaptions(_ id: UUID, photoID: UUID?, hint: String = "") {
        guard !locked(id), captionProject == nil, let snapshot = project(id) else { return }
        guard configuredKey else { notice = "请先在设置中配置 DeepSeek API Key。手写和已有旁白不需要 Key。"; return }
        captionProject = id
        captionTask = Task {
            defer { captionProject = nil }
            do {
                guard let key = try Secrets.read() else { throw DiaryError.message("请先配置图片旁白服务。") }
                let targets = snapshot.photos.filter { photoID == nil ? $0.caption.isEmpty : $0.id == photoID }
                for photo in targets {
                    try Task.checkCancellation()
                    let url = try ProjectRepository.safeFile(photo.file, in: directory(id))
                    let text = try await CaptionService.generate(file: url, hint: photoID == nil ? photo.hint : hint, key: key)
                    try Task.checkCancellation()
                    guard var current = project(id), let index = current.photos.firstIndex(where: { $0.id == photo.id }), current.photos[index].file == photo.file else { throw DiaryError.message("照片已变化，请重新生成旁白。") }
                    captionStatus = "最近调用成功"
                    current.photos[index].caption = text
                    current.photos[index].edited = false
                    current.photos[index].hint = photoID == nil ? photo.hint : String(hint.prefix(40))
                    current.revision += 1
                    current.modified = Date()
                    try await repository.save(current)
                    if let at = projects.firstIndex(where: { $0.id == id }) { projects[at] = current }
                }
            } catch is CancellationError { statusMessage = "旁白生成已取消，已完成的文字已保存。" }
            catch { captionStatus = error.localizedDescription; notice = error.localizedDescription }
        }
    }

    func cancelCaptions() { captionTask?.cancel() }

    func backup(_ id: UUID) async -> URL? {
        guard backupStatus == nil, !locked(id), let snapshot = project(id) else { return nil }
        backupStatus = "正在导出草稿备份"
        defer { backupStatus = nil }
        let sourceDirectory = directory(id)
        do { return try await Task.detached(priority: .utility) { try BackupService.create(project: snapshot, directory: sourceDirectory) }.value }
        catch { notice = error.localizedDescription; return nil }
    }

    func restoreBackup(_ url: URL) async {
        guard backupStatus == nil, !loading, !importing, !rendering, captionProject == nil else { notice = "请等当前任务结束后再恢复备份。"; return }
        backupStatus = "正在恢复备份"
        defer { backupStatus = nil }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        do {
            let root = root
            let project = try await Task.detached(priority: .utility) { try BackupService.restore(from: url, root: root) }.value
            try await repository.save(project)
            projects.insert(project, at: 0)
            statusMessage = "草稿已恢复。"
        } catch { notice = error.localizedDescription }
    }

    func deleteOutput(_ output: OutputVersion, from id: UUID) {
        guard !locked(id), var next = project(id) else { return }
        importing = true
        next.outputs.removeAll { $0.id == output.id }
        next.revision += 1
        Task {
            defer { importing = false }
            do {
                try await repository.save(next)
                if let index = projects.firstIndex(where: { $0.id == id }) { projects[index] = next }
                if let url = file(output.file, project: id), FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
            } catch { notice = error.localizedDescription }
        }
    }

    func cleanUnused() async {
        guard backupStatus == nil, !loading, !importing, !rendering, captionProject == nil else { notice = "请等当前任务结束后再清理。"; return }
        importing = true
        defer { importing = false }
        do {
            let freed = try await repository.cleanUnused(projects)
            statusMessage = "已清理 \(ByteCountFormatter.string(fromByteCount: freed, countStyle: .file))。作品和正在使用的素材仍保留。"
        } catch { notice = error.localizedDescription }
    }
}
