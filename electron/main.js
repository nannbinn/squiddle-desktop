// Squiddle 桌面版主进程：开一个无边框窗口加载 app/index.html（标题栏是页面自己画的），不加载任何外网内容
const { app, BrowserWindow, Menu, shell, session, ipcMain } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');   // 打开就能出声，不用先点一下

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 900, minWidth: 760, minHeight: 600,
    frame: false, backgroundColor: '#1f2263', title: 'Squiddle 星空鼓手', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // 页面里的链接用系统浏览器打开，窗口本身不跳转
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // 键盘：Esc 退出全屏（页面照样收到 Esc 去收起菜单）；F12 / Ctrl+Shift+I 开发者工具
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'Escape' && win.isFullScreen()) win.setFullScreen(false);
    if (i.key === 'F12' || (i.control && i.shift && i.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  // 窗口状态告诉页面：标题栏的最大化按钮要换图标，全屏时标题栏收起
  const send = () => win.webContents.send('win-state', { max: win.isMaximized(), full: win.isFullScreen() });
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, send);
  win.webContents.on('did-finish-load', send);
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  return win;
}

// 标题栏按钮
ipcMain.on('win', (e, cmd) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (!w) return;
  if (cmd === 'min') w.minimize();
  else if (cmd === 'max') w.isMaximized() ? w.unmaximize() : w.maximize();
  else if (cmd === 'full') w.setFullScreen(!w.isFullScreen());
  else if (cmd === 'close') w.close();
});

app.whenReady().then(() => {
  // 只放行本地文件和页面自己生成的 data:/blob: 地址
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob|devtools|chrome-extension):/.test(d.url) }));
  Menu.setApplicationMenu(null);     // 没有系统菜单栏，快捷键都在页面里
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
