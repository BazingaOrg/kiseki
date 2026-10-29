import SwiftUI
import UIKit

struct StatusBanner: View {
    let message: String
    var body: some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(Theme.inkBlue)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            .accessibilityElement(children: .combine)
            .allowsHitTesting(false)
    }
}

@main
struct KisekiApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environmentObject(model)
                .tint(Theme.inkBlue)
                .task {
                    await model.load()
                    if let pending = model.pendingBackupURL { model.pendingBackupURL = nil; await model.restoreBackup(pending) }
                    let arguments = ProcessInfo.processInfo.arguments
                    if arguments.contains("--smoke-export") || arguments.contains("--benchmark-export") {
                        if let id = await model.makeSample(benchmark: arguments.contains("--benchmark-export")) { model.export(id, video: true) }
                    }
                }
                .onOpenURL { model.receiveBackup($0) }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background { model.cancelExport() }
                }
                .overlay(alignment: .bottom) {
                    if let statusMessage = model.statusMessage {
                        StatusBanner(message: statusMessage)
                            .padding(.horizontal, 20)
                            .padding(.bottom, 76)
                    }
                }
                .task(id: model.statusMessage) {
                    guard let message = model.statusMessage else { return }
                    do { try await Task.sleep(nanoseconds: 4_000_000_000) } catch { return }
                    guard model.statusMessage == message else { return }
                    model.statusMessage = nil
                }
                .onChange(of: model.statusMessage) { _, message in
                    if let message { UIAccessibility.post(notification: .announcement, argument: message) }
                }
                .alert("kiseki", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })) {
                    Button("知道了", role: .cancel) { model.notice = nil }
                } message: { Text(model.notice ?? "") }
        }
    }
}
