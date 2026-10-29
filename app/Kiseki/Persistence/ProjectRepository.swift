import Foundation

actor ProjectRepository {
    let root: URL
    private let encoder: JSONEncoder
    private let decoder = JSONDecoder()
    private var removed = Set<UUID>()

    init(root: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("projects", isDirectory: true)) {
        self.root = root
        encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    func directory(_ id: UUID) -> URL { root.appendingPathComponent(id.uuidString, isDirectory: true) }

    static func safeFile(_ file: String, in directory: URL) throws -> URL {
        guard !file.isEmpty, !file.hasPrefix("/"), !file.split(separator: "/").contains(".."), !file.contains("\\") else { throw DiaryError.message("作品中的文件路径无效。") }
        let result = directory.appendingPathComponent(file).standardizedFileURL
        guard result.path.hasPrefix(directory.standardizedFileURL.path + "/") else { throw DiaryError.message("无法读取作品文件。") }
        let resolved = result.resolvingSymlinksInPath()
        guard resolved.path.hasPrefix(directory.resolvingSymlinksInPath().path + "/") else { throw DiaryError.message("作品不支持外部文件链接。") }
        return result
    }

    func load() throws -> ([DiaryProject], [String]) {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        _ = try reclaimInterruptedImports()
        var projects: [DiaryProject] = []
        var failures: [String] = []
        for directory in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
            guard UUID(uuidString: directory.lastPathComponent) != nil else { continue }
            do {
                guard try directory.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw DiaryError.message("不支持作品目录链接。") }
                var project = try decoder.decode(DiaryProject.self, from: Data(contentsOf: directory.appendingPathComponent("manifest.json")))
                guard project.id.uuidString == directory.lastPathComponent else { throw DiaryError.message("作品身份不一致。") }
                try validate(project)
                let journal = directory.appendingPathComponent("job.json")
                if FileManager.default.fileExists(atPath: journal.path) {
                    let job = try decoder.decode(ExportJob.self, from: Data(contentsOf: journal))
                    var preserveJob = false
                    if let output = job.completed {
                        let final = try Self.safeFile(output.file, in: directory)
                        let partial = try Self.safeFile(job.temporaryFile, in: directory)
                        if !FileManager.default.fileExists(atPath: final.path), FileManager.default.fileExists(atPath: partial.path) {
                            try FileManager.default.createDirectory(at: final.deletingLastPathComponent(), withIntermediateDirectories: true)
                            try FileManager.default.moveItem(at: partial, to: final)
                        }
                        if FileManager.default.fileExists(atPath: final.path) {
                            if !project.outputs.contains(where: { $0.id == output.id }) {
                                project.outputs.append(output)
                                project.revision = max(project.revision, output.revision) + 1
                                project.modified = Date()
                                try save(project)
                            }
                        } else {
                            failures.append("“\(project.title)”上次制作已完成，但结果文件丢失，原文件已保留，可以重新制作。")
                            preserveJob = true
                        }
                    } else {
                        failures.append("“\(project.title)”上次制作中断，草稿已保留，可以重新制作。")
                    }
                    if !preserveJob {
                        let partial = try Self.safeFile(job.temporaryFile, in: directory)
                        if FileManager.default.fileExists(atPath: partial.path) { try FileManager.default.removeItem(at: partial) }
                        let silent = partial.deletingPathExtension().appendingPathExtension("silent.mp4")
                        if FileManager.default.fileExists(atPath: silent.path) { try FileManager.default.removeItem(at: silent) }
                        try FileManager.default.removeItem(at: journal)
                    }
                }
                projects.append(project)
            } catch { failures.append("有一个作品未能读取：\(directory.lastPathComponent.prefix(8))。原文件已保留。") }
        }
        return (projects.sorted { $0.modified > $1.modified }, failures)
    }

    func validate(_ project: DiaryProject) throws {
        try ProjectValidation.check(project)
        let base = directory(project.id)
        for photo in project.photos { _ = try Self.safeFile(photo.file, in: base) }
        if let audio = project.audio {
            _ = try Self.safeFile(audio.file, in: base)
            guard audio.duration.isFinite, audio.duration > 0 else { throw DiaryError.message("音频时长无效。") }
        }
        guard project.lyrics.allSatisfy({ $0.time.isFinite && $0.time >= 0 }) else { throw DiaryError.message("歌词时间无效。") }
        for output in project.outputs { _ = try Self.safeFile(output.file, in: base) }
    }

    func save(_ project: DiaryProject) throws {
        guard !removed.contains(project.id) else { throw DiaryError.message("作品已删除。") }
        try validate(project)
        let directory = directory(project.id)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let manifest = directory.appendingPathComponent("manifest.json")
        if let data = try? Data(contentsOf: manifest), let current = try? decoder.decode(DiaryProject.self, from: data) {
            if current.revision > project.revision { return }
            if current.revision == project.revision, current != project {
                throw DiaryError.message("作品已在其他任务中更新，请重新载入后再保存。")
            }
        }
        try encoder.encode(project).write(to: manifest, options: .atomic)
    }

    func writeJob(_ job: ExportJob) throws {
        try encoder.encode(job).write(to: directory(job.projectID).appendingPathComponent("job.json"), options: .atomic)
    }

    func finishJob(_ id: UUID) throws {
        let url = directory(id).appendingPathComponent("job.json")
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }

    func delete(_ id: UUID) throws { try FileManager.default.removeItem(at: directory(id)); removed.insert(id) }

    func cleanUnused(_ projects: [DiaryProject]) throws -> Int64 {
        var freed = try reclaimInterruptedImports()
        for project in projects {
            try save(project)
            let retained = Set(project.photos.map(\.file) + project.outputs.map(\.file) + [project.audio?.file].compactMap { $0 })
            for folder in ["media", "outputs"] {
                let base = directory(project.id).appendingPathComponent(folder)
                guard let files = try? FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey]) else { continue }
                for file in files where !retained.contains(folder + "/" + file.lastPathComponent) {
                    let values = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
                    guard values.isRegularFile == true, values.isSymbolicLink != true else { continue }
                    freed += Int64(values.fileSize ?? 0)
                    try FileManager.default.removeItem(at: file)
                }
            }
        }
        return freed
    }

    private func reclaimInterruptedImports() throws -> Int64 {
        guard FileManager.default.fileExists(atPath: root.path) else { return 0 }
        var freed: Int64 = 0
        for item in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey]) {
            let name = item.lastPathComponent
            guard name.hasPrefix(".import-"), UUID(uuidString: String(name.dropFirst(8))) != nil else { continue }
            let values = try item.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else { continue }
            if let files = FileManager.default.enumerator(at: item, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey]) {
                for case let file as URL in files {
                    let attributes = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
                    if attributes.isSymbolicLink == true { files.skipDescendants() }
                    else if attributes.isRegularFile == true { freed += Int64(attributes.fileSize ?? 0) }
                }
            }
            try FileManager.default.removeItem(at: item)
        }
        return freed
    }
}
