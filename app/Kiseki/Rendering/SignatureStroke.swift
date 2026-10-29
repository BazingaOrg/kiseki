import CoreText
import UIKit

enum SignatureStroke {
    static func draw(_ text: String, in rect: CGRect, fontSize: CGFloat, progress: CGFloat, color: UIColor, context: CGContext) -> Bool {
        if text.isEmpty { return true }
        let hasHan = text.unicodeScalars.contains { (0x3400...0x9FFF).contains($0.value) }
        let name = hasHan ? "MaShanZheng-Regular" : "Sacramento-Regular"
        guard let uiFont = UIFont(name: name, size: fontSize) else { return false }
        if progress <= 0 { return true }

        let attributes: [NSAttributedString.Key: Any] = [.font: uiFont]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
        var ascent: CGFloat = 0
        var descent: CGFloat = 0
        let width = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, nil))
        let origin = CGPoint(x: rect.midX - width / 2, y: rect.midY + (ascent - descent) / 2)
        let pieces = strokePieces(line: line, origin: origin)
        let total = pieces.reduce(CGFloat.zero) { $0 + $1.length }
        guard total > 0 else { return true }

        context.saveGState()
        context.clip(to: rect)
        context.setStrokeColor(color.cgColor)
        context.setLineWidth(fontSize * 0.015)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        var remaining = min(progress, 1) * total
        for piece in pieces {
            if remaining > 0, piece.length > 0 {
                context.addPath(piece.path)
                if remaining >= piece.length {
                    context.setLineDash(phase: 0, lengths: [])
                } else {
                    context.setLineDash(phase: 0, lengths: [remaining, piece.length])
                }
                context.strokePath()
            }
            remaining -= piece.length
        }
        context.restoreGState()
        return true
    }

    private struct Piece {
        let path: CGPath
        let length: CGFloat
    }

    private static func strokePieces(line: CTLine, origin: CGPoint) -> [Piece] {
        let runs = CTLineGetGlyphRuns(line) as! [CTRun]
        var pieces: [Piece] = []
        for run in runs {
            let count = CTRunGetGlyphCount(run)
            guard count > 0 else { continue }
            var glyphs = Array(repeating: CGGlyph(), count: count)
            var positions = Array(repeating: CGPoint.zero, count: count)
            CTRunGetGlyphs(run, CFRange(), &glyphs)
            CTRunGetPositions(run, CFRange(), &positions)
            let attributes = CTRunGetAttributes(run) as NSDictionary
            let font = attributes[kCTFontAttributeName] as! CTFont
            for index in 0..<count {
                var transform = CGAffineTransform(translationX: origin.x + positions[index].x, y: origin.y + positions[index].y).scaledBy(x: 1, y: -1)
                guard let path = CTFontCreatePathForGlyph(font, glyphs[index], &transform) else { continue }
                let length = pathLength(path)
                if length > 0 { pieces.append(Piece(path: path, length: length)) }
            }
        }
        return pieces
    }

    private static func pathLength(_ path: CGPath) -> CGFloat {
        var length: CGFloat = 0
        var start = CGPoint.zero
        var current = CGPoint.zero
        path.applyWithBlock { pointer in
            let element = pointer.pointee
            let points = element.points
            switch element.type {
            case .moveToPoint:
                start = points[0]
                current = points[0]
            case .addLineToPoint:
                length += hypot(points[0].x - current.x, points[0].y - current.y)
                current = points[0]
            case .addQuadCurveToPoint:
                let control = points[0]
                let end = points[1]
                let c1 = CGPoint(x: current.x + (control.x - current.x) * 2 / 3, y: current.y + (control.y - current.y) * 2 / 3)
                let c2 = CGPoint(x: end.x + (control.x - end.x) * 2 / 3, y: end.y + (control.y - end.y) * 2 / 3)
                length += sampledLength(current, c1, c2, end)
                current = end
            case .addCurveToPoint:
                length += sampledLength(current, points[0], points[1], points[2])
                current = points[2]
            case .closeSubpath:
                length += hypot(start.x - current.x, start.y - current.y)
                current = start
            @unknown default:
                break
            }
        }
        return length
    }

    private static func sampledLength(_ p0: CGPoint, _ p1: CGPoint, _ p2: CGPoint, _ p3: CGPoint) -> CGFloat {
        var length: CGFloat = 0
        var previous = p0
        for step in 1...16 {
            let t = CGFloat(step) / 16
            let u = 1 - t
            let uu = u * u
            let tt = t * t
            let point = CGPoint(
                x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
                y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y
            )
            length += hypot(point.x - previous.x, point.y - previous.y)
            previous = point
        }
        return length
    }
}
