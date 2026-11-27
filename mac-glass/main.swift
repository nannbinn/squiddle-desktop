// Squiddle Glass：macOS 原生外壳小样。
// 窗口背景是系统的 Liquid Glass（NSGlassEffectView，macOS 26 起），中间用系统 WebKit 显示 app/ 里现成的界面。
// 网页代码不改：窗口按钮接口（window.squiddleDesktop）和 Mac 版的样式都是加载时注入的（Resources/shell/）。
import AppKit
import WebKit

let RIM: CGFloat = 5         // 左右下三边的玻璃边宽，和 shell/glass.css 里的 --rim 一致
let TOP: CGFloat = 40        // 顶部玻璃条高度，红黄绿按钮和 logo 都在 20 处垂直居中；和 --tb 一致
let GLASS_RADIUS: CGFloat = 16   // 和系统窗口圆角一致（macOS 27 无工具栏窗口是 16）
// 红黄绿按钮的位置：系统默认离左边、上边都只有 9，太靠边；挪到左 16、上 13（14x14 的按钮，间距 23）
let LIGHTS_LEFT: CGFloat = 16, LIGHTS_TOP: CGFloat = 13, LIGHTS_GAP: CGFloat = 23

func shellFile(_ name: String) -> String {
  let url = Bundle.main.resourceURL!.appendingPathComponent("shell").appendingPathComponent(name)
  return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
}

let EXP = ProcessInfo.processInfo.environment["SQ_EXP"]     // 性能实验模式：逗号分隔的开关，见 shell/exp.js

func log(_ s: String) { FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!) }

// WebKit 默认把 requestAnimationFrame 限在 60 帧左右（Safari 设置里的「偏好 60fps 附近的页面渲染更新」）。
// 公开接口里没有这个开关，只能走 WKPreferences 的内部功能列表；苹果改了名字就找不到，找不到就保持默认，不会出错。
// 注意：这是非公开接口，上架 App Store 会被拒，自己用没问题。
func webKitFeatures() -> [NSObject] {
  let cls: AnyObject = WKPreferences.self
  let sel = NSSelectorFromString("_features")
  guard cls.responds(to: sel), let arr = cls.perform(sel)?.takeUnretainedValue() as? [NSObject] else { return [] }
  return arr
}
func listWebKitFeatures() {
  for f in webKitFeatures() {
    let k = (f.value(forKey: "key") as? String) ?? "?"
    if k.localizedCaseInsensitiveContains("fps") || k.localizedCaseInsensitiveContains("frame") || k.localizedCaseInsensitiveContains("rendering") { log("[feature] \(k)") }
  }
}
func setWebKitFeature(_ prefs: WKPreferences, key: String, enabled: Bool) -> Bool {
  guard let f = webKitFeatures().first(where: { ($0.value(forKey: "key") as? String) == key }) else { return false }
  let sel = NSSelectorFromString("_setEnabled:forFeature:")
  guard prefs.responds(to: sel) else { return false }
  typealias Fn = @convention(c) (AnyObject, Selector, Bool, AnyObject) -> Void
  unsafeBitCast(prefs.method(for: sel), to: Fn.self)(prefs, sel, enabled, f)
  return true
}

/// 用自己的地址 squiddle://app/ 提供 Resources/app 里的文件。
/// file:// 打开的页面在 WebKit 里存不了 IndexedDB（拖进来的歌就记不住），换成自定义地址后就能存，
/// 和 Electron 版一样：曲目、设置都存在本机，下次打开还在。
@MainActor
final class AppScheme: NSObject, WKURLSchemeHandler {
  let root: URL
  init(root: URL) { self.root = root.standardizedFileURL }
  static let types = ["html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json",
                      "png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml", "ico": "image/x-icon",
                      "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf", "otf": "font/otf", "wasm": "application/wasm",
                      "txt": "text/plain", "mid": "audio/midi", "mp3": "audio/mpeg", "wav": "audio/wav"]
  func webView(_ w: WKWebView, start task: any WKURLSchemeTask) {
    guard let url = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
    let rel = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
    let file = root.appendingPathComponent(rel).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {   // 只给 app/ 里面的文件
      task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!); task.didFinish(); return
    }
    let mime = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
    let type = mime.hasPrefix("text/") || mime.hasSuffix("json") ? mime + "; charset=utf-8" : mime
    task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                    headerFields: ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-cache"])!)
    task.didReceive(data); task.didFinish()
  }
  func webView(_ w: WKWebView, stop task: any WKURLSchemeTask) {}
}

