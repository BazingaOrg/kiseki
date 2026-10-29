# Kiseki for iPhone

独立 SwiftUI App，从系统图库选择照片，在 iPhone 本机保存草稿、预览并导出 MP4 或 PNG。没有第三方运行时依赖；需要 Xcode 构建。

打开 `app/Kiseki.xcodeproj`，选择 `Kiseki` scheme。模拟器可直接运行；安装到 iPhone 时在 Signing & Capabilities 中选择自己的 Personal Team，并设置稳定、唯一的 Bundle ID。最低系统为 iOS 17。

- [实现状态与验证边界](docs/implementation-status.md)
- [iPhone 安装与验收步骤](docs/iphone-testing.md)
- [开发说明](docs/ios-development-guide.md)
- [环境与能力检查设计](docs/environment-readiness.md)
- [交互设计参考](docs/prototype.html)（浏览器打开即可点选；下一轮顺序见页内说明）

先在 Mac 执行 `./app/scripts/check-environment.sh`。构建和测试使用临时的 `DEVELOPER_DIR`，无需更改全局 Xcode 路径：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project app/Kiseki.xcodeproj -scheme Kiseki -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/kiseki-ios-build CODE_SIGNING_ALLOWED=NO build
```

运行测试时，把 destination 换成本机可用的模拟器 ID：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project app/Kiseki.xcodeproj -scheme Kiseki -destination 'platform=iOS Simulator,id=<SIMULATOR_ID>' -derivedDataPath /tmp/kiseki-ios-build CODE_SIGNING_ALLOWED=NO test
```

系统图库、文件和分享界面由 iOS 提供；实际原生界面见 `Kiseki/UI/`。HTML 原型只用于设计参考，不执行真实导出或检查。桌面端继续由仓库原有目录维护。
