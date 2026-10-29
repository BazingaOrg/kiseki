import SwiftUI
import AVKit

struct PhotoDetailView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let projectID: UUID
    let photoID: UUID
    @State private var caption = ""
    @State private var hint = ""
    @State private var consent = false
    @State private var remove = false
    @State private var discard = false
    var project: DiaryProject? { model.project(projectID) }
    var photo: DiaryPhoto? { project?.photos.first { $0.id == photoID } }
    var hasChanges: Bool { caption != (photo?.caption ?? "") || hint != (photo?.hint ?? "") }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let photo {
                        PhotoThumbnail(url: model.file(photo.file, project: projectID), height: 280, contentMode: .fit)
                            .accessibilityHidden(false)
                            .accessibilityLabel("照片全尺寸预览")
                        if let date = photo.date { Text(date, style: .date).font(.caption).foregroundStyle(.secondary) }
                        if !photo.camera.isEmpty { Text(photo.camera).font(.caption).foregroundStyle(.secondary) }
                        Text("为这张照片留一句话").font(.headline)
                        TextEditor(text: $caption)
                            .frame(minHeight: 90)
                            .padding(8)
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                            .accessibilityLabel("为这张照片留一句话")
                        Text("\(caption.count) / 30").font(.caption).foregroundStyle(caption.count > 30 ? .red : .secondary)
                        Button("保存文字") { saveText() }
                            .buttonStyle(.borderedProminent)
                            .disabled(caption.count > 30 || model.locked(projectID))
                            .detailButtonHitTarget()
                        TextField("给 AI 的线索：人物、地点等（选填）", text: $hint).textFieldStyle(.roundedBorder)
                        Button(photo.caption.isEmpty ? "生成图片旁白" : "重新生成旁白") { consent = true }
                            .disabled(model.locked(projectID))
                            .detailButtonHitTarget()
                        Text("重写会替换这张照片已保存的旁白。已有文字不需要 API Key。").font(.footnote).foregroundStyle(.secondary)
                        Button("导出这张静态图") {
                            if let i = project?.photos.firstIndex(where: { $0.id == photoID }) { model.export(projectID, video: false, stillIndex: i); dismiss() }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.locked(projectID))
                        .detailButtonHitTarget()
                        Button("从本作品移除照片", role: .destructive) { remove = true }
                            .disabled(model.locked(projectID))
                            .detailButtonHitTarget()
                    }
                }.padding(20)
            }.background(Theme.paper)
            .navigationTitle("这张照片").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { if hasChanges { discard = true } else { dismiss() } }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { if hasChanges { saveText() } else { dismiss() } }
                        .disabled(hasChanges && (caption.count > 30 || model.locked(projectID)))
                }
            }
            .interactiveDismissDisabled(hasChanges)
            .onAppear { caption = photo?.caption ?? ""; hint = photo?.hint ?? "" }
            .confirmationDialog("放弃未保存的修改？", isPresented: $discard) {
                Button("放弃修改", role: .destructive) { dismiss() }
                Button("继续编辑", role: .cancel) {}
            } message: { Text("已修改的旁白或线索尚未保存。") }
            .confirmationDialog("生成图片旁白？", isPresented: $consent) {
                Button("发送缩小预览并生成") { model.generateCaptions(projectID, photoID: photoID, hint: hint); dismiss() }
                    .disabled(model.locked(projectID))
            } message: { Text("缩小后的照片预览会发送给 DeepSeek，原图不会上传。重写会替换已保存的文字。") }
            .confirmationDialog("只从本作品移除？", isPresented: $remove) {
                Button("移除照片", role: .destructive) { if var project { project.photos.removeAll { $0.id == photoID }; model.update(project); dismiss() } }
                    .disabled(model.locked(projectID))
            } message: { Text("系统图库中的原件仍会保留。") }
        }
    }
    func saveText() {
        guard var project, let i = project.photos.firstIndex(where: { $0.id == photoID }), caption.count <= 30, !model.locked(projectID) else { return }
        project.photos[i].caption = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        project.photos[i].edited = true
        project.photos[i].hint = String(hint.prefix(40))
        model.update(project)
        dismiss()
    }
}

