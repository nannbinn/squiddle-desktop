// 页面能看到的桌面接口：判断"这是桌面版"，以及自绘标题栏的窗口按钮
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('squiddleDesktop', {
  platform: process.platform,
  versions: { electron: process.versions.electron },
  win: {
    min: () => ipcRenderer.send('win', 'min'),
    max: () => ipcRenderer.send('win', 'max'),
    full: () => ipcRenderer.send('win', 'full'),
    close: () => ipcRenderer.send('win', 'close'),
    onState: cb => ipcRenderer.on('win-state', (_, s) => cb(s)),
  },
});
