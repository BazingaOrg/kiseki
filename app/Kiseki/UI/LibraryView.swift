import SwiftUI
import PhotosUI
import AVKit
import ImageIO

struct Theme {
    static let inkBlue = Color(uiColor: UIColor { trait in trait.userInterfaceStyle == .dark ? UIColor(red: 0.66, green: 0.80, blue: 0.86, alpha: 1) : UIColor(red: 0.19, green: 0.34, blue: 0.42, alpha: 1) })
    static let paper = Color(uiColor: UIColor { trait in trait.userInterfaceStyle == .dark ? UIColor(red: 0.12, green: 0.14, blue: 0.15, alpha: 1) : UIColor(red: 1, green: 0.99, blue: 0.97, alpha: 1) })
}

struct DiaryHeading: View {
    let eyebrow: String
    let title: String
    let detail: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(eyebrow).font(.caption).tracking(2).foregroundStyle(.secondary)
            Text(title).font(.system(.largeTitle, design: .serif)).fontWeight(.regular)
            if !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 16)
    }
}

struct PhotoThumbnail: View {
    let url: URL?
    var height: CGFloat = 100
    var contentMode: ContentMode = .fill
    @State private var image: UIImage?
    var body: some View {
        ZStack {
            Rectangle().fill(.quaternary)
            if let image { Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode) }
            else { Image(systemName: "photo").foregroundStyle(.secondary) }
        }
        .frame(height: height).clipped().clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityHidden(true)
        .task(id: url) {
            guard let url else { image = nil; return }
            image = nil
            let decoded = await Task.detached(priority: .utility) {
                guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 700, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else { return nil as UIImage? }
                return UIImage(cgImage: cg)
            }.value
            guard !Task.isCancelled else { return }
            image = decoded
        }
    }
}

struct LibraryView: View {
    @EnvironmentObject var model: AppModel
    @State private var path: [UUID] = []
    @State private var picks: [PhotosPickerItem] = []
    @State private var settings = false
    @State private var deleting: DiaryProject?
    @State private var backupImport = false
    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    DiaryHeading(eyebrow: "光の記録 · PHOTO DIARY", title: "把这段日子，\n轻轻留下。", detail: "从几张照片开始，做一支属于自己的影像日记。")
                    if model.loading { ProgressView("正在打开日记") }
                    if let backupStatus = model.backupStatus { ProgressView(backupStatus) }
                    if !model.loading && model.projects.isEmpty {
                        ContentUnavailableView("日记从这里开始", systemImage: "photo.on.rectangle.angled", description: Text("从图库选照片，或先试做一篇示例。"))
                        Button("试做一篇示例") { Task { if let id = await model.makeSample() { path.append(id) } } }.buttonStyle(.bordered).frame(minHeight: 44)
                    }
                    ForEach(model.projects) { project in
                        NavigationLink(value: project.id) {
                            HStack(spacing: 16) {
                                PhotoThumbnail(url: project.photos.first.flatMap { model.file($0.file, project: project.id) }, height: 90).frame(width: 92)
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(project.title).font(.headline).foregroundStyle(.primary)
                                    Text("\(project.photos.count) 张照片 · \(project.outputs.count) 个成果").font(.caption).foregroundStyle(.secondary)
                                    Text(project.modified, style: .date).font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                            }.padding(12).background(.background, in: RoundedRectangle(cornerRadius: 16))
                        }.buttonStyle(.plain).contextMenu {
                            Button("删除这篇日记", role: .destructive) { deleting = project }
                                .disabled(model.locked(project.id))
                        }
                    }
                }.padding(.horizontal, 20).padding(.bottom, 20)
            }
            .background(Theme.paper)
            .navigationTitle("kiseki · 軌跡").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("设置", systemImage: "gearshape") { settings = true }.labelStyle(.iconOnly) }
                ToolbarItem(placement: .topBarLeading) { Button("恢复备份", systemImage: "square.and.arrow.down") { backupImport = true }.labelStyle(.iconOnly).disabled(model.loading || model.importing || model.rendering || model.captionProject != nil || model.backupStatus != nil) }
            }
            .safeAreaInset(edge: .bottom) {
                PhotosPicker(selection: $picks, maxSelectionCount: 100, selectionBehavior: .ordered, matching: .images) {
                    Text("从图库新建日记").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 14)
                }.buttonStyle(.borderedProminent).padding(.horizontal, 20).padding(.vertical, 10).background(.bar).disabled(model.loading || model.importing || model.rendering || model.captionProject != nil || model.backupStatus != nil)
            }
            .navigationDestination(for: UUID.self) { EditorView(id: $0) }
            .sheet(isPresented: $settings) { SettingsView() }
            .onChange(of: picks) { _, items in
                guard !items.isEmpty else { return }
                Task { if let id = await model.create() { path.append(id); model.importPhotos(items, into: id) }; picks = [] }
            }
            .confirmationDialog("删除“\(deleting?.title ?? "")”？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
                Button("删除日记与 App 内的素材", role: .destructive) { if let id = deleting?.id { Task { await model.removeProject(id) } }; deleting = nil }
            } message: { Text("系统图库中的原件不受影响。请先导出需要保留的草稿备份。") }
            .fileImporter(isPresented: $backupImport, allowedContentTypes: [.folder, .package]) { result in
                switch result {
                case .success(let url): Task { await model.restoreBackup(url) }
                case .failure(let error):
                    if (error as NSError).code != CocoaError.userCancelled.rawValue { model.notice = error.localizedDescription }
                }
            }
        }
    }
}
