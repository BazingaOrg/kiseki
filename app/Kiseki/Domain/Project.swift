import Foundation
import CoreGraphics

struct DiaryPhoto: Codable, Identifiable, Equatable, Sendable {
    var id = UUID()
    var file: String
    var sourceIdentifier: String?
    var fingerprint: String?
    var date: Date?
    var camera: String = ""
    var caption: String = ""
    var hint: String = ""
    var edited = false
}

struct DiaryAudio: Codable, Equatable, Sendable {
    var file: String
    var title: String
    var duration: Double
}

struct LyricLine: Codable, Identifiable, Equatable, Sendable {
    var id = UUID()
    var time: Double
    var text: String
    var translation: String?
}

enum CanvasFormat: String, Codable, CaseIterable, Sendable {
    case portrait, landscape, square
    var label: String { switch self { case .portrait: return "竖版"; case .landscape: return "横版"; case .square: return "方形" } }
    var size: CGSize { switch self { case .portrait: return CGSize(width: 1080, height: 1920); case .landscape: return CGSize(width: 1920, height: 1080); case .square: return CGSize(width: 1080, height: 1080) } }
}

enum DiaryTemplate: String, Codable, CaseIterable, Sendable {
    case diary, filmstrip, polaroid, cinema, news
    var label: String { switch self { case .diary: return "日记"; case .filmstrip: return "胶片带"; case .polaroid: return "拍立得"; case .cinema: return "电影舒缓"; case .news: return "新闻快切" } }
}

enum DiaryFilter: String, Codable, CaseIterable, Sendable {
    case original, warm, chrome, mono
    var label: String { switch self { case .original: return "原色"; case .warm: return "暖胶片"; case .chrome: return "淡彩"; case .mono: return "黑白" } }
}

enum LyricsMode: String, Codable, CaseIterable, Sendable {
    case original, bilingual, none
    var label: String { switch self { case .original: return "原文"; case .bilingual: return "双语"; case .none: return "不显示" } }
}

enum PhotoTransition: String, Codable, CaseIterable, Sendable {
    case album, crossfade, cut
    var label: String { switch self { case .album: return "相册淡入"; case .crossfade: return "交叉溶解"; case .cut: return "硬切" } }
    var requestedFade: Double { switch self { case .album: return 0.25; case .crossfade: return 0.6; case .cut: return 0 } }
    func resolvedFade(hold: Double) -> Double {
        hold <= requestedFade + 0.12 ? 0 : requestedFade
    }
}

struct DiarySettings: Equatable, Sendable {
    var format: CanvasFormat = .portrait
    var template: DiaryTemplate = .diary
    var filter: DiaryFilter = .original
    var intensity: Double = 0.6
    var dark = false
    var exif = false
    var signature = ""
    var sign = false
    var outro = ""
    var captions = true
    var lyricsMode: LyricsMode = .bilingual
    var lyricOffset = 0.0
    var photoSeconds = 4.0
    var fullAudio = true
    var followMusic = true
    var intro = false
    var recap = false
    var chapters = false
    var transition: PhotoTransition = .album
    var filmRoll = "original"
    var filmStrength = 0.6
}

