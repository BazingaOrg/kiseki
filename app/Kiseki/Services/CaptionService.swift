import Foundation
import UIKit
import ImageIO

struct CaptionService {
    static func generate(file: URL, hint: String, key: String) async throws -> String {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil), let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 640, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary), let jpeg = UIImage(cgImage: cg).jpegData(compressionQuality: 0.75) else { throw DiaryError.message("无法准备缩小预览。") }
        let prompt = "你为影像日记写一句中文图片旁白。只基于画面可确认的信息，不虚构人物关系和背景。自然、含蓄，略带日常幽默，避免煽情套话。只输出8到24个汉字，最多30字，不要引号、换行或解释。"
        let content: [[String: Any]] = [
            ["type": "text", "text": "看着照片写一句画外之意。" + (hint.isEmpty ? "" : "拍摄者补充：" + String(hint.prefix(40)))],
            ["type": "image_url", "image_url": ["url": "data:image/jpeg;base64," + jpeg.base64EncodedString(), "detail": "low"]]
        ]
        let body: [String: Any] = ["model": "deepseek-flash", "messages": [["role": "system", "content": prompt], ["role": "user", "content": content]], "max_tokens": 96, "thinking": ["type": "disabled"], "stream": false]
        var request = URLRequest(url: URL(string: "https://api.deepseek.com/chat/completions")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        let session = URLSession(configuration: configuration, delegate: CaptionRedirectPolicy(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw DiaryError.message("旁白服务没有返回有效响应。") }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 || http.statusCode == 403 { throw DiaryError.message("旁白服务未接受这份 Key，请在设置中检查。") }
            if http.statusCode == 429 { throw DiaryError.message("旁白请求过于频繁，请稍后重试。") }
            throw DiaryError.message("旁白服务暂时不可用（\(http.statusCode)）。已有旁白仍可用于制作。")
        }
        var data = Data()
        for try await byte in bytes {
            guard data.count < 1_000_000 else { throw DiaryError.message("旁白响应异常，请重试。") }
            data.append(byte)
        }
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        let result = (decoded.choices.first?.message.content ?? "").trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "\"“”「」"))
        guard !result.isEmpty, result.count <= 30, !result.contains("\n") else { throw DiaryError.message("服务返回的旁白不符合长度要求，请重试或手写。") }
        return result
    }
    private struct Response: Decodable {
        struct Choice: Decodable { struct Message: Decodable { let content: String? }; let message: Message }
        let choices: [Choice]
    }
}

private final class CaptionRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