struct LyricsSearchView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let projectID: UUID
    @State private var query = ""
    @State private var candidates: [LyricsCandidate] = []
    @State private var selected: LyricsCandidate?
    @State private var busy = false
    @State private var error: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var searchID = UUID()
    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("歌名或歌手", text: $query).submitLabel(.search).onSubmit { search() }
                    Button(busy ? "正在查找…" : "查找歌词") { search() }.disabled(query.trimmingCharacters(in: .whitespaces).isEmpty)
                    if let error { Text(error).foregroundStyle(.red) }
                } footer: { Text("来源 LRCLIB。先预览歌词，再确认使用；时长吻合不代表自动校对通过。") }
                ForEach(candidates) { candidate in
                    Button { selected = candidate } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(candidate.trackName).foregroundStyle(.primary)
                            Text("\(candidate.artistName) · \(ProjectValidation.secondsText(candidate.duration)) 秒").font(.caption).foregroundStyle(.secondary)
                            if let duration = model.project(projectID)?.audio?.duration {
                                let difference = abs(duration - candidate.duration)
                                HStack(spacing: 5) {
                                    if difference > 3 { Image(systemName: "exclamationmark.triangle.fill").accessibilityHidden(true) }
                                    Text(difference > 3 ? "时长差 \(difference, specifier: "%.1f") 秒，超过 3 秒，请手动校对" : "与本地音频差 \(difference, specifier: "%.1f") 秒")
                                }
                                .font(.caption)
                                .foregroundStyle(difference > 3 ? .orange : .secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("找歌词").toolbar { Button("完成") { dismiss() } }
            .onAppear { query = model.project(projectID)?.audio?.title ?? "" }
            .onDisappear { searchTask?.cancel() }
            .sheet(item: $selected) { candidate in
                NavigationStack {
                    List {
                        Section { Text(candidate.trackName).font(.headline); Text(candidate.artistName); Text("LRCLIB · 请试听手动校对").font(.caption) }
                        ForEach(LyricsParser.parse(candidate.syncedLyrics ?? "")) { line in VStack(alignment: .leading) { Text(line.text); if let translation = line.translation { Text(translation).font(.caption).foregroundStyle(.secondary) } } }
                    }.navigationTitle("校对歌词").toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("取消") { selected = nil } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("使用") {
                                if var project = model.project(projectID) { project.lyrics = LyricsParser.parse(candidate.syncedLyrics ?? ""); model.update(project); selected = nil; dismiss() }
                            }.disabled(LyricsParser.parse(candidate.syncedLyrics ?? "").isEmpty || LyricsParser.parse(candidate.syncedLyrics ?? "").count > 10000 || model.locked(projectID))
                        }
                    }
                }
            }
        }
    }
    func search() {
        searchTask?.cancel()
        let current = UUID()
        searchID = current
        let text = query
        busy = true
        error = nil
        searchTask = Task {
            do {
                let result = try await LyricsService.search(query: text)
                guard !Task.isCancelled, searchID == current else { return }
                model.lyricsStatus = "最近查询成功"
                candidates = Array(result.filter { $0.syncedLyrics != nil }.prefix(30))
                if candidates.isEmpty { error = "没有找到带时间的歌词，可以换个关键词或导入 LRC。" }
            } catch { if !Task.isCancelled && searchID == current { self.error = error.localizedDescription; model.lyricsStatus = error.localizedDescription } }
            if searchID == current { busy = false }
        }
    }
}