extension DiarySettings: Codable {
    enum CodingKeys: String, CodingKey {
        case format, template, filter, intensity, dark, exif, signature, sign, outro, captions, lyricsMode, lyricOffset, photoSeconds, fullAudio, followMusic, intro, recap, chapters, transition, filmRoll, filmStrength
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        format = try container.decode(CanvasFormat.self, forKey: .format)
        template = try container.decode(DiaryTemplate.self, forKey: .template)
        filter = try container.decode(DiaryFilter.self, forKey: .filter)
        intensity = try container.decode(Double.self, forKey: .intensity)
        dark = try container.decode(Bool.self, forKey: .dark)
        exif = try container.decode(Bool.self, forKey: .exif)
        signature = try container.decode(String.self, forKey: .signature)
        sign = try container.decode(Bool.self, forKey: .sign)
        outro = try container.decode(String.self, forKey: .outro)
        captions = try container.decode(Bool.self, forKey: .captions)
        lyricsMode = try container.decode(LyricsMode.self, forKey: .lyricsMode)
        lyricOffset = try container.decode(Double.self, forKey: .lyricOffset)
        photoSeconds = try container.decode(Double.self, forKey: .photoSeconds)
        fullAudio = try container.decode(Bool.self, forKey: .fullAudio)
        followMusic = try container.decodeIfPresent(Bool.self, forKey: .followMusic) ?? true
        intro = try container.decode(Bool.self, forKey: .intro)
        recap = try container.decode(Bool.self, forKey: .recap)
        chapters = try container.decode(Bool.self, forKey: .chapters)
        transition = try container.decodeIfPresent(PhotoTransition.self, forKey: .transition) ?? .album
        filmRoll = try container.decodeIfPresent(String.self, forKey: .filmRoll) ?? "original"
        filmStrength = try container.decodeIfPresent(Double.self, forKey: .filmStrength) ?? 0.6
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(format, forKey: .format)
        try container.encode(template, forKey: .template)
        try container.encode(filter, forKey: .filter)
        try container.encode(intensity, forKey: .intensity)
        try container.encode(dark, forKey: .dark)
        try container.encode(exif, forKey: .exif)
        try container.encode(signature, forKey: .signature)
        try container.encode(sign, forKey: .sign)
        try container.encode(outro, forKey: .outro)
        try container.encode(captions, forKey: .captions)
        try container.encode(lyricsMode, forKey: .lyricsMode)
        try container.encode(lyricOffset, forKey: .lyricOffset)
        try container.encode(photoSeconds, forKey: .photoSeconds)
        try container.encode(fullAudio, forKey: .fullAudio)
        try container.encode(followMusic, forKey: .followMusic)
        try container.encode(intro, forKey: .intro)
        try container.encode(recap, forKey: .recap)
        try container.encode(chapters, forKey: .chapters)
        try container.encode(transition, forKey: .transition)
        try container.encode(filmRoll, forKey: .filmRoll)
        try container.encode(filmStrength, forKey: .filmStrength)
    }
}

struct OutputVersion: Codable, Identifiable, Equatable, Sendable {
    var id = UUID()
    var file: String
    var title: String
    var video: Bool
    var created = Date()
    var duration: Double
    var revision: Int
}

struct DiaryProject: Identifiable, Equatable, Sendable {
    var schemaVersion = 1
    var id = UUID()
    var title = "未命名的日子"
    var created = Date()
    var modified = Date()
    var revision = 0
    var photos: [DiaryPhoto] = []
    var audio: DiaryAudio?
    var lyrics: [LyricLine] = []
    var settings = DiarySettings()
    var outputs: [OutputVersion] = []
    var lastTab = "photos"
    var beatTimes: [Double] = []
    var beatEnergy: [Double] = []
    var beatOnset: [Double] = []
    var beatLowOnset: [Double] = []
}

extension DiaryProject: Codable {
    enum CodingKeys: String, CodingKey {
        case schemaVersion, id, title, created, modified, revision, photos, audio, lyrics, settings, outputs, lastTab, beatTimes, beatEnergy, beatOnset, beatLowOnset
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        id = try container.decode(UUID.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        created = try container.decode(Date.self, forKey: .created)
        modified = try container.decode(Date.self, forKey: .modified)
        revision = try container.decode(Int.self, forKey: .revision)
        photos = try container.decode([DiaryPhoto].self, forKey: .photos)
        audio = try container.decodeIfPresent(DiaryAudio.self, forKey: .audio)
        lyrics = try container.decode([LyricLine].self, forKey: .lyrics)
        settings = try container.decode(DiarySettings.self, forKey: .settings)
        outputs = try container.decode([OutputVersion].self, forKey: .outputs)
        lastTab = try container.decode(String.self, forKey: .lastTab)
        beatTimes = try container.decodeIfPresent([Double].self, forKey: .beatTimes) ?? []
        beatEnergy = try container.decodeIfPresent([Double].self, forKey: .beatEnergy) ?? []
        beatOnset = try container.decodeIfPresent([Double].self, forKey: .beatOnset) ?? []
        beatLowOnset = try container.decodeIfPresent([Double].self, forKey: .beatLowOnset) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(created, forKey: .created)
        try container.encode(modified, forKey: .modified)
        try container.encode(revision, forKey: .revision)
        try container.encode(photos, forKey: .photos)
        try container.encodeIfPresent(audio, forKey: .audio)
        try container.encode(lyrics, forKey: .lyrics)
        try container.encode(settings, forKey: .settings)
        try container.encode(outputs, forKey: .outputs)
        try container.encode(lastTab, forKey: .lastTab)
        try container.encode(beatTimes, forKey: .beatTimes)
        try container.encode(beatEnergy, forKey: .beatEnergy)
        try container.encode(beatOnset, forKey: .beatOnset)
        try container.encode(beatLowOnset, forKey: .beatLowOnset)
    }
}

struct PhotoSegment: Sendable {
    var index: Int
    var start: Double
    var end: Double
    var fade: Double
}

struct RenderPlan: Sendable {
    let project: DiaryProject
    let duration: Double
    let introDuration: Double
    let outroDuration: Double
    let recapDuration: Double
    let segments: [PhotoSegment]
    let fps = 60
    var frames: Int { Int(ceil(duration * Double(fps))) }

