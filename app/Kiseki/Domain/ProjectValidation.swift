import Foundation

struct ProjectValidation {
    static let maximumDuration = 1800.0
    static let maximumRevision = 1_000_000_000

    static func check(_ project: DiaryProject) throws {
        let settings = project.settings
        guard project.schemaVersion == 1,
              (0..<maximumRevision).contains(project.revision),
              settings.intensity.isFinite, (0...1).contains(settings.intensity),
              settings.filmStrength.isFinite, (0...1).contains(settings.filmStrength),
              settings.filmRoll.count <= 40,
              settings.photoSeconds.isFinite, (1...12).contains(settings.photoSeconds),
              settings.lyricOffset.isFinite, (-60...60).contains(settings.lyricOffset),
              settings.signature.count <= 80, settings.outro.count <= 80,
              project.title.count <= 120, validDate(project.created), validDate(project.modified),
              project.photos.count <= 500, project.lyrics.count <= 10000,
              Set(project.photos.map(\.id)).count == project.photos.count,
              project.photos.allSatisfy({ $0.caption.count <= 30 && $0.hint.count <= 40 && $0.camera.count <= 200 && ($0.date.map(validDate) ?? true) }),
              project.lyrics.allSatisfy({ validTime($0.time) && $0.text.count <= 2000 && ($0.translation?.count ?? 0) <= 2000 }),
              project.audio.map({ validTime($0.duration) && $0.duration > 0 && $0.title.count <= 500 }) ?? true,
              project.outputs.allSatisfy({ validTime($0.duration) && (0..<maximumRevision).contains($0.revision) && $0.title.count <= 120 && validDate($0.created) }) else {
            throw DiaryError.message("作品清单含有不支持的版本、时间或设置。原文件已保留。")
        }
    }

    static func validTime(_ value: Double) -> Bool { value.isFinite && (0...maximumDuration).contains(value) }
    static func secondsText(_ value: Double) -> String { validTime(value) ? String(Int(value)) : "—" }
    private static func validDate(_ date: Date) -> Bool { date.timeIntervalSinceReferenceDate.isFinite && date >= .distantPast && date <= .distantFuture }
}
