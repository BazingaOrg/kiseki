import Foundation
import CryptoKit

struct FileDigest {
    static func checkCapacity(at directory: URL, incoming: Int64) throws {
        guard let available = try directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage else { throw DiaryError.message("暂时无法检查可用空间，请重试。") }
        guard available > incoming + 20_000_000 else { throw DiaryError.message("可用空间不足，请清理后再导入。") }
    }

    static func sha256(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 65536), !data.isEmpty { hash.update(data: data) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
