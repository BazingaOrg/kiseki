import CoreGraphics

struct FrameLayout {
    let photoBox: CGRect
    let contentClip: CGRect
    let captionBox: CGRect?
    let exifBox: CGRect?
    let lyricsBox: CGRect?

    init(size: CGSize, caption: Bool, exif: Bool, lyrics: Bool) {
        let scale = min(size.width, size.height) / 1080
        let inset = 78 * scale
        var bottom = size.height - inset
        func lane(_ height: CGFloat) -> CGRect {
            bottom -= height * scale
            return CGRect(x: inset, y: bottom, width: size.width - inset * 2, height: height * scale)
        }
        lyricsBox = lyrics ? lane(150) : nil
        exifBox = exif ? lane(70) : nil
        captionBox = caption ? lane(110) : nil
        contentClip = CGRect(x: 0, y: 0, width: size.width, height: max(1, bottom - 8 * scale))
        photoBox = CGRect(x: inset, y: inset, width: size.width - inset * 2, height: max(1, bottom - inset - 24 * scale))
    }
}
