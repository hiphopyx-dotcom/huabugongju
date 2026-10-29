import Cocoa
import Security
import UniformTypeIdentifiers

private let appName = "剧爆棚图片工作端"
private let service = "com.jubaopeng.image-worker.model-key"
private let account = "primary"
private let origins = ["https://unfair-pony-d7gvmlx4ne8e8796a-1515553937.ap-shanghai.app.tcloudbase.com", "https://jubaopeng-canvas.vercel.app"]

private enum LocalError: Error { case invalid, keychain, runtime }
private func keychainQuery() -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
private func hasKey() -> Bool {
    var query = keychainQuery(); query[kSecReturnAttributes as String] = true
    return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
}
private func saveKey(_ value: String) throws {
    let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !key.isEmpty, key.utf8.count <= 16384, key.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil else { throw LocalError.invalid }
    let query = keychainQuery(), data = Data(key.utf8)
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
        var item = query; item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw LocalError.keychain }
    } else if status != errSecSuccess { throw LocalError.keychain }
}
private func readKey() throws -> String {
    var query = keychainQuery(); query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8), !value.isEmpty else { throw LocalError.keychain }
    return value
}
private func validateConfig(_ data: Data) throws {
    guard data.count <= 16384, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], Set(object.keys) == Set(["format", "origin", "workerId", "workerToken"]), object["format"] as? String == "jbp-mac-image-worker-v1", object["workerId"] as? String == "primary", let origin = object["origin"] as? String, origins.contains(origin), let token = object["workerToken"] as? String, token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw LocalError.invalid }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let configLabel = NSTextField(labelWithString: "尚未导入网站连接文件")
    private let keyLabel = NSTextField(labelWithString: "")
    private let keyField = NSSecureTextField()
    private let statusLabel = NSTextField(wrappingLabelWithString: "未启动。请导入连接文件，并在本机保存模型密钥。")
    private let logView = NSTextView()
    private let startButton = NSButton(title: "启动工作端", target: nil, action: nil)
    private let stopButton = NSButton(title: "停止", target: nil, action: nil)
    private let videoButton = NSButton(title: "测试视频（3秒）", target: nil, action: nil)
    private var importButton: NSButton!
    private var saveButton: NSButton!
    private var worker: Process?
    private var outputPipe: Pipe?
    private var quitting = false
    private var outputRemainder = ""
    private var lastStatus = ""
    private var stoppedByUser = false
    private let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("JubaopengImageWorker", isDirectory: true)
    private var connection: URL { folder.appendingPathComponent("connection.json") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow(); refreshSavedState(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    private func buildWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 660, height: 660), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = appName; window.minSize = NSSize(width: 660, height: 660); window.center(); window.isReleasedWhenClosed = false
        let title = NSTextField(labelWithString: appName); title.font = .boldSystemFont(ofSize: 23)
        let intro = NSTextField(wrappingLabelWithString: "让这台 Mac 处理网站图片任务。保持本应用运行、电脑开机且联网；模型密钥仅保存在本机钥匙串。")
        intro.textColor = .secondaryLabelColor
        importButton = NSButton(title: "导入网站连接文件…", target: self, action: #selector(importConnection))
        saveButton = NSButton(title: "保存到本机钥匙串", target: self, action: #selector(saveModelKey))
        keyField.placeholderString = "在这里粘贴模型 API 密钥"; keyField.font = .systemFont(ofSize: 13); keyField.lineBreakMode = .byClipping
        startButton.target = self; startButton.action = #selector(start); stopButton.target = self; stopButton.action = #selector(stop); stopButton.isEnabled = false
        startButton.bezelStyle = .rounded; startButton.keyEquivalent = "\r"
        videoButton.target = self; videoButton.action = #selector(videoTest)
        let buttons = NSStackView(views: [startButton, stopButton, videoButton]); buttons.orientation = .horizontal; buttons.spacing = 12
        let importRow = NSStackView(views: [importButton, configLabel]); importRow.orientation = .horizontal; importRow.spacing = 12
        let saveRow = NSStackView(views: [saveButton, keyLabel]); saveRow.orientation = .horizontal; saveRow.spacing = 12
        let modelTitle = NSTextField(labelWithString: "模型密钥（只在本机填写）"); modelTitle.font = .boldSystemFont(ofSize: 13)
        let note = NSTextField(wrappingLabelWithString: "启动先检查连接，成功后自动领取网站提交的图片任务。每个任务最多请求模型一次；断线后回传已有结果，不会自动重复生成。")
        note.textColor = .secondaryLabelColor; note.font = .systemFont(ofSize: 12)
        logView.isEditable = false; logView.isSelectable = true; logView.font = .systemFont(ofSize: 12); logView.textContainerInset = NSSize(width: 8, height: 8)
        let scroll = NSScrollView(); scroll.documentView = logView; scroll.hasVerticalScroller = true; scroll.borderType = .bezelBorder
        let stack = NSStackView(views: [title, intro, importRow, modelTitle, keyField, saveRow, buttons, statusLabel, note, scroll])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14; stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 26), stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -26), stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24), stack.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor, constant: -24), keyField.widthAnchor.constraint(equalTo: stack.widthAnchor), intro.widthAnchor.constraint(equalTo: stack.widthAnchor), statusLabel.widthAnchor.constraint(equalTo: stack.widthAnchor), note.widthAnchor.constraint(equalTo: stack.widthAnchor), scroll.widthAnchor.constraint(equalTo: stack.widthAnchor), scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 100)])
        let menu = NSMenu(); let item = NSMenuItem(); menu.addItem(item); let appMenu = NSMenu(); item.submenu = appMenu; appMenu.addItem(withTitle: "退出" + appName, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); NSApp.mainMenu = menu
    }
    private func prepareFolder() throws { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]); try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: folder.path) }
    private func refreshSavedState() {
        if let data = try? Data(contentsOf: connection), (try? validateConfig(data)) != nil { configLabel.stringValue = "已导入网站连接文件" } else { configLabel.stringValue = "尚未导入有效连接文件" }
        keyLabel.stringValue = hasKey() ? "已保存；密钥不会显示" : "尚未保存"
    }
    private func show(_ message: String) { let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "知道了"); alert.beginSheetModal(for: window) }
    @objc private func importConnection() {
        guard worker == nil else { return }
        let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false; panel.allowedContentTypes = [.json]; panel.message = "选择在网站管理员页面下载的图片工作端连接 JSON 文件。"
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .OK, let url = panel.url else { return }
            do { let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0; guard size <= 16384 else { throw LocalError.invalid }; let data = try Data(contentsOf: url); try validateConfig(data); try self.prepareFolder(); try data.write(to: self.connection, options: [.atomic, .completeFileProtection]); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: self.connection.path); self.refreshSavedState(); self.statusLabel.stringValue = "连接文件已保存。填写密钥后，可启动工作端。" }
            catch { self.show("连接文件无效或无法保存。请在网站管理员页面重新下载连接文件。") }
        }
    }
    @objc private func saveModelKey() {
        guard worker == nil else { return }
        do { try saveKey(keyField.stringValue); keyField.stringValue = ""; refreshSavedState(); statusLabel.stringValue = "密钥已保存到本机钥匙串。可以启动工作端。" }
        catch { show("密钥未保存。请检查输入，并允许本应用访问钥匙串。") }
    }
    @objc private func start() {
        guard worker == nil else { return }
        guard keyField.stringValue.isEmpty else { show("请先点击“保存到本机钥匙串”，再启动工作端。"); return }
        do {
            try validateConfig(Data(contentsOf: connection)); try prepareFolder()
            let key = try readKey()
            guard let node = ["/usr/local/bin/node", "/opt/homebrew/bin/node"].first(where: { FileManager.default.isExecutableFile(atPath: $0) }), let script = Bundle.main.url(forResource: "worker", withExtension: "mjs") else { throw LocalError.runtime }
            let process = Process(); process.executableURL = URL(fileURLWithPath: node); process.arguments = [script.path, connection.path]
            let inherited = ProcessInfo.processInfo.environment
            var environment = [String: String](); for name in ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL"] { if let value = inherited[name] { environment[name] = value } }
            environment["PATH"] = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"; environment["XAI_API_KEY"] = key; process.environment = environment
            let pipe = Pipe(); outputPipe = pipe; process.standardOutput = pipe; process.standardError = pipe
            outputRemainder = ""; logView.string = ""; lastStatus = ""; stoppedByUser = false
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData; guard !data.isEmpty else { return }
                let text = String(data: data, encoding: .utf8) ?? ""
                DispatchQueue.main.async { self?.appendOutput(text) }
            }
            process.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.didStop() } }
            try process.run(); worker = process; setRunning(true); statusLabel.stringValue = "正在核对已保存回执并检查模型连接…"
        } catch { outputPipe?.fileHandleForReading.readabilityHandler = nil; outputPipe = nil; show("无法启动。请检查连接文件、本机密钥和 Node.js 是否可用。") }
    }
    private func appendOutput(_ text: String) {
        // Child output is limited to fixed, generic status messages by worker.mjs.
        outputRemainder += text
        let lines = outputRemainder.split(separator: "\n", omittingEmptySubsequences: false); outputRemainder = String(lines.last ?? "").suffix(1000).description
        for line in lines.dropLast() { let safe = String(line).prefix(300); logView.string += safe + "\n"; if !safe.isEmpty { lastStatus = String(safe); statusLabel.stringValue = lastStatus } }
        if logView.string.count > 8000 { logView.string = String(logView.string.suffix(8000)) }; logView.scrollToEndOfDocument(nil)
    }
    @objc private func videoTest() {
        guard worker == nil else { return }
        guard keyField.stringValue.isEmpty else { show("请先把密钥保存到本机钥匙串。"); return }
        let alert = NSAlert(); alert.messageText = "一次短视频测试"
        alert.informativeText = "使用本机保存的模型密钥，测试生成1条3秒、480p、16:9静物视频。按当前公开价格预计0.06美元，预算0.10美元；只提交一次，不自动重试。已有测试任务只补查结果。\n\n这只验证模型账号能否出视频，网站自动生成和回传尚未接通。"
        alert.addButton(withTitle: "同意预算，测试一次"); alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { [weak self] response in
            if response == .alertFirstButtonReturn { self?.launchVideoTest() }
        }
    }
    private func launchVideoTest() {
        guard worker == nil else { return }
        do {
            try prepareFolder(); let key = try readKey()
            guard let node = ["/usr/local/bin/node", "/opt/homebrew/bin/node"].first(where: { FileManager.default.isExecutableFile(atPath: $0) }), let script = Bundle.main.url(forResource: "video-smoke", withExtension: "mjs") else { throw LocalError.runtime }
            let process = Process(); process.executableURL = URL(fileURLWithPath: node); process.arguments = [script.path, folder.appendingPathComponent("video-test").path, "one-3s-480p-usd0.10"]
            var environment = [String: String](); let inherited = ProcessInfo.processInfo.environment
            for name in ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL"] { if let value = inherited[name] { environment[name] = value } }
            environment["PATH"] = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"; environment["XAI_API_KEY"] = key; process.environment = environment
            let pipe = Pipe(); outputPipe = pipe; process.standardOutput = pipe; process.standardError = pipe
            outputRemainder = ""; lastStatus = ""; stoppedByUser = false; logView.string = ""
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData; guard !data.isEmpty else { return }; let text = String(data: data, encoding: .utf8) ?? ""
                DispatchQueue.main.async { self?.appendOutput(text) }
            }
            process.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.didStop() } }
            try process.run(); worker = process; setRunning(true); statusLabel.stringValue = "正在核对视频测试回执…"
        } catch { show("视频测试未启动。请先在本机保存密钥，并检查 Node.js。"); }
    }
    private func setRunning(_ running: Bool) { startButton.isEnabled = !running; stopButton.isEnabled = running; videoButton.isEnabled = !running; importButton.isEnabled = !running; saveButton.isEnabled = !running; keyField.isEnabled = !running }
    @objc private func stop() { guard let process = worker, process.isRunning else { return }; stoppedByUser = true; stopButton.isEnabled = false; statusLabel.stringValue = "正在停止并保留任务回执…"; process.terminate() }
    private func didStop() {
        outputPipe?.fileHandleForReading.readabilityHandler = nil; outputPipe = nil; worker = nil; setRunning(false)
        if !outputRemainder.isEmpty { appendOutput("\n") }
        statusLabel.stringValue = stoppedByUser || lastStatus.isEmpty ? "工作端已停止。任务回执保留在本机；重新启动不会重复生成。" : "工作端已停止。" + lastStatus
        if quitting { NSApp.reply(toApplicationShouldTerminate: true) }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { if worker?.isRunning == true { quitting = true; stop(); return .terminateLater }; return .terminateNow }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { if !flag { window.makeKeyAndOrderFront(nil) }; return true }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
