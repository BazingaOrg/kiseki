import SwiftUI
import PhotosUI
import AVKit
import UniformTypeIdentifiers
import ImageIO
import QuartzCore

enum EditorTab: String, CaseIterable {
    case photos, audio, look, preview
    var label: String { switch self { case .photos: return "照片"; case .audio: return "声音"; case .look: return "画面"; case .preview: return "预览" } }
    var icon: String { switch self { case .photos: return "photo.on.rectangle"; case .audio: return "music.note"; case .look: return "slider.horizontal.3"; case .preview: return "play.rectangle" } }
}

struct EditorView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    let id: UUID
    @State private var tab: EditorTab = .photos
    @State private var picks: [PhotosPickerItem] = []
    @State private var detail: DiaryPhoto?
    @State private var results = false
    @State private var lyrics = false
    @State private var fileImport = false
    @State private var importingLyrics = false
    @State private var soundFeedback: String?
    @State private var keySheet = false
    @State private var batchConsent = false
    @State private var backupURL: URL?
    @State private var player: AVPlayer?
    @State private var preview: UIImage?
    @State private var previewTime = 0.0
    @State private var still = false
    @State private var stillIndex = 0
    @State private var readiness: [ReadinessIssue]?
    @State private var rename = false
    @State private var draftName = ""
    @State private var playingPreview = false
    @State private var resumeAfterScrub = false
    @State private var cachedRenderer: FrameRenderer?
    @State private var cachedPlan: RenderPlan?
    @State private var cachedRevision = -1
    @State private var cachedStill: Bool?
    @State private var filmSheet = false
    @State private var dropTarget: UUID?
    @State private var auditioning = false
    @State private var previewLoading = false
    @State private var previewError: String?
    @State private var previewRetry = 0
    var project: DiaryProject { model.project(id) ?? DiaryProject() }
    var binding: Binding<DiaryProject> { Binding(get: { project }, set: { model.update($0) }) }
    var musicTimingDetail: String {
        if !project.settings.followMusic { return "已改为均匀安排。" }
        if project.beatTimes.count >= 4 { return "照片换在拍子上。算不出拍子时会改回均匀安排。" }
        return "这首歌暂时没能找出拍子，照片均匀安排。"
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if model.importing {
                    ProgressView(model.importProgress ?? "正在准备素材")
                    Button("取消导入") { model.cancelImport() }.editorHitTarget()
                }
                if let backupStatus = model.backupStatus {
                    ProgressView(backupStatus)
                }
                if model.renderingProject == id {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(model.exportMessage).font(.headline)
                        if model.exportIndeterminate {
                            ProgressView()
                        } else {
                            ProgressView(value: model.progress)
                        }
                        Text(model.exportIndeterminate ? "请保持 App 在前台" : "\(Int(model.progress * 100))% · 请保持 App 在前台").font(.caption).foregroundStyle(.secondary)
                        Button("取消制作", role: .destructive) { model.cancelExport() }.editorHitTarget()
                    }.padding().background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
                switch tab {
                case .photos: photosContent
                case .audio: audioContent
                case .look: lookContent
                case .preview: previewContent
                }
            }.padding(.horizontal, 20).padding(.bottom, 24)
        }
        .background(Theme.paper)
        .navigationTitle(project.title).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("查看成果", systemImage: "play.rectangle") { results = true }
                    Button("日记名字", systemImage: "pencil") { draftName = project.title; rename = true }.disabled(model.locked(id))
                    Button("导出草稿备份", systemImage: "square.and.arrow.up") { Task { backupURL = await model.backup(id) } }.disabled(model.locked(id))
                    Button("旁白服务设置", systemImage: "key") { keySheet = true }
                } label: { Image(systemName: "ellipsis").accessibilityLabel("更多操作") }
            }
        }
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 4) {
                ForEach(EditorTab.allCases, id: \.self) { item in
                    Button { tab = item; var next = project; next.lastTab = item.rawValue; model.update(next) } label: {
                        VStack(spacing: 5) { Image(systemName: item.icon); Text(item.label).font(.caption) }.frame(maxWidth: .infinity).padding(.vertical, 9)
                    }.foregroundStyle(tab == item ? Theme.inkBlue : Color.secondary)
                        .background(tab == item ? Theme.inkBlue.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 12))
                        .accessibilityAddTraits(tab == item ? .isSelected : [])
                }
            }.padding(.horizontal, 12).padding(.top, 5).background(.bar)
        }
        .onChange(of: model.rendering) { old, new in if old && !new && model.completedProject == id { results = true } }
        .onAppear { tab = EditorTab(rawValue: project.lastTab) ?? .photos }
        .onDisappear { pausePlayback() }
        .onChange(of: tab) { _, _ in dropTarget = nil; pausePlayback() }
        .onChange(of: still) { _, _ in pausePlayback() }
        .onChange(of: model.locked(id)) { _, locked in if locked { dropTarget = nil } }
        .onChange(of: scenePhase) { _, phase in if phase != .active { pausePlayback() } }
        .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime)) { notification in
            guard isCurrentPlaybackItem(notification) else { return }
            if playingPreview { previewTime = 0 }
            pausePlayback()
        }
        .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemFailedToPlayToEndTime)) { notification in
            guard isCurrentPlaybackItem(notification) else { return }
            pausePlayback()
            let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? NSError
            reportPlaybackFailure(error?.localizedDescription)
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in
            guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            if auditioning || playingPreview {
                pausePlayback()
                model.statusMessage = "音频已中断，播放已暂停。"
            }
        }
        .sheet(item: $detail) { PhotoDetailView(projectID: id, photoID: $0.id) }
        .sheet(isPresented: $results) { ResultsView(projectID: id) }
        .sheet(isPresented: $lyrics) { LyricsSearchView(projectID: id) }
        .sheet(isPresented: $keySheet) { KeySettingsView() }
        .sheet(isPresented: $filmSheet) {
            FilmLookSheet(settings: binding.settings, sourceURL: project.photos.first.flatMap { model.file($0.file, project: id) })
        }
        .sheet(item: Binding(get: { backupURL.map { ShareItem(url: $0) } }, set: { backupURL = $0?.url })) { ShareView(items: [$0.url]) }
        .alert("给这篇日记一个名字", isPresented: $rename) {
            TextField("名字", text: $draftName)
            Button("保存") { var next = project; next.title = String(draftName.prefix(60)); model.update(next) }
            Button("取消", role: .cancel) {}
        }
        .confirmationDialog("为缺少文字的照片生成旁白？", isPresented: $batchConsent) {
            Button("发送缩小预览并生成") { model.generateCaptions(id, photoID: nil) }
        } message: { Text("缩小后的照片预览会发送给 DeepSeek，原图不会上传。已有文字与手动修改会保留。") }
        .onChange(of: picks) { _, items in model.importPhotos(items, into: id); picks = [] }
        .fileImporter(isPresented: $fileImport, allowedContentTypes: importingLyrics ? [.plainText, .data] : [.audio]) { result in
            switch result {
            case .success(let url):
                pausePlayback()
                player = nil
                if importingLyrics { model.importLyrics(url, into: id) }
                else { model.importAudio(url, into: id) }
            case .failure(let error):
                if (error as NSError).code != CocoaError.userCancelled.rawValue { model.notice = error.localizedDescription }
            }
        }

    }

    var photosContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            DiaryHeading(eyebrow: "PHOTOS", title: "照片", detail: "长按拖动决定成片顺序；轻点照片，留下一句自己的话。")
            PhotosPicker(selection: $picks, maxSelectionCount: 100, selectionBehavior: .ordered, matching: .images) { Label("继续从图库添加", systemImage: "plus") }.buttonStyle(.bordered).disabled(model.locked(id)).editorHitTarget()
            HStack { Text("\(project.photos.filter { !$0.caption.isEmpty }.count) / \(project.photos.count) 张已有旁白").font(.subheadline); Spacer(); Button("补齐旁白") { batchConsent = true }.disabled(model.locked(id)).editorHitTarget() }
            if model.captionProject == id { ProgressView("正在写旁白"); Button("取消") { model.cancelCaptions() }.editorHitTarget() }
            Menu("照片顺序") {
                Button("按拍摄时间排列") { var next = project; next.photos.sort { ($0.date ?? .distantFuture) < ($1.date ?? .distantFuture) }; model.update(next) }
                Button("倒序排列") { var next = project; next.photos.reverse(); model.update(next) }
            }.disabled(model.locked(id)).editorHitTarget()
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 12) {
                ForEach(Array(project.photos.enumerated()), id: \.element.id) { index, photo in
                    Button { detail = photo } label: {
                        PhotoThumbnail(url: model.file(photo.file, project: id), height: 120)
                            .overlay(alignment: .topLeading) { Text("\(index + 1)").font(.caption).padding(6).background(.regularMaterial, in: Circle()).padding(6) }
                            .overlay(alignment: .bottomTrailing) { if !photo.caption.isEmpty { Image(systemName: "text.bubble.fill").padding(7).background(.regularMaterial, in: Circle()).padding(5) } }
                    }.buttonStyle(.plain)
                    .overlay {
                        if dropTarget == photo.id, !model.locked(id) {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Theme.inkBlue.opacity(0.12))
                                .overlay { RoundedRectangle(cornerRadius: 12).stroke(Theme.inkBlue, lineWidth: 3) }
                        }
                    }
                    .draggable(photo.id.uuidString)
                    .dropDestination(for: String.self) { values, _ in
                        dropTarget = nil
                        guard !model.locked(id), let source = values.first.flatMap(UUID.init(uuidString:)), let from = project.photos.firstIndex(where: { $0.id == source }), let to = project.photos.firstIndex(where: { $0.id == photo.id }), from != to else { return false }
                        var next = project
                        let item = next.photos.remove(at: from)
                        next.photos.insert(item, at: to)
                        model.update(next)
                        return true
                    } isTargeted: { targeted in
                        if model.locked(id) {
                            dropTarget = nil
                        } else if targeted {
                            dropTarget = photo.id
                        } else if dropTarget == photo.id {
                            dropTarget = nil
                        }
                    }
                    .accessibilityLabel("第 \(index + 1) 张照片，\(photo.caption.isEmpty ? "无旁白" : "已有旁白")")
                    .accessibilityAction(named: "移到前面") { movePhoto(index, by: -1) }
                    .accessibilityAction(named: "移到后面") { movePhoto(index, by: 1) }
                }
            }.disabled(model.locked(id))

        }
    }

    var audioContent: some View {
        VStack(alignment: .leading, spacing: 18) {
            DiaryHeading(eyebrow: "SOUND", title: "声音", detail: "可以无声，也可以让一首歌陪它走完。")
            Button {
                pausePlayback()
                player = nil
                var next = project
                next.audio = nil
                next.lyrics = []
                next.beatTimes = []
                next.beatEnergy = []
                next.beatOnset = []
                next.beatLowOnset = []
                model.update(next)
                soundFeedback = "已选择无声影像"
            } label: {
                soundOption("无声影像", detail: "只留下画面，不添加音乐", icon: "speaker.slash", selected: project.audio == nil)
            }.buttonStyle(.plain).accessibilityAddTraits(project.audio == nil ? .isSelected : [])
            Button {
                importingLyrics = false
                fileImport = true
                soundFeedback = nil
            } label: {
                soundOption("从“文件”导入音乐", detail: project.audio?.title ?? "选择手机或 iCloud Drive 中的音频", icon: "music.note", selected: project.audio != nil)
            }.buttonStyle(.plain).accessibilityIdentifier("importMusic").accessibilityAddTraits(project.audio != nil ? .isSelected : [])
            if let soundFeedback { Label(soundFeedback, systemImage: "checkmark.circle.fill").font(.subheadline).foregroundStyle(Theme.inkBlue).accessibilityIdentifier("soundFeedback") }

            if let audio = project.audio, let url = model.file(audio.file, project: id) {
                Text(audio.title).font(.headline)
                Text("\(ProjectValidation.secondsText(audio.duration)) 秒 · \(project.settings.followMusic && project.beatTimes.count >= 4 ? "跟着音乐" : "均匀安排")").font(.caption).foregroundStyle(.secondary)
                Button(auditioning ? "暂停试听" : "试听") { toggleAudition(url: url) }.editorHitTarget()
                Toggle("跟着音乐", isOn: binding.settings.followMusic)
                Text(musicTimingDetail).font(.footnote).foregroundStyle(.secondary)
                Toggle("使用整首音乐", isOn: binding.settings.fullAudio)
                Text("不使用整首音乐时，可在画面页调整每张照片的停留。").font(.footnote).foregroundStyle(.secondary)
                Divider()
                Text("歌词").font(.title3)
                HStack { Button("在线查找") { lyrics = true }.editorHitTarget(); Spacer(); Button("导入 LRC") { importingLyrics = true; fileImport = true }.editorHitTarget() }
                if !project.lyrics.isEmpty {
                    Picker("歌词显示", selection: binding.settings.lyricsMode) { ForEach(LyricsMode.allCases, id: \.self) { Text($0.label).tag($0) } }.pickerStyle(.segmented)
                    Stepper("整体偏移 \(project.settings.lyricOffset, specifier: "%.1f") 秒", value: binding.settings.lyricOffset, in: -60...60, step: 0.2)
                    Text("请试听手动校对。时长吻合不代表歌词与声音准确同步。").font(.footnote).foregroundStyle(.secondary)
                    Button("清除歌词", role: .destructive) { var next = project; next.lyrics = []; model.update(next) }.editorHitTarget()
                    ForEach(project.lyrics.prefix(100)) { line in
                        Button { startAudition(url: url, at: max(0, line.time + project.settings.lyricOffset)) } label: {
                            HStack(alignment: .top) { Text(ProjectValidation.secondsText(line.time)).font(.caption).monospacedDigit(); VStack(alignment: .leading) { Text(line.text); if let translation = line.translation { Text(translation).font(.caption).foregroundStyle(.secondary) } } }.frame(maxWidth: .infinity, alignment: .leading)
                        }.foregroundStyle(.primary).editorHitTarget()
                    }
                }
            }
        }.disabled(model.locked(id))
    }

    var lookContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            DiaryHeading(eyebrow: "IMAGE", title: "画面", detail: "留一点空白，让照片保持自己的气息。")
            Picker("画幅", selection: binding.settings.format) { ForEach(CanvasFormat.allCases, id: \.self) { Text($0.label).tag($0) } }.pickerStyle(.segmented)
            Picker("画面过渡", selection: binding.settings.transition) { ForEach(PhotoTransition.allCases, id: \.self) { Text($0.label).tag($0) } }.pickerStyle(.segmented)
            Text("相册淡入从换照片时开始；交叉溶解在换照片前后各一半；停留太短时改为直接切换。").font(.footnote).foregroundStyle(.secondary)
            Button { filmSheet = true } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("胶片").font(.headline)
                        Text("\(FilmGrade.name(of: project.settings.filmRoll)) · \(Int((project.settings.filmStrength * 100).rounded()))%")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            }.buttonStyle(.plain).accessibilityLabel("胶片").accessibilityValue("\(FilmGrade.name(of: project.settings.filmRoll))，强度 \(Int((project.settings.filmStrength * 100).rounded()))%")
            Text("保留照片原本的色彩，以留白和轻柔淡入连接画面。").font(.footnote).foregroundStyle(.secondary)
            Toggle("显示图片旁白", isOn: binding.settings.captions)
            Text("有旁白时显示；整篇没有旁白时，不预留文字区域。").font(.footnote).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 8) {
                HStack { Text("每张照片停留"); Spacer(); Text("\(project.settings.photoSeconds, specifier: "%.1f") 秒") }
                Slider(value: binding.settings.photoSeconds, in: 1...12, step: 0.5)
                    .accessibilityLabel("每张照片停留")
                    .accessibilityValue("\(project.settings.photoSeconds, specifier: "%.1f") 秒")
                Text(project.audio == nil ? "无声影像按这个节奏播放。" : project.settings.fullAudio ? "当前随整首音乐均分时长，此值用于无声影像。" : "当前按这个节奏安排照片，音乐随影像结束。").font(.footnote).foregroundStyle(.secondary)
            }
            DisclosureGroup("更多画面细节") {
                VStack(alignment: .leading, spacing: 16) {
                    Toggle("暗色画面", isOn: binding.settings.dark)
                    Text("只改变画面底色与文字，保留照片色彩。").font(.footnote).foregroundStyle(.secondary)
                    Toggle("EXIF 展签", isOn: binding.settings.exif)
                    Text("有拍摄日期或相机信息时显示。缺少的信息会略过。").font(.footnote).foregroundStyle(.secondary)
                    Toggle("片头", isOn: binding.settings.intro)
                    Toggle("开场快放", isOn: binding.settings.recap)
                    Toggle("日期章节", isOn: binding.settings.chapters)
                    Text("片头用于超过 8 秒的影像；快放需至少 8 张照片且时长充足；日期章节只在日期变化时出现。").font(.footnote).foregroundStyle(.secondary)
                    Toggle("照片上的签名落款", isOn: binding.settings.sign)
                    if project.settings.sign {
                        TextField("签名名字", text: binding.settings.signature).textFieldStyle(.roundedBorder)
                        Text("留空时不显示落款。").font(.footnote).foregroundStyle(.secondary)
                    }
                    TextField("片尾文字（留空不显示）", text: binding.settings.outro).textFieldStyle(.roundedBorder)
                }.padding(.top, 12)
            }

        }.disabled(model.locked(id))
    }

    var previewContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            DiaryHeading(eyebrow: "PREVIEW", title: "先看一眼", detail: "确认排版与声音，再在这台 iPhone 上完成。")
            Picker("输出方式", selection: $still) { Text("视频").tag(false); Text("静态图").tag(true) }.pickerStyle(.segmented)
            if still {
                stillPhotoPicker
            }
            if let readiness {
                ForEach(readiness) { issue in Label(issue.message, systemImage: issue.blocking ? "exclamationmark.circle" : "thermometer.medium").font(.subheadline).foregroundStyle(issue.blocking ? Color.red : .secondary) }
            }
            Button(model.rendering ? "正在制作…" : still ? "导出这张静态图" : "制作这支影像") {
                startExport()
            }.buttonStyle(.borderedProminent).controlSize(.large).frame(maxWidth: .infinity).disabled(model.locked(id))
            Button("查看已完成的作品") { results = true }.editorHitTarget()
            if let preview {
                Image(uiImage: preview).resizable().scaledToFit().frame(maxWidth: .infinity).frame(maxHeight: 300).clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel(still ? "静态图预览" : "影像预览")
            } else if project.photos.isEmpty {
                ContentUnavailableView("还没有可预览的照片", systemImage: "photo")
            } else if previewLoading || previewError == nil {
                ProgressView("正在生成预览")
            } else if let previewError {
                ContentUnavailableView {
                    Label("预览生成失败", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(previewError)
                } actions: {
                    Button("重试预览") {
                        previewLoading = true
                        self.previewError = nil
                        previewRetry += 1
                    }.editorHitTarget()
                }
            } else {
                ProgressView("正在生成预览")
            }
            if !still, let plan = cachedPlan, cachedRevision == project.revision, cachedStill == false {
                Button(playingPreview ? "暂停预览" : "播放预览", systemImage: playingPreview ? "pause.fill" : "play.fill") {
                    if playingPreview { pausePlayback() } else { startPreviewPlayback() }
                }.editorHitTarget()
                Slider(value: $previewTime, in: 0...max(0.1, plan.duration - 1.0 / 60), onEditingChanged: { editing in
                    if editing {
                        resumeAfterScrub = playingPreview
                        pausePlayback()
                    } else {
                        if resumeAfterScrub { startPreviewPlayback() }
                        resumeAfterScrub = false
                    }
                }) { Text("预览时间") }
                Text("\(Int(previewTime)) / \(Int(plan.duration)) 秒 · 1080p · 60 fps").font(.caption).foregroundStyle(.secondary)
            }

        }
        .task(id: playingPreview) {
            guard playingPreview, let plan = cachedPlan else { return }
            let startedAt = CACurrentMediaTime() - previewTime
            let usesAudioClock = project.audio != nil && player != nil
            while !Task.isCancelled {
                let elapsed = usesAudioClock ? player?.currentTime().seconds ?? previewTime : CACurrentMediaTime() - startedAt
                if elapsed.isFinite {
                    if elapsed >= plan.duration {
                        previewTime = 0
                        pausePlayback()
                        return
                    }
                    previewTime = max(0, elapsed)
                }
                try? await Task.sleep(nanoseconds: 16_666_667)
            }
        }
        .task(id: "\(project.revision)-\(still)-\(stillIndex)-\(Int(previewTime * 30))-\(previewRetry)") { await refreshPreview() }
    }

    func soundOption(_ title: String, detail: String, icon: String, selected: Bool) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).font(.title3).frame(width: 28).foregroundStyle(Theme.inkBlue)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.headline).foregroundStyle(.primary)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Image(systemName: selected ? "checkmark.circle.fill" : "circle").foregroundStyle(selected ? Theme.inkBlue : Color.secondary)
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Theme.inkBlue.opacity(0.08) : Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            .overlay { RoundedRectangle(cornerRadius: 16).stroke(selected ? Theme.inkBlue.opacity(0.5) : .clear, lineWidth: 1) }
            .contentShape(RoundedRectangle(cornerRadius: 16))
    }

    var stillPhotoPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(project.photos.isEmpty ? "还没有照片" : "第 \(stillIndex + 1) 张，共 \(project.photos.count) 张").font(.subheadline).monospacedDigit().accessibilityIdentifier("stillPhotoPosition")
                Spacer()
                Button { stillIndex = max(0, stillIndex - 1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.disabled(stillIndex == 0).accessibilityLabel("上一张照片")
                Button { stillIndex = min(project.photos.count - 1, stillIndex + 1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }.disabled(stillIndex >= project.photos.count - 1).accessibilityLabel("下一张照片")
            }
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 10) {
                        ForEach(Array(project.photos.enumerated()), id: \.element.id) { index, photo in
                            Button { stillIndex = index } label: {
                                PhotoThumbnail(url: model.file(photo.file, project: id), height: 64).frame(width: 64, height: 64).clipped().clipShape(RoundedRectangle(cornerRadius: 12))
                                    .overlay(alignment: .bottomLeading) { Text("\(index + 1)").font(.caption2).padding(4).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 5)).padding(4) }
                                    .padding(3)
                                    .overlay { RoundedRectangle(cornerRadius: 15).stroke(stillIndex == index ? Theme.inkBlue : .clear, lineWidth: 2) }
                            }.buttonStyle(.plain).id(index).accessibilityLabel("预览第 \(index + 1) 张照片").accessibilityAddTraits(stillIndex == index ? .isSelected : [])
                        }
                    }.padding(2)
                }
                .onChange(of: stillIndex) { _, index in proxy.scrollTo(index, anchor: .center) }
                .onAppear { proxy.scrollTo(stillIndex, anchor: .center) }
            }
        }
        .onChange(of: project.photos.count) { _, count in stillIndex = min(stillIndex, max(0, count - 1)) }
    }

    func startExport() {
        let plan: RenderPlan?
        if let cachedPlan, cachedRevision == project.revision, cachedStill == still {
            plan = cachedPlan
        } else {
            plan = try? RenderPlan(project: project, still: still)
        }
        let issues = ExportReadiness.check(project, directory: model.directory(id), video: !still, plan: plan)
        readiness = issues
        if let blocking = issues.first(where: \.blocking) {
            model.statusMessage = blocking.message
            return
        }
        pausePlayback()
        model.export(id, video: !still, stillIndex: stillIndex, plan: plan)
    }

    func refreshPreview() async {
        guard !project.photos.isEmpty else {
            preview = nil
            previewError = nil
            previewLoading = false
            return
        }
        if preview == nil && previewError == nil { previewLoading = true }
        do {
            let plan: RenderPlan
            let renderer: FrameRenderer
            if let cachedPlan, let cachedRenderer, cachedRevision == project.revision, cachedStill == still {
                plan = cachedPlan
                renderer = cachedRenderer
            } else {
                plan = try RenderPlan(project: project, still: still)
                renderer = FrameRenderer(plan: plan, directory: model.directory(id), resolutionLimit: 720)
                cachedPlan = plan
                cachedRenderer = renderer
                cachedRevision = project.revision
                cachedStill = still
            }
            preview = try renderer.image(at: min(previewTime, plan.duration), width: 360, stillIndex: still ? min(stillIndex, project.photos.count - 1) : nil)
            previewError = nil
        } catch {
            preview = nil
            previewError = error.localizedDescription
        }
        previewLoading = false
    }

    func toggleAudition(url: URL) {
        if auditioning { pausePlayback() } else { startAudition(url: url) }
    }

    func startAudition(url: URL, at seconds: Double = 0) {
        pausePlayback()
        model.statusMessage = nil
        let nextPlayer = AVPlayer(url: url)
        player = nextPlayer
        if seconds > 0 { nextPlayer.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)) }
        nextPlayer.play()
        auditioning = true
    }

    func startPreviewPlayback() {
        pausePlayback()
        model.statusMessage = nil
        if let audio = project.audio {
            guard let url = model.file(audio.file, project: id) else {
                reportPlaybackFailure("找不到音乐文件，请重新导入。")
                return
            }
            let nextPlayer = AVPlayer(url: url)
            player = nextPlayer
            nextPlayer.seek(to: CMTime(seconds: previewTime, preferredTimescale: 600))
            nextPlayer.play()
        } else {
            player = nil
        }
        playingPreview = true
    }

    func pausePlayback() {
        auditioning = false
        playingPreview = false
        player?.pause()
    }

    func isCurrentPlaybackItem(_ notification: Notification) -> Bool {
        guard let item = notification.object as? AVPlayerItem, let currentItem = player?.currentItem else { return false }
        return item === currentItem
    }

    func reportPlaybackFailure(_ detail: String? = nil) {
        let message = detail.map { "播放失败：\($0)" } ?? "播放失败，请重试。"
        model.statusMessage = message
    }

    func movePhoto(_ index: Int, by offset: Int) {
        let destination = index + offset
        guard project.photos.indices.contains(destination) else { return }
        var next = project
        next.photos.swapAt(index, destination)
        model.update(next)
    }
}

