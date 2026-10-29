import Foundation

struct LyricsCandidate: Identifiable {
    let id: Int
    let trackName: String
    let artistName: String
    let duration: Double
    let syncedLyrics: String?
}

enum LyricsSearchError: LocalizedError {
    case emptyQuery
    case invalidResponse
    case requestFailed(Int)
    case responseTooLarge

    var errorDescription: String? {
        switch self {
        case .emptyQuery: return "请输入歌曲或歌手名称。"
        case .invalidResponse: return "歌词服务返回了无法识别的内容。"
        case .requestFailed(let status): return "歌词搜索暂时不可用（\(status)）。"
        case .responseTooLarge: return "歌词搜索结果过大，请缩小搜索范围。"
        }
    }
}

struct LyricsService {
    static func search(query: String) async throws -> [LyricsCandidate] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { throw LyricsSearchError.emptyQuery }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "lrclib.net"
        components.path = "/api/search"
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        guard let url = components.url else { throw LyricsSearchError.invalidResponse }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw LyricsSearchError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else { throw LyricsSearchError.requestFailed(response.statusCode) }
        let limit = 2 * 1024 * 1024
        if response.expectedContentLength > Int64(limit) { throw LyricsSearchError.responseTooLarge }
        var data = Data()
        for try await byte in bytes {
            guard data.count < limit else { throw LyricsSearchError.responseTooLarge }
            data.append(byte)
        }
        return try decodeCandidates(data)
    }

    static func decodeCandidates(_ data: Data) throws -> [LyricsCandidate] {
        let records: [Record]
        do { records = try JSONDecoder().decode([Record].self, from: data) }
        catch { throw LyricsSearchError.invalidResponse }
        return records.compactMap { record in
            guard let id = record.id, let trackName = record.trackName, !trackName.isEmpty,
                  let artistName = record.artistName, !artistName.isEmpty,
                  let duration = record.duration, ProjectValidation.validTime(duration) else { return nil }
            return LyricsCandidate(id: id, trackName: trackName, artistName: artistName, duration: duration, syncedLyrics: record.syncedLyrics)
        }
    }

    private struct Record: Decodable {
        private enum CodingKeys: String, CodingKey {
            case id, trackName, artistName, duration, syncedLyrics
        }

        let id: Int?
        let trackName: String?
        let artistName: String?
        let duration: Double?
        let syncedLyrics: String?

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try? container.decode(Int.self, forKey: .id)
            trackName = try? container.decode(String.self, forKey: .trackName)
            artistName = try? container.decode(String.self, forKey: .artistName)
            duration = try? container.decode(Double.self, forKey: .duration)
            syncedLyrics = try? container.decode(String.self, forKey: .syncedLyrics)
        }
    }
}