    init(project: DiaryProject, still: Bool = false) throws {
        try ProjectValidation.check(project)
        guard !project.photos.isEmpty else { throw DiaryError.message("先从图库选几张照片。") }
        guard project.settings.photoSeconds.isFinite, (1...12).contains(project.settings.photoSeconds) else { throw DiaryError.message("照片停留时间无效。") }
        let raw = project.settings.fullAudio ? (project.audio?.duration ?? Double(project.photos.count) * project.settings.photoSeconds) : Double(project.photos.count) * project.settings.photoSeconds
        guard raw.isFinite, raw > 0, raw <= 1800 else { throw DiaryError.message("目前支持 30 分钟以内的作品。") }
        let intro = !still && project.settings.intro && raw > 8 ? 2.65 : 0
        let outro = !still && raw > 8 && !project.settings.outro.isEmpty ? 2.5 : 0
        let recap = !still && project.settings.recap && project.photos.count >= 8 && raw - intro - outro > Double(project.photos.count) + 3 ? min(2.8, max(1.2, Double(project.photos.count) * 4 / 30)) : 0
        let body = raw - intro - outro - recap
        guard still || body / Double(project.photos.count) >= 0.5 else { throw DiaryError.message("音乐太短，放不下全部照片。请减少照片或更换音乐。") }
        var normalized = project
        normalized.settings.template = .diary
        normalized.settings.filter = .original
        self.project = normalized
        duration = still ? 1 : raw
        introDuration = intro
        outroDuration = outro
        recapDuration = recap
        let transition = project.settings.transition
        let even: [PhotoSegment] = project.photos.indices.map { i in
            let start = intro + recap + body * Double(i) / Double(project.photos.count)
            let end = intro + recap + body * Double(i + 1) / Double(project.photos.count)
            return PhotoSegment(index: i, start: start, end: end, fade: transition.resolvedFade(hold: end - start))
        }
        if !still, project.settings.followMusic, project.audio != nil, project.beatTimes.count >= 4, project.photos.count > 1,
           let timed = Self.beatSegments(project: project, raw: raw, intro: intro, recap: recap, outro: outro, transition: transition) {
            segments = timed
        } else {
            segments = even
        }
    }

    private static func beatSegments(project: DiaryProject, raw: Double, intro: Double, recap: Double, outro: Double, transition: PhotoTransition) -> [PhotoSegment]? {
        let head = intro + recap
        let tail = raw - outro
        let cuts = planPhotoCuts(
            duration: raw,
            nPhotos: project.photos.count,
            beatTimes: project.beatTimes,
            energy: project.beatEnergy.isEmpty ? nil : project.beatEnergy,
            onset: project.beatOnset.isEmpty ? nil : project.beatOnset,
            lowOnset: project.beatLowOnset.isEmpty ? nil : project.beatLowOnset,
            lyricSpans: lyricSpans(project.lyrics, offset: project.settings.lyricOffset, raw: raw),
            headOffset: head,
            startOffset: head,
            notAfter: raw - outro - 0.8,
            fps: 60
        )
        guard cuts.count == project.photos.count - 1 else { return nil }
        var previous = head
        var segments: [PhotoSegment] = []
        for (index, cut) in cuts.enumerated() {
            guard cut.time > previous + 1e-6, cut.time < tail - 1e-6 else { return nil }
            segments.append(PhotoSegment(index: index, start: previous, end: cut.time, fade: transition.resolvedFade(hold: cut.time - previous)))
            previous = cut.time
        }
        guard tail > previous + 1e-6 else { return nil }
        segments.append(PhotoSegment(index: project.photos.count - 1, start: previous, end: tail, fade: transition.resolvedFade(hold: tail - previous)))
        return segments
    }

    private static func lyricSpans(_ lines: [LyricLine], offset: Double, raw: Double) -> [(Double, Double)]? {
        guard !lines.isEmpty else { return nil }
        return lines.enumerated().map { index, line in
            let start = min(raw, max(0, line.time + offset))
            let next = index + 1 < lines.count ? lines[index + 1].time + offset : start + 8
            let end = min(raw, max(start, next))
            return (start, end)
        }
    }

    func index(at time: Double) -> Int {
        segments.last(where: { time >= $0.start })?.index ?? 0
    }
}

enum DiaryError: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let message): return message } }
}

struct ExportJob: Codable, Sendable {
    var projectID: UUID
    var revision: Int
    var temporaryFile: String
    var completed: OutputVersion?
}