private struct FilmLookSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var settings: DiarySettings
    let sourceURL: URL?
    @State private var source: UIImage?
    @State private var holdingOriginal = false
    @State private var sourceLoading = false
    @State private var sourceFailed = false
    @State private var sourceRetry = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    preview
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("强度").font(.headline)
                            Spacer()
                            Text("\(Int((settings.filmStrength * 100).rounded()))%").font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
                        }
                        Slider(value: $settings.filmStrength, in: 0...1, step: 0.05)
                            .accessibilityLabel("胶片强度")
                            .accessibilityValue("\(Int((settings.filmStrength * 100).rounded()))%")
                        Text("强度为 0 时等于原片。").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(FilmGrade.rolls) { roll in
                        Button { settings.filmRoll = roll.id } label: {
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(roll.name).font(.system(.body, design: .serif))
                                    Text(roll.desc).font(.footnote).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 8)
                                Image(systemName: settings.filmRoll == roll.id ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(settings.filmRoll == roll.id ? Theme.inkBlue : Color.secondary)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(settings.filmRoll == roll.id ? Theme.inkBlue.opacity(0.08) : Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(settings.filmRoll == roll.id ? .isSelected : [])
                        .accessibilityLabel(roll.name)
                        .accessibilityHint(roll.desc)
                    }
                }.padding(20)
            }
            .background(Theme.paper)
            .navigationTitle("胶片")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
        .task(id: "\(sourceURL?.absoluteString ?? "")-\(sourceRetry)") {
            source = nil
            sourceFailed = false
            holdingOriginal = false
            guard sourceURL != nil else {
                sourceLoading = false
                return
            }
            sourceLoading = true
            await Task.yield()
            guard !Task.isCancelled else { return }
            source = Self.thumbnail(sourceURL)
            sourceFailed = source == nil
            sourceLoading = false
        }
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 8) {
            Group {
                if let shown = holdingOriginal ? source : previewImage {
                    Image(uiImage: shown).resizable().scaledToFit()
                        .accessibilityLabel(holdingOriginal ? "原图预览" : "胶片效果预览")
                } else if sourceURL == nil {
                    ContentUnavailableView("先添加一张照片", systemImage: "photo")
                } else if sourceLoading {
                    ProgressView("正在加载照片")
                } else if sourceFailed {
                    ContentUnavailableView {
                        Label("照片加载失败", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text("无法读取这张照片，请重试。")
                    } actions: {
                        Button("重新加载") { sourceRetry += 1 }.editorHitTarget()
                    }
                } else {
                    ProgressView("正在加载照片")
                }
            }
            .frame(maxWidth: .infinity)
            .frame(maxHeight: 240)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .onLongPressGesture(minimumDuration: 0.4, pressing: { holdingOriginal = $0 }, perform: {})
            if source != nil {
                Button(holdingOriginal ? "显示胶片效果" : "显示原图") {
                    holdingOriginal.toggle()
                    UIAccessibility.post(notification: .announcement, argument: holdingOriginal ? "正在显示原图" : "正在显示胶片效果")
                }.buttonStyle(.bordered).editorHitTarget()
                Text("也可以按住预览看原图。").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private var previewImage: UIImage? {
        guard let source else { return nil }
        return FilmGrade.apply(source, roll: settings.filmRoll, strength: settings.filmStrength)
    }

    private static func thumbnail(_ url: URL?) -> UIImage? {
        guard let url,
              let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: 600,
                kCGImageSourceCreateThumbnailWithTransform: true,
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}

private extension View {
    func editorHitTarget() -> some View {
        frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
    }
}
