delete process.env.ELECTRON_RUN_AS_NODE;
const { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// 중복 실행 방지
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {

let selectWin, petWin, tray;
let autoLaunch = app.getLoginItemSettings().openAtLogin;

const preloadPath = path.join(__dirname, 'preload.js');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// 설정 저장/로드
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch { return {}; }
}

function saveSettings(data) {
  const current = loadSettings();
  fs.writeFileSync(settingsPath, JSON.stringify({ ...current, ...data }), 'utf-8');
}

function createSelectWindow() {
  selectWin = new BrowserWindow({
    width: 380,
    height: 580,
    title: 'OGQ Desk Pet',
    resizable: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });
  selectWin.loadFile('select.html');
  selectWin.center();
  selectWin.setMenuBarVisibility(false);
}

function createPetWindow(petData) {
  if (petWin) petWin.close();

  const { screen } = require('electron');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  petWin = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile('pet.html');

  petWin.webContents.on('did-finish-load', () => {
    petWin.webContents.send('pet-data', petData);
  });

  if (selectWin) selectWin.hide();
  saveSettings({ lastPet: petData });
  rebuildTrayMenu();
}

function togglePetVisibility() {
  if (!petWin || petWin.isDestroyed()) return;
  if (petWin.isVisible()) {
    petWin.hide();
  } else {
    petWin.show();
  }
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const petVisible = petWin && !petWin.isDestroyed() && petWin.isVisible();
  const template = [
    {
      label: petVisible ? '펫 숨기기' : '펫 보이기',
      click: togglePetVisibility
    },
    {
      label: '캐릭터 변경',
      click: () => {
        if (petWin) { petWin.close(); petWin = null; }
        if (selectWin) { selectWin.show(); selectWin.center(); }
      }
    },
    { type: 'separator' },
    {
      label: '타이머 재시작',
      click: () => petWin?.webContents.send('context-menu-action', 'restart-timer')
    },
    {
      label: '일시정지 / 재개',
      click: () => petWin?.webContents.send('context-menu-action', 'toggle-pause')
    },
    { type: 'separator' },
    {
      label: '시작 시 자동 실행',
      type: 'checkbox',
      checked: autoLaunch,
      click: (item) => {
        autoLaunch = item.checked;
        app.setLoginItemSettings({ openAtLogin: autoLaunch });
      }
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => app.quit()
    }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // 트레이 아이콘
  tray = new Tray(path.join(__dirname, 'assets', 'icon.png'));
  tray.setToolTip('OGQ Desktop Pet');
  rebuildTrayMenu();

  // 글로벌 단축키: Cmd+Shift+P (Mac) / Ctrl+Shift+P
  const shortcut = process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';
  globalShortcut.register(shortcut, togglePetVisibility);

  // 마지막 선택한 펫 자동 로드
  const settings = loadSettings();
  if (settings.lastPet) {
    createPetWindow(settings.lastPet);
  } else {
    createSelectWindow();
  }

  ipcMain.on('select-pet', (_event, petData) => {
    createPetWindow(petData);
  });

  ipcMain.on('quit-app', () => {
    app.quit();
  });

  ipcMain.on('set-ignore-mouse-events', (_event, ignore, options) => {
    if (petWin && !petWin.isDestroyed()) {
      petWin.setIgnoreMouseEvents(ignore, options || {});
    }
  });

  ipcMain.on('back-to-select', () => {
    if (petWin) { petWin.close(); petWin = null; }
    if (selectWin) { selectWin.show(); selectWin.center(); }
  });

  ipcMain.handle('get-saved-pet', () => {
    return loadSettings().lastPet || null;
  });

  ipcMain.on('clear-saved-pet', () => {
    saveSettings({ lastPet: null });
  });

  ipcMain.on('show-context-menu', (event) => {
    const template = [
      {
        label: '타이머 재시작',
        click: () => petWin?.webContents.send('context-menu-action', 'restart-timer')
      },
      {
        label: '일시정지 / 재개',
        click: () => petWin?.webContents.send('context-menu-action', 'toggle-pause')
      },
      {
        label: '타이머 설정',
        click: () => petWin?.webContents.send('context-menu-action', 'show-timer-settings')
      },
      { type: 'separator' },
      {
        label: '캐릭터 변경',
        click: () => {
          if (petWin) { petWin.close(); petWin = null; }
          if (selectWin) { selectWin.show(); selectWin.center(); }
          else { createSelectWindow(); }
        }
      },
      { type: 'separator' },
      {
        label: '종료',
        click: () => app.quit()
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!selectWin || selectWin.isDestroyed()) {
    createSelectWindow();
  }
});

app.on('second-instance', () => {
  if (petWin && !petWin.isDestroyed()) {
    petWin.show();
  } else if (selectWin && !selectWin.isDestroyed()) {
    selectWin.show();
    selectWin.focus();
  }
});

} // end of gotLock
