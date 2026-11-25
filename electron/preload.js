// 页面能看到的桌面接口（目前只用来判断"这是桌面版"）
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('squiddleDesktop', { platform: process.platform, versions: { electron: process.versions.electron } });
