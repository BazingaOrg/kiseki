# 本次验证记录

2026-10-19；Xcode 27.1，iOS 27.1 SDK，iPhone 13 mini 模拟器／iOS 26.5 runtime。真机 iOS 27.2 由用户后续验收。

## 最终候选

源码和测试均位于 `app/`；原仓库其他路径未修改。独立 QA 在源码不变的同一候选上执行：

```sh
./app/scripts/check-environment.sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project app/Kiseki.xcodeproj -scheme Kiseki -destination 'platform=iOS Simulator,id=F68B8BE9-3BF6-4360-8856-63AA52A2CCFF' -derivedDataPath /tmp/kiseki-ios-qa3 CODE_SIGNING_ALLOWED=NO test
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project app/Kiseki.xcodeproj -scheme Kiseki -configuration Release -destination 'generic/platform=iOS' -derivedDataPath /tmp/kiseki-ios-device3 CODE_SIGNING_ALLOWED=NO build
```

结果：环境脚本通过；19 项单元测试和 1 项 UI 测试通过；未签名真机架构 Release 构建通过。

本机原始结果：`/tmp/kiseki-ios-qa3/Logs/Test/Test-Kiseki-2026.10.19_21-14-02-+0800.xcresult`。临时目录不是长期归档。

- [编辑与预览截图](validation/native-preview.png)
- [成果截图](validation/native-results.png)
- [30 张／90 秒视频检查](validation/benchmark.json)：H.264、1920×1080、30 fps、2700 帧；无声合成示例。
- 单元测试另覆盖实际带音轨 MP4、PNG、字体、清单和恢复、备份校验、恶意数值与路径、LRC、文本布局及可选 Keychain 失败不阻塞启动。
- 人工通过系统图库导入测试图片，重复选择未增加张数；最终构建重开可见草稿，无全局 Keychain 错误弹窗。

## 体积与边界

构建目录：Debug 模拟器约 15 MB，未签名真机 Release 约 8.6 MB；不代表最终签名安装占用。没有第三方运行时和识别模型。照片副本、MP4 和备份按实际素材另占空间。

未测真机速度、峰值内存、温控、耗电、iCloud／HEIC／HDR、Personal Team 安装、真实 API Key、第三方分享目的地。LRCLIB 实际请求返回过 503，未证明线上成功。测试日志有非功能阻塞的 AppIntents 元数据跳过、测试图像读取 QoS 与诊断采集路径警告。

独立审查发现的备份打开入口、恢复临时文件回收、恶意数值溢出、文字区域重叠和可选 Keychain 阻塞均已修复并加入回归。

## 2026-10-20 界面收敛回归

使用相同模拟器执行完整 `xcodebuild test`，DerivedData 为 `/tmp/kiseki-ios-ui-simplify`：20 项单元测试和 1 项 UI 测试通过。新增覆盖新建作品默认值、旧样式清单仍可读取且统一渲染；UI 测试验证照片页三个操作首屏可点、简化画面页与视频导出闭环。

结果：`/tmp/kiseki-ios-ui-simplify/Logs/Test/Test-Kiseki-2026.10.20_09-32-06-+0800.xcresult`。本节候选未重跑真机架构 Release；上文 Release 体积是 10 月 19 日候选的记录。

[简化画面页](validation/native-look.png)；本目录预览与成果截图已更新为这次回归。模拟器已运行更新后的 App，已有素材和成果保留。

## 2026-10-20 声音与选片交互修复

完整测试：`/tmp/kiseki-ios-sound-fix/Logs/Test/Test-Kiseki-2026.10.20_10-21-16-+0800.xcresult`，20 项单元测试与 2 项 UI 测试通过。界面用例实际点击无声模式并检查确认状态，打开系统音乐文件选择器并取消，切换静态图前后照片及缩略图，再完成视频导出；另验证设置页和密钥输入入口可达。没有使用真实 Key，也没有在本次界面用例中选择用户的真实音乐文件。

截图检查后修正缩略图裁剪，并对最终 UI 重新执行 `-only-testing:KisekiUITests`。最终证据见下方补充。

最终 UI 复验通过 2 项测试、0 失败；结果为 `/tmp/kiseki-ios-sound-fix/Logs/Test/Test-Kiseki-2026.10.20_10-22-56-+0800.xcresult`。截图：[系统音乐文件选择器](validation/native-music-picker.png)、[静态图缩略图选片](validation/native-still-picker.png)、[设置页分组](validation/native-settings.png)。最终 App 已重新启动供用户验收。
