import XCTest

final class FlowTests: XCTestCase {
    func testSampleCanExportFromNonlinearEditorAndOpenResults() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["从图库新建日记"].waitForExistence(timeout: 10))
        if app.buttons["试做一篇示例"].exists {
            app.buttons["试做一篇示例"].tap()
        } else {
            app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "海风与日光 · 示例")).firstMatch.tap()
        }
        app.buttons["照片"].tap()
        XCTAssertTrue(app.buttons["继续从图库添加"].isHittable)
        XCTAssertTrue(app.buttons["补齐旁白"].isHittable)
        XCTAssertTrue(app.buttons["照片顺序"].isHittable)
        app.buttons["画面"].tap()
        XCTAssertTrue(app.switches["显示图片旁白"].isHittable)
        XCTAssertFalse(app.staticTexts["呈现方式"].exists)
        XCTAssertFalse(app.buttons["暖胶片"].exists)
        let lookImage = XCTAttachment(screenshot: app.screenshot())
        lookImage.name = "Simplified image settings"
        lookImage.lifetime = .keepAlways
        add(lookImage)
        app.buttons["声音"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "无声影像")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["soundFeedback"].waitForExistence(timeout: 3))
        app.buttons["importMusic"].tap()
        let cancel = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel"])).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 8))
        let filePicker = XCTAttachment(screenshot: app.screenshot())
        filePicker.name = "Music file picker"
        filePicker.lifetime = .keepAlways
        add(filePicker)
        cancel.tap()
        let preview = app.buttons["预览"]
        XCTAssertTrue(preview.waitForExistence(timeout: 10))
        preview.tap()
        app.buttons["静态图"].tap()
        XCTAssertTrue(app.buttons["下一张照片"].waitForExistence(timeout: 5))
        let total = app.staticTexts["stillPhotoPosition"].label.components(separatedBy: "，共 ").last ?? ""
        XCTAssertFalse(total.isEmpty)
        app.buttons["下一张照片"].tap()
        XCTAssertEqual(app.staticTexts["stillPhotoPosition"].label, "第 2 张，共 \(total)")
        app.buttons["预览第 1 张照片"].tap()
        XCTAssertEqual(app.staticTexts["stillPhotoPosition"].label, "第 1 张，共 \(total)")
        let stillPicker = XCTAttachment(screenshot: app.screenshot())
        stillPicker.name = "Thumbnail still photo picker"
        stillPicker.lifetime = .keepAlways
        add(stillPicker)
        app.buttons["视频"].tap()
        let export = app.buttons["制作这支影像"]
        XCTAssertTrue(export.waitForExistence(timeout: 5))
        if !export.isHittable { app.swipeUp() }
        if export.frame.maxY > preview.frame.minY { app.swipeUp() }
        XCTAssertLessThanOrEqual(export.frame.maxY, preview.frame.minY)
        let previewImage = XCTAttachment(screenshot: app.screenshot())
        previewImage.name = "Native compact preview"
        previewImage.lifetime = .keepAlways
        add(previewImage)
        export.tap()
        XCTAssertTrue(app.navigationBars["已完成的日记"].waitForExistence(timeout: 90))
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "Native export results"
        image.lifetime = .keepAlways
        add(image)
    }
    func testPhotoCaptionDoneSavesAndEditorControlsAreNamed() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["从图库新建日记"].waitForExistence(timeout: 10))
        if app.buttons["试做一篇示例"].exists {
            app.buttons["试做一篇示例"].tap()
        } else {
            app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "海风与日光 · 示例")).firstMatch.tap()
        }
        app.buttons["照片"].tap()
        let firstPhoto = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "第 1 张照片")).firstMatch
        XCTAssertTrue(firstPhoto.waitForExistence(timeout: 5))
        firstPhoto.tap()
        let caption = app.textViews["为这张照片留一句话"]
        XCTAssertTrue(caption.waitForExistence(timeout: 5))
        caption.tap()
        let original = caption.value as? String ?? ""
        let expected = original == "回归旁白" ? "回归文字" : "回归旁白"
        if !original.isEmpty {
            caption.press(forDuration: 1.0)
            let selectAll = app.menuItems.matching(NSPredicate(format: "label IN %@", ["Select All", "全选"])).firstMatch
            XCTAssertTrue(selectAll.waitForExistence(timeout: 2))
            selectAll.tap()
        }
        caption.typeText(expected)
        app.buttons["完成"].tap()
        firstPhoto.tap()
        XCTAssertTrue(caption.waitForExistence(timeout: 5))
        XCTAssertEqual(caption.value as? String, expected)
        app.buttons["完成"].tap()
        app.buttons["画面"].tap()
        XCTAssertTrue(app.sliders["每张照片停留"].waitForExistence(timeout: 5))
        app.buttons["胶片"].tap()
        XCTAssertTrue(app.sliders["胶片强度"].waitForExistence(timeout: 5))
    }

    func testSettingsServicesAreReadableAndKeyEntryIsReachable() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["设置"].waitForExistence(timeout: 10))
        app.buttons["设置"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "图片旁白服务")).firstMatch.waitForExistence(timeout: 5))
        let settingsImage = XCTAttachment(screenshot: app.screenshot())
        settingsImage.name = "Grouped settings"
        settingsImage.lifetime = .keepAlways
        add(settingsImage)
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "图片旁白服务")).firstMatch.tap()
        XCTAssertTrue(app.secureTextFields["DeepSeek API Key"].waitForExistence(timeout: 5))
    }

}
