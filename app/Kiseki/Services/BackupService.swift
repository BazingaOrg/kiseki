import Foundation
import CryptoKit

enum BackupService {
    private static let metadataLimit: Int64 = 10 * 1024 * 1024
    private static let mediaLimit: Int64 = 2 * 1024 * 1024 * 1024

    static func create(project: DiaryProject, directory: URL) throws -> URL {
        try validate(project)
        let manager = FileManager.default
        let package = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".kisekiproject", isDirectory: true)
        try manager.createDirectory(at: package, withIntermediateDirectories: false)
        do {
            var manifest = project
            manifest.outputs = []
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let manifestData = try encoder.encode(manifest)
            guard manifestData.count <= metadataLimit else { throw failure() }
            try manifestData.write(to: package.appendingPathComponent("manifest.json"), options: .atomic)
            var checksums = ["manifest.json": digest(manifestData)]
            var total: Int64 = 0
            for path in try mediaPaths(manifest) {
                let source = try checkedFile(path, in: directory)
                let target = try ProjectRepository.safeFile(path, in: package)
                try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                checksums[path] = try copyAndHash(source: source, target: target, total: &total)
            }
            try encoder.encode(checksums).write(to: package.appendingPathComponent("checksums.json"), options: .atomic)
            return package
        } catch {
            try? manager.removeItem(at: package)
            throw error
        }
    }

    static func restore(from package: URL, root: URL) throws -> DiaryProject {
        let manager = FileManager.default
        guard package.pathExtension == "kisekiproject" else { throw failure() }
        try checkDirectory(package)
        let checksumURL = try checkedFile("checksums.json", in: package)
        let checksumsData = try readLimited(checksumURL, limit: metadataLimit)
        let checksums = try JSONDecoder().decode([String: String].self, from: checksumsData)
        let manifestURL = try checkedFile("manifest.json", in: package)
        let manifestData = try readLimited(manifestURL, limit: metadataLimit)
        guard checksums["manifest.json"] == digest(manifestData) else { throw failure() }
        var project = try JSONDecoder().decode(DiaryProject.self, from: manifestData)
        try validate(project)
        let paths = try mediaPaths(project)
        guard Set(checksums.keys) == Set(paths).union(["manifest.json"]) else { throw failure() }
        project.id = UUID()
        project.revision = 0
        project.outputs = []
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        try checkDirectory(root)
        let temporary = root.appendingPathComponent(".import-" + UUID().uuidString, isDirectory: true)
        let destination = root.appendingPathComponent(project.id.uuidString, isDirectory: true)
        try manager.createDirectory(at: temporary, withIntermediateDirectories: false)
        do {
            var total: Int64 = 0
            for path in paths {
                let source = try checkedFile(path, in: package)
                let target = try ProjectRepository.safeFile(path, in: temporary)
                try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                guard try copyAndHash(source: source, target: target, total: &total) == checksums[path] else { throw failure() }
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(project).write(to: temporary.appendingPathComponent("manifest.json"), options: .atomic)
            try manager.moveItem(at: temporary, to: destination)
            return project
        } catch {
            try? manager.removeItem(at: temporary)
            throw error
        }
    }

    private static func validate(_ project: DiaryProject) throws {
        try ProjectValidation.check(project)
    }

    private static func mediaPaths(_ project: DiaryProject) throws -> [String] {
        let paths = project.photos.map(\.file) + (project.audio.map { [$0.file] } ?? [])
        for path in paths {
            let components = path.split(separator: "/", omittingEmptySubsequences: false)
            guard components.count >= 2, components.first == "media",
                  components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
                  !path.contains("\\") else { throw failure() }
        }
        return Array(Set(paths)).sorted()
    }

    private static func checkDirectory(_ url: URL) throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeDirectory else { throw failure() }
    }

    private static func checkedFile(_ path: String, in root: URL) throws -> URL {
        try checkDirectory(root)
        let url = try ProjectRepository.safeFile(path, in: root)
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { throw failure() }
        var current = root
        for (index, component) in components.enumerated() {
            current.appendPathComponent(String(component))
            let attributes = try FileManager.default.attributesOfItem(atPath: current.path)
            let expected: FileAttributeType = index == components.count - 1 ? .typeRegular : .typeDirectory
            guard attributes[.type] as? FileAttributeType == expected else { throw failure() }
        }
        return url
    }

    private static func readLimited(_ url: URL, limit: Int64) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var data = Data()
        while let chunk = try handle.read(upToCount: 64 * 1024), !chunk.isEmpty {
            guard Int64(data.count) + Int64(chunk.count) <= limit else { throw failure() }
            data.append(chunk)
        }
        return data
    }

    private static func copyAndHash(source: URL, target: URL, total: inout Int64) throws -> String {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        guard FileManager.default.createFile(atPath: target.path, contents: nil) else { throw failure() }
        let output = try FileHandle(forWritingTo: target)
        defer { try? output.close() }
        var hash = SHA256()
        while let chunk = try input.read(upToCount: 64 * 1024), !chunk.isEmpty {
            guard Int64(chunk.count) <= mediaLimit - total else { throw failure() }
            total += Int64(chunk.count)
            hash.update(data: chunk)
            try output.write(contentsOf: chunk)
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func failure() -> DiaryError {
        .message("备份文件无效或超出支持的范围。")
    }
}
