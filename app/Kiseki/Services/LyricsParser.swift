import Foundation

struct LyricsParser {
    static func parse(_ text: String) -> [LyricLine] {
        let expression = try! NSRegularExpression(pattern: "\\[(\\d{1,3}):(\\d{2}(?:\\.\\d{1,3})?)\\]")
        var lines: [LyricLine] = []
        for source in text.components(separatedBy: .newlines) {
            let range = NSRange(source.startIndex..., in: source)
            let matches = expression.matches(in: source, range: range)
            guard let last = matches.last, let end = Range(last.range, in: source)?.upperBound else { continue }
            let copy = String(source[end...]).trimmingCharacters(in: .whitespaces)
            guard !copy.isEmpty else { continue }
            for match in matches {
                guard let minutesRange = Range(match.range(at: 1), in: source), let secondsRange = Range(match.range(at: 2), in: source), let minutes = Double(source[minutesRange]), let seconds = Double(source[secondsRange]), seconds < 60 else { continue }
                let time = minutes * 60 + seconds
                if let index = lines.lastIndex(where: { abs($0.time - time) < 0.01 }) {
                    if lines[index].text != copy { lines[index].translation = copy }
                } else { lines.append(LyricLine(time: time, text: copy)) }
            }
        }
        return lines.sorted { $0.time < $1.time }
    }
}