/// 玻璃边上能拖动窗口的透明条（网页里的 -webkit-app-region 在 WebKit 里不起作用，改由原生视图来接）
final class DragStrip: NSView {
  override var mouseDownCanMoveWindow: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseDown(with e: NSEvent) {
    if e.clickCount == 2 { window?.performZoom(nil) } else { window?.performDrag(with: e) }
  }
}

@MainActor
final class Shell: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  var window: NSWindow!
  var web: WKWebView!
  var strips: [DragStrip] = []

  func applicationDidFinishLaunching(_ n: Notification) {
    buildMenu()

    let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 900),
                     styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                     backing: .buffered, defer: false)
    w.title = "Squiddle 星空鼓手"
    w.titleVisibility = .hidden
    w.titlebarAppearsTransparent = true
    w.isOpaque = false
    w.backgroundColor = .clear
    w.appearance = NSAppearance(named: .aqua)                  // 玻璃保持系统本来的浅色透明，不跟深色模式变
    w.minSize = NSSize(width: 760, height: 600)
    w.collectionBehavior.insert(.fullScreenPrimary)
    window = w            // 先存好再挂 delegate：恢复上次的窗口大小会立刻发 windowDidResize，那时 window 必须已经有值
    w.delegate = self
    w.center()
    if EXP == nil { w.setFrameAutosaveName("SquiddleGlassMain") }   // 实验模式不动你保存的窗口位置
    // 系统在缩放窗口、切换前后台、退出全屏时会把按钮摆回默认位置；按钮一动就再摆回来
    if let close = w.standardWindowButton(.closeButton) {
      close.postsFrameChangedNotifications = true
      NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: close, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.placeLights() }
      }
    }
    placeLights()

    // 玻璃：整个窗口背景
    let box: NSView
    if (EXP ?? "").contains("noglass") {   // 实验：不要玻璃，用不透明的浅灰底，看玻璃本身的开销
      w.isOpaque = true; w.backgroundColor = NSColor(srgbRed: 0.92, green: 0.92, blue: 0.94, alpha: 1)
      let plain = NSView(frame: w.contentLayoutRect); w.contentView = plain
      box = NSView(frame: plain.bounds); plain.addSubview(box)
    } else {
      let glass = NSGlassEffectView(frame: w.contentLayoutRect)
      glass.cornerRadius = GLASS_RADIUS
      w.contentView = glass
      box = NSView(frame: glass.bounds)
      glass.contentView = box
    }
    box.autoresizingMask = [.width, .height]

    // WebKit：铺满整个窗口、背景透明，网页里没画东西的地方（顶条、四周的边）就透出玻璃
    let cfg = WKWebViewConfiguration()
    if let exp = EXP {   // 实验模式：用一次性的存储（或 SQ_STORE 指定的单独测试存储），不碰你的设置；注入统计脚本
      if let id = ProcessInfo.processInfo.environment["SQ_STORE"].flatMap(UUID.init(uuidString:)) { cfg.websiteDataStore = WKWebsiteDataStore(forIdentifier: id) }
      else { cfg.websiteDataStore = .nonPersistent() }
      cfg.userContentController.addUserScript(WKUserScript(source: "window.__SQ_EXP=\(jsString(exp));" + shellFile("exp.js"), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    } else {
      cfg.websiteDataStore = .default()                         // 正常打开：用 app 自己的持久存储，曲目和设置下次还在
    }
    cfg.setURLSchemeHandler(AppScheme(root: Bundle.main.resourceURL!.appendingPathComponent("app")), forURLScheme: "squiddle")
    cfg.mediaTypesRequiringUserActionForPlayback = []          // 和桌面版一样，打开就能出声
    cfg.preferences.isElementFullscreenEnabled = true
    if ProcessInfo.processInfo.environment["SQ_LIST_FEATURES"] != nil { listWebKitFeatures() }
    if ProcessInfo.processInfo.environment["SQ_LAYOUT"] != nil {
      cfg.userContentController.addUserScript(WKUserScript(source: "window.__SQ_LAYOUT=1", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    // 不放开 120fps：完全使用 WebKit 默认的 60fps 节流
    let ucc = cfg.userContentController
    ucc.add(self, name: "sqwin")
    ucc.add(self, name: "sqlog")
    ucc.addUserScript(WKUserScript(source: shellFile("bridge.js"), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let css = shellFile("glass.css")
    let cssJS = "(()=>{const s=document.createElement('style');s.id='mac-glass';s.textContent=\(jsString(css));document.head.appendChild(s);})();"
    ucc.addUserScript(WKUserScript(source: cssJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

    let web = WKWebView(frame: box.bounds, configuration: cfg)
    web.autoresizingMask = [.width, .height]
    web.setValue(false, forKey: "drawsBackground")
    web.navigationDelegate = self
    web.uiDelegate = self
    web.isInspectable = true                                   // Safari「开发」菜单里可以检查
    box.addSubview(web)
    self.web = web

    // 拖动条：顶条整条，加左右下三条玻璃边
    func strip(_ r: NSRect, _ mask: NSView.AutoresizingMask) {
      let s = DragStrip(frame: r); s.autoresizingMask = mask; box.addSubview(s); strips.append(s)
    }
    let b = box.bounds
    strip(NSRect(x: 0, y: b.height - TOP, width: b.width, height: TOP), [.width, .minYMargin])
    strip(NSRect(x: 0, y: 0, width: RIM, height: b.height - TOP), [.height])
    strip(NSRect(x: b.width - RIM, y: 0, width: RIM, height: b.height - TOP), [.minXMargin, .height])
    strip(NSRect(x: 0, y: 0, width: b.width, height: RIM), [.width])

    // 只放行 app 自己的文件和页面自己生成的 data:/blob: 地址（和 Electron 版一样不连外网）
    let rules = "[" + ["^https?://", "^wss?://", "^ftp://"].map {
      #"{"trigger":{"url-filter":"\#($0)"},"action":{"type":"block"}}"#
    }.joined(separator: ",") + "]"
    WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "squiddle-offline", encodedContentRuleList: rules) { list, err in
      if let list { ucc.add(list) } else { log("[shell] 规则编译失败: \(String(describing: err))") }
      web.load(URLRequest(url: URL(string: "squiddle://app/index.html")!))
    }
  }

  func jsString(_ s: String) -> String {
    let d = try! JSONSerialization.data(withJSONObject: [s]); let a = String(data: d, encoding: .utf8)!
    return String(a.dropFirst().dropLast())
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ a: NSApplication) -> Bool { true }

  // 退出前先把声音淡出（约 0.17 秒）再真正退出，避免播放中硬切出现破音
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    web.evaluateJavaScript("window.__squiddleFadeOut ? window.__squiddleFadeOut(140) : 0") { _, _ in
      NSApp.reply(toApplicationShouldTerminate: true)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { NSApp.reply(toApplicationShouldTerminate: true) }
    return .terminateLater
  }

  // 页面加载完再显示窗口，免得先闪一下没样式的页面
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    sendState()
    if !window.isVisible { window.makeKeyAndOrderFront(nil); NSApp.activate() }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.window.invalidateShadow() }
    probe()
    if EXP != nil {   // 启动后第 8 秒开始量 5 秒，打印结果后自己退出
      let wait = Double(ProcessInfo.processInfo.environment["SQ_EXP_WAIT"] ?? "") ?? 8
      DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in self?.web.evaluateJavaScript("__sqExpReset()") }
      DispatchQueue.main.asyncAfter(deadline: .now() + wait + 5) { [weak self] in
        self?.web.evaluateJavaScript("__sqExpRead()") { r, _ in log("[exp \(EXP!)] \(r ?? "无结果")"); NSApp.terminate(nil) }
      }
    }
  }

  // 启动后量一下：requestAnimationFrame 每秒几帧、不点击能不能直接出声、玻璃按钮的位置
  func probe() {
    logLights("启动后")
    if ProcessInfo.processInfo.environment["SQ_LAYOUT"] != nil {   // 缩放一下窗口，看按钮会不会被系统摆回去
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
        guard let self else { return }
        let f = self.window.frame
        self.window.setFrame(f.insetBy(dx: 30, dy: 20), display: true)
        self.logLights("缩小窗口后")
        self.window.setFrame(f, display: true)
        self.logLights("恢复窗口后")
      }
    }
    // SQ_SNAPSHOT=目录：6 秒后把窗口内容（网页 + 标题栏按钮，不含系统合成的玻璃）存成 PNG，用来检查布局
    if let dir = ProcessInfo.processInfo.environment["SQ_SNAPSHOT"] {
      DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
        guard let self, let frameView = self.window.contentView?.superview else { return }
        if let rep = frameView.bitmapImageRepForCachingDisplay(in: frameView.bounds) {
          frameView.cacheDisplay(in: frameView.bounds, to: rep)
          try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: dir + "/window.png"))
        }
        self.web.takeSnapshot(with: nil) { img, _ in
          if let img, let t = img.tiffRepresentation, let r = NSBitmapImageRep(data: t) {
            try? r.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: dir + "/web.png"))
            log("[shell] 快照已存到 \(dir)")
          }
        }
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
      self?.web.callAsyncJavaScript("""
        const ac = new AudioContext(); await new Promise(r => setTimeout(r, 100)); const audio = ac.state; ac.close();
        const fps = await new Promise(r => { let n = 0; const t0 = performance.now();
          const f = () => { n++; const t = performance.now() - t0; if (t < 2000) requestAnimationFrame(f); else r(Math.round(n * 1000 / t)); };
          requestAnimationFrame(f); });
        let lay = '';
        if (window.__SQ_LAYOUT) {
          const q = s => document.querySelector(s), R = s => { const e = q(s); if (!e) return s + ':无'; const r = e.getBoundingClientRect(); return s + '[' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' sl=' + e.scrollLeft + ' sw=' + e.scrollWidth + ']'; };
          lay = '\\n  ' + ['html', 'body', '.win', '.tb', '.logo', '.body', '.stagewrap', '.stage', '.drawer', '.player', '.splash'].map(R).join('\\n  ')
            + '\\n  drawer.class=' + (q('.drawer') || {}).className + ' active=' + (document.activeElement && (document.activeElement.id || document.activeElement.tagName));
        }
        if (window.__SQ_LAYOUT) {
          const idb = await new Promise(res => { try { const rq = indexedDB.open('sq-probe', 1);
            rq.onupgradeneeded = () => rq.result.createObjectStore('k');
            rq.onsuccess = () => { try { const tx = rq.result.transaction('k', 'readwrite'); tx.objectStore('k').put({at: Date.now(), audio: new ArrayBuffer(16)}, 'a'); tx.oncomplete = () => res('IndexedDB 可写'); tx.onerror = e => res('IndexedDB 写失败 ' + tx.error); } catch (e) { res('IndexedDB 异常 ' + e); } };
            rq.onerror = () => res('IndexedDB 打不开 ' + rq.error); } catch (e) { res('IndexedDB 不可用 ' + e); } });
          lay += '\\n  ' + idb + ' / origin=' + location.origin;
        }
        return 'rAF ' + fps + ' fps, 不点击时 AudioContext=' + audio + ', 窗口 ' + innerWidth + 'x' + innerHeight + ' @' + devicePixelRatio + 'x' + lay;
        """, arguments: [:], in: nil, in: .page) { r in
        switch r { case .success(let v): log("[probe] \(v)"); case .failure(let e): log("[probe] 失败: \(e)") }
      }
    }
  }

  func logLights(_ tag: String) {
    let xs = [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].compactMap { t -> String? in
      guard let v = window.standardWindowButton(t) else { return nil }
      let r = v.convert(v.bounds, to: nil); return "\(Int(r.minX))..\(Int(r.maxX))@\(Int(window.frame.height - r.maxY))"
    }
    log("[shell] 红黄绿按钮（\(tag)，左..右@距顶）: " + xs.joined(separator: "  "))
  }

  // 网页里的链接用系统浏览器打开，窗口本身不跳走
  func webView(_ webView: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
    let scheme = a.request.url?.scheme?.lowercased() ?? ""
    if ["squiddle", "about", "data", "blob"].contains(scheme) { decisionHandler(.allow); return }
    if (scheme == "http" || scheme == "https"), let u = a.request.url { NSWorkspace.shared.open(u) }
    decisionHandler(.cancel)
  }
  func webView(_ webView: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
    if let u = a.request.url, ["http", "https"].contains(u.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(u) }
    return nil
  }
  // 「打开文件」（Cmd-O / 点拖放区）
  func webView(_ webView: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = p.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { log("[shell] 网页进程退出了，重新加载"); webView.reload() }

  // 网页发来的消息：窗口按钮、Esc、控制台输出
  func userContentController(_ ucc: WKUserContentController, didReceive m: WKScriptMessage) {
    if m.name == "sqlog" { log("[page] \(m.body)"); return }
    guard m.name == "sqwin", let cmd = m.body as? String else { return }
    switch cmd {
    case "min": window.miniaturize(nil)
    case "max": window.zoom(nil)
    case "full": window.toggleFullScreen(nil)
    case "close": window.performClose(nil)
    case "esc": if window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
    default: break
    }
  }

  var placingLights = false
  func placeLights() {
    guard let window, !placingLights, !window.styleMask.contains(.fullScreen) else { return }
    placingLights = true; defer { placingLights = false }
    for (i, t) in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].enumerated() {
      guard let b = window.standardWindowButton(t), let sv = b.superview else { continue }
      let y = sv.isFlipped ? LIGHTS_TOP : sv.bounds.height - LIGHTS_TOP - b.frame.height
      let o = NSPoint(x: LIGHTS_LEFT + CGFloat(i) * LIGHTS_GAP, y: y)
      if b.frame.origin != o { b.setFrameOrigin(o) }
    }
  }

  func sendState() {
    guard let window else { return }
    placeLights()
    let full = window.styleMask.contains(.fullScreen)
    for s in strips { s.isHidden = full }
    web?.evaluateJavaScript("window.__sqWinState && window.__sqWinState({max:\(window.isZoomed),full:\(full)})")
  }
  func windowDidResize(_ n: Notification) { sendState() }
  func windowDidEnterFullScreen(_ n: Notification) { sendState() }
  func windowDidExitFullScreen(_ n: Notification) { sendState() }
  func windowDidBecomeKey(_ n: Notification) { placeLights() }
  func windowDidResignKey(_ n: Notification) { placeLights() }
  func windowDidEndLiveResize(_ n: Notification) { placeLights() }

  func buildMenu() {
    let main = NSMenu()
    func sub(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
      let it = NSMenuItem(); let m = NSMenu(title: title); items.forEach { m.addItem($0) }; it.submenu = m; main.addItem(it); return m
    }
    func item(_ t: String, _ s: Selector, _ k: String, _ mods: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
      let i = NSMenuItem(title: t, action: s, keyEquivalent: k); i.keyEquivalentModifierMask = mods; return i
    }
    _ = sub("Squiddle", [
      item("关于 Squiddle", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""), .separator(),
      item("隐藏 Squiddle", #selector(NSApplication.hide(_:)), "h"),
      item("隐藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]), .separator(),
      item("退出 Squiddle", #selector(NSApplication.terminate(_:)), "q"),
    ])
    _ = sub("编辑", [
      item("撤销", Selector(("undo:")), "z"), item("重做", Selector(("redo:")), "z", [.command, .shift]), .separator(),
      item("剪切", #selector(NSText.cut(_:)), "x"), item("拷贝", #selector(NSText.copy(_:)), "c"),
      item("粘贴", #selector(NSText.paste(_:)), "v"), item("全选", #selector(NSText.selectAll(_:)), "a"),
    ])
    let wm = sub("窗口", [
      item("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("缩放", #selector(NSWindow.performZoom(_:)), ""),
      item("切换全屏幕", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]), .separator(),
      item("关闭窗口", #selector(NSWindow.performClose(_:)), "w"),
    ])
    NSApp.mainMenu = main
    NSApp.windowsMenu = wm
  }
}

MainActor.assumeIsolated {
  let app = NSApplication.shared
  let shell = Shell()
  app.delegate = shell
  app.setActivationPolicy(.regular)
  app.run()
}
