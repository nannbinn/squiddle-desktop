// Squiddle 桌面版主进程：开一个窗口加载 app/index.html，不加载任何外网内容
const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');   // 打开就能出声，不用先点一下

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 900, minWidth: 720, minHeight: 600,
    backgroundColor: '#1f2263', title: 'Squiddle 星空鼓手', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // 页面里的链接用系统浏览器打开，窗口本身不跳转
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Esc 退出全屏（不拦截，页面照样收到 Esc 去收起菜单）
  win.webContents.on('before-input-event', (_, i) => { if (i.type === 'keyDown' && i.key === 'Escape' && win.isFullScreen()) win.setFullScreen(false); });
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  // 只放行本地文件和页面自己生成的 data:/blob: 地址
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob|devtools|chrome-extension):/.test(d.url) }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: '视图', submenu: [
      { label: '全屏', accelerator: 'F11', click: (_, w) => w && w.setFullScreen(!w.isFullScreen()) },
      { role: 'reload', label: '重新加载' },
      { role: 'toggleDevTools', label: '开发者工具', accelerator: 'Ctrl+Shift+I' },
      { type: 'separator' }, { role: 'quit', label: '退出' },
    ],
  }]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
