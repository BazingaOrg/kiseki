import UIKit
import ImageIO

final class FrameRenderer {
    let plan: RenderPlan
    let directory: URL
    let resolutionLimit: Int
    private var images: [UUID: UIImage] = [:]
    private var order: [UUID] = []
    private var gradedImages: [UUID: (roll: String, strength: Double, image: UIImage)] = [:]

    init(plan: RenderPlan, directory: URL, resolutionLimit: Int = 2400) {
        self.plan = plan
        self.directory = directory
        self.resolutionLimit = resolutionLimit
    }

    func photo(_ index: Int, maximum: Int = 2400) throws -> UIImage {
        let source = plan.project.photos[index]
        if let cached = images[source.id] { return cached }
        let url = try ProjectRepository.safeFile(source.file, in: directory)
        guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil), let cg = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: min(maximum, resolutionLimit), kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else { throw DiaryError.message("有一张照片无法解码，请重新添加。") }
        let image = UIImage(cgImage: cg)
        images[source.id] = image
        order.append(source.id)
        if order.count > 3 {
            let evicted = order.removeFirst()
            images.removeValue(forKey: evicted)
            gradedImages.removeValue(forKey: evicted)
        }
        return image
    }

    func image(at time: Double, width: CGFloat = 360, stillIndex: Int? = nil) throws -> UIImage {
        let size = plan.project.settings.format.size
        let output = CGSize(width: width, height: width * size.height / size.width)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.preferredRange = .standard
        var failure: Error?
        let image = UIGraphicsImageRenderer(size: output, format: format).image { _ in
            do { try draw(at: time, size: output, stillIndex: stillIndex) } catch { failure = error }
        }
        if let failure { throw failure }
        return image
    }

    func draw(at time: Double, size: CGSize, stillIndex: Int? = nil) throws {
        guard let cg = UIGraphicsGetCurrentContext() else { return }
        let settings = plan.project.settings
        let scale = min(size.width, size.height) / 1080
        let ink = settings.dark ? UIColor(white: 0.92, alpha: 1) : UIColor(red: 0.14, green: 0.21, blue: 0.25, alpha: 1)
        let background = settings.dark ? UIColor(red: 0.10, green: 0.12, blue: 0.13, alpha: 1) : UIColor(red: 1, green: 0.99, blue: 0.97, alpha: 1)
        background.setFill()
        cg.fill(CGRect(origin: .zero, size: size))
        let inRecap = stillIndex == nil && plan.recapDuration > 0 && time >= plan.introDuration && time < plan.introDuration + plan.recapDuration
        let recapIndex = max(0, plan.project.photos.count - 1 - Int((time - plan.introDuration) / max(0.001, plan.recapDuration) * Double(plan.project.photos.count)))
        let index = min(stillIndex ?? (inRecap ? recapIndex : plan.index(at: time)), plan.project.photos.count - 1)
        let current = try photo(index)
        let inset = 78 * scale
        let layout = FrameLayout(size: size, caption: settings.captions && plan.project.photos.contains(where: { !$0.caption.isEmpty }), exif: settings.exif, lyrics: stillIndex == nil && settings.lyricsMode != .none && !plan.project.lyrics.isEmpty)
        let photoBox = layout.photoBox
        func placed(_ image: UIImage) -> CGRect { aspectFit(image.size, in: photoBox) }
        func drawPhoto(_ image: UIImage, id: UUID, alpha: CGFloat) {
            cg.saveGState()
            cg.clip(to: layout.contentClip)
            graded(image, id: id).draw(in: placed(image), blendMode: .normal, alpha: alpha)
            cg.restoreGState()
        }
        var incoming: (index: Int, alpha: CGFloat)?
        if stillIndex == nil, !inRecap {
            let fading = plan.segments.first { segment in
                guard segment.fade > 0, segment.index > 0 else { return false }
                let origin = fadeOrigin(segment)
                return time >= origin && time < origin + segment.fade
            }
            if let fading {
                let progress = min(1, max(0, (time - fadeOrigin(fading)) / fading.fade))
                if progress < 1 { incoming = (fading.index, CGFloat(progress)) }
            }
        }
        if let incoming {
            let outgoing = plan.project.photos[incoming.index - 1]
            let shown = plan.project.photos[incoming.index]
            drawPhoto(try photo(incoming.index - 1), id: outgoing.id, alpha: 1)
            drawPhoto(try photo(incoming.index), id: shown.id, alpha: incoming.alpha)
        } else {
            drawPhoto(current, id: plan.project.photos[index].id, alpha: 1)
        }
        let selected = plan.project.photos[index]
        if !inRecap && settings.captions && !selected.caption.isEmpty, let captionBox = layout.captionBox {
            text(selected.caption, rect: captionBox, size: 36 * scale, color: ink, serif: true)
        }
        if settings.exif, let exifBox = layout.exifBox {
            let date = selected.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none) } ?? ""
            let copy = [selected.camera, date].filter { !$0.isEmpty }.joined(separator: " · ")
            text(copy, rect: exifBox, size: 24 * scale, color: ink.withAlphaComponent(0.7))
        }
        if settings.sign && !settings.signature.isEmpty {
            text(settings.signature, rect: CGRect(x: inset, y: max(inset, placed(current).maxY - 72 * scale), width: photoBox.width - 24 * scale, height: 60 * scale), size: 34 * scale, color: UIColor.white, alignment: .right, serif: true, signature: true)
        }
        if stillIndex == nil {
            if !inRecap && settings.lyricsMode != .none, let lyricsBox = layout.lyricsBox, let line = plan.project.lyrics.last(where: { $0.time + settings.lyricOffset <= time }), time - (line.time + settings.lyricOffset) < 8 {
                var copy = line.text
                if settings.lyricsMode == .bilingual, let translated = line.translation { copy += "\n" + translated }
                text(copy, rect: lyricsBox, size: 30 * scale, color: ink)
            }
            if plan.introDuration > 0 && time < plan.introDuration {
                background.setFill()
                cg.fill(CGRect(origin: .zero, size: size))
                let copy = settings.signature.isEmpty ? plan.project.title : settings.signature
                let rect = CGRect(x: inset, y: size.height / 2 - 75 * scale, width: size.width - inset * 2, height: 150 * scale)
                let fontSize = 65 * scale
                if settings.signature.isEmpty {
                    text(copy, rect: rect, size: fontSize, color: ink.withAlphaComponent(min(1, time / 0.5)), serif: true, signature: true)
                } else {
                    let fade = time > plan.introDuration - 0.5 ? max(0, (plan.introDuration - time) / 0.5) : 1
                    let color = ink.withAlphaComponent(fade)
                    if !SignatureStroke.draw(copy, in: rect, fontSize: fontSize, progress: CGFloat(min(1, time / 1.4)), color: color, context: cg) {
                        text(copy, rect: rect, size: fontSize, color: ink.withAlphaComponent(min(1, time / 0.5)), serif: true, signature: true)
                    }
                }
            }
            if !inRecap, settings.chapters, let date = selected.date, let segment = plan.segments.first(where: { $0.index == index }), segment.end - segment.start > 1.5, time >= segment.start, time < segment.start + 0.7 {
                let previousDate = index > 0 ? plan.project.photos[index - 1].date : nil
                if previousDate == nil || !Calendar.current.isDate(date, inSameDayAs: previousDate!) {
                    background.setFill()
                    cg.fill(CGRect(origin: .zero, size: size))
                    text(DateFormatter.localizedString(from: date, dateStyle: .long, timeStyle: .none), rect: CGRect(x: inset, y: size.height / 2 - 45 * scale, width: size.width - inset * 2, height: 90 * scale), size: 42 * scale, color: ink, serif: true)
                }
            }
            if plan.outroDuration > 0 && time >= plan.duration - plan.outroDuration {
                background.setFill()
                cg.fill(CGRect(origin: .zero, size: size))
                text(settings.outro, rect: CGRect(x: inset, y: size.height / 2 - 55 * scale, width: size.width - inset * 2, height: 110 * scale), size: 42 * scale, color: ink, serif: true)
                if let audio = plan.project.audio { text(audio.title, rect: CGRect(x: inset, y: size.height / 2 + 70 * scale, width: size.width - inset * 2, height: 70 * scale), size: 25 * scale, color: ink.withAlphaComponent(0.7)) }
            }
        }
    }

    private func graded(_ image: UIImage, id: UUID) -> UIImage {
        let roll = plan.project.settings.filmRoll
        let strength = plan.project.settings.filmStrength
        if roll == "original" || strength <= 0 { return image }
        if let cached = gradedImages[id], cached.roll == roll, cached.strength == strength { return cached.image }
        let result = FilmGrade.apply(image, roll: roll, strength: strength)
        gradedImages[id] = (roll, strength, result)
        return result
    }

    private func fadeOrigin(_ segment: PhotoSegment) -> Double {
        let origin = plan.project.settings.transition == .crossfade ? segment.start - segment.fade / 2 : segment.start
        return min(plan.duration, max(0, origin))
    }

    private func aspectFit(_ size: CGSize, in box: CGRect) -> CGRect {
        let ratio = min(box.width / size.width, box.height / size.height)
        return CGRect(x: box.midX - size.width * ratio / 2, y: box.midY - size.height * ratio / 2, width: size.width * ratio, height: size.height * ratio)
    }

    private func text(_ string: String, rect: CGRect, size: CGFloat, color: UIColor, alignment: NSTextAlignment = .center, serif: Bool = false, signature: Bool = false) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail
        let base = UIFont.systemFont(ofSize: max(8, size), weight: .regular)
        let hasHan = string.unicodeScalars.contains { (0x3400...0x9FFF).contains($0.value) }
        let signatureFont = signature ? UIFont(name: hasHan ? "MaShanZheng-Regular" : "Sacramento-Regular", size: max(8, size)) : nil
        let font = signatureFont ?? (serif ? UIFont(descriptor: base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor, size: max(8, size)) : base)
        (string as NSString).draw(in: rect, withAttributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
    }
}