struct ShareItem: Identifiable {
    let url: URL
    var id: URL { url }
}
struct ShareView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct ResultsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let projectID: UUID
    @State private var selected: OutputVersion?
    @State private var share: ShareItem?
    @State private var deleting: OutputVersion?
    @State private var renaming: OutputVersion?
    @State private var name = ""
    var outputs: [OutputVersion] { model.project(projectID).map { Array($0.outputs.reversed()) } ?? [] }
    var body: some View {
        NavigationStack {
            List {
                if outputs.isEmpty { ContentUnavailableView("还没有完成的作品", systemImage: "photo.stack", description: Text("在预览页制作视频，或导出一张静态图。")) }
                ForEach(outputs) { output in
                    Button { selected = output } label: {
                        HStack { Image(systemName: output.video ? "play.rectangle" : "photo"); VStack(alignment: .leading) { Text(output.title).foregroundStyle(.primary); Text(output.created, style: .date).font(.caption).foregroundStyle(.secondary) } }
                    }.contextMenu {
                        Button("重命名") { renaming = output; name = output.title }
                            .disabled(model.locked(projectID))
                        Button("删除这个版本", role: .destructive) { deleting = output }
                            .disabled(model.locked(projectID))
                    }
                }
            }.navigationTitle("已完成的日记").toolbar { Button("完成") { dismiss() } }
            .sheet(item: $selected) { output in
                NavigationStack {
                    VStack(spacing: 20) {
                        if let url = model.file(output.file, project: projectID), FileManager.default.fileExists(atPath: url.path) {
                            if output.video {
                                VideoPlayer(player: AVPlayer(url: url))
                                    .accessibilityLabel("视频成果预览")
                            } else {
                                PhotoThumbnail(url: url, height: 400, contentMode: .fit)
                                    .accessibilityHidden(false)
                                    .accessibilityLabel("静态成果预览")
                            }
                            HStack {
                                Button("保存到照片") { Task { await model.saveToPhotos(url, video: output.video) } }
                                    .disabled(model.locked(projectID))
                                    .detailButtonHitTarget()
                                Spacer()
                                Button("分享") { share = ShareItem(url: url) }
                                    .disabled(model.locked(projectID))
                                    .detailButtonHitTarget()
                            }.padding()
                        } else {
                            ContentUnavailableView(
                                "找不到成果文件",
                                systemImage: "exclamationmark.triangle",
                                description: Text("文件可能已被移动或删除。请返回预览页重新导出；原照片和编辑草稿仍会保留。")
                            )
                        }
                    }.navigationTitle(output.title).navigationBarTitleDisplayMode(.inline).toolbar { Button("完成") { selected = nil } }
                        .sheet(item: $share) { ShareView(items: [$0.url]) }
                }
                .overlay(alignment: .bottom) {
                    if let statusMessage = model.statusMessage { StatusBanner(message: statusMessage).padding() }
                }
            }
            .confirmationDialog("删除这个导出版本？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
                Button("删除版本", role: .destructive) { if let deleting { model.deleteOutput(deleting, from: projectID) }; deleting = nil }
                    .disabled(model.locked(projectID))
            } message: { Text("原照片和编辑草稿仍会保留。") }
            .alert("重命名版本", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("名字", text: $name)
                Button("保存") { if var project = model.project(projectID), let index = project.outputs.firstIndex(where: { $0.id == renaming?.id }) { project.outputs[index].title = String(name.prefix(80)); model.update(project) }; renaming = nil }
                    .disabled(model.locked(projectID))
                Button("取消", role: .cancel) { renaming = nil }
            }
        }
        .overlay(alignment: .bottom) {
            if let statusMessage = model.statusMessage { StatusBanner(message: statusMessage).padding() }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var key = false
    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("日记，留在这台 iPhone", systemImage: "iphone").font(.headline)
                        Text("照片整理与出片在本机完成。在线服务只在需要时连接。").font(.subheadline).foregroundStyle(.secondary)
                    }.padding(.vertical, 6)
                }
                Section {
                    Button { key = true } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "key").foregroundStyle(Theme.inkBlue)
                            VStack(alignment: .leading, spacing: 5) {
                                Text("图片旁白服务").foregroundStyle(.primary)
                                Text(model.configuredKey ? "管理 DeepSeek API Key" : "配置 DeepSeek API Key").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 4)
                    }
                    serviceStatus("图片旁白", status: model.captionStatus, icon: "text.bubble")
                    serviceStatus("歌词 · LRCLIB", status: model.lyricsStatus, icon: "music.note.list")
                } header: { Text("旁白与歌词") } footer: {
                    Text("歌词搜索时才联网；生成旁白前会请你确认发送缩小预览。密钥保存在本机钥匙串，不随草稿备份。")
                }
                Section {
                    LabeledContent("日记", value: "\(model.projects.count) 篇")
                    LabeledContent("制作状态", value: model.rendering ? "正在制作" : "空闲")
                    LabeledContent("iOS", value: UIDevice.current.systemVersion)
                    LabeledContent("电源模式", value: ProcessInfo.processInfo.isLowPowerModeEnabled ? "低电量模式" : "标准模式")
                } header: { Text("本机状态") } footer: {
                    Text("每次制作前会检查素材、时长、空间和温度。本机出片无需网络。")
                }
                Section("存储与备份") {
                    if let capacity = try? model.root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage {
                        LabeledContent("设备可用空间", value: ByteCountFormatter.string(fromByteCount: capacity, countStyle: .file))
                    }
                    Button { Task { await model.cleanUnused() } } label: { Label("清理未使用的素材与临时文件", systemImage: "sparkles") }
                        .disabled(model.loading || model.importing || model.rendering || model.captionProject != nil || model.backupStatus != nil)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("备份你的日记").font(.subheadline)
                        Text("进入日记，点右上角 ··· 导出草稿备份；首页左上角可恢复。卸载 App 前请先备份。").font(.footnote).foregroundStyle(.secondary)
                    }.padding(.vertical, 4)
                }
                Section {
                    DisclosureGroup("当前支持的声音功能") {
                        Text("支持本地音乐、LRC 与在线查找歌词；暂不支持在线获取音乐、自动踩点或离线识别，不占用识别模型存储。").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Theme.paper)
            .navigationTitle("设置").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
            .sheet(isPresented: $key) { KeySettingsView() }

        }
        .overlay(alignment: .bottom) {
            if let statusMessage = model.statusMessage { StatusBanner(message: statusMessage).padding() }
        }
    }
    func serviceStatus(_ title: String, status: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).frame(width: 20).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.subheadline)
                Text(status).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }.padding(.vertical, 4)
    }

}

struct KeySettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var key = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("DeepSeek API Key", text: $key).textContentType(.password).autocorrectionDisabled().textInputAutocapitalization(.never)
                    Button("保存到本机钥匙串") {
                        do { try model.saveKey(key); key = ""; dismiss() } catch { model.notice = error.localizedDescription }
                    }.disabled(key.trimmingCharacters(in: .whitespaces).isEmpty)
                    if model.configuredKey { Button("移除已保存的 Key", role: .destructive) { do { try model.removeKey(); dismiss() } catch { model.notice = error.localizedDescription } } }
                } footer: { Text("密钥不写入作品或备份；保存不代表服务验证成功。生成图片旁白会发送缩小后的照片预览并可能产生 API 费用。") }
            }.navigationTitle("旁白服务").toolbar { Button("完成") { key = ""; dismiss() } }
        }
    }
}

private extension View {
    func detailButtonHitTarget() -> some View {
        frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
    }
}
