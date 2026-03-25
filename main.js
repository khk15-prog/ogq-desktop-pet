delete process.env.ELECTRON_RUN_AS_NODE;
const { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// 중복 실행 방지
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {

let selectWin, petWin, tray;
let autoLaunch = app.getLoginItemSettings().openAtLogin;
let alwaysOnTop = true;
let petOpacity = 100;

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

// 멀티모니터: 모든 디스플레이를 포괄하는 영역 계산
function getAllDisplayBounds() {
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const { x, y, width, height } = d.bounds;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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

  const bounds = getAllDisplayBounds();

  petWin = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    transparent: true,
    frame: false,
    alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.setOpacity(petOpacity / 100);
  petWin.loadFile('pet.html');

  petWin.webContents.on('did-finish-load', () => {
    petWin.webContents.send('pet-data', petData);
    // 저장된 타이머 상태 복원
    const settings = loadSettings();
    if (settings.timerState) {
      petWin.webContents.send('restore-timer-state', settings.timerState);
    }
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
        else { createSelectWindow(); }
      }
    },
    {
      label: '저장된 펫 초기화',
      click: () => {
        saveSettings({ lastPet: null, timerState: null });
        if (petWin) { petWin.close(); petWin = null; }
        if (selectWin) { selectWin.show(); selectWin.center(); }
        else { createSelectWindow(); }
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
      label: '항상 위',
      type: 'checkbox',
      checked: alwaysOnTop,
      click: (item) => {
        alwaysOnTop = item.checked;
        if (petWin && !petWin.isDestroyed()) {
          petWin.setAlwaysOnTop(alwaysOnTop);
        }
      }
    },
    {
      label: '투명도',
      submenu: [100, 75, 50, 25].map(v => ({
        label: `${v}%`,
        type: 'radio',
        checked: petOpacity === v,
        click: () => {
          petOpacity = v;
          if (petWin && !petWin.isDestroyed()) {
            petWin.setOpacity(v / 100);
          }
        }
      }))
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
  tray.setToolTip('OGQ Desktop Pet v0.2.0');
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

  // 타이머 상태 저장
  ipcMain.on('save-timer-state', (_event, state) => {
    saveSettings({ timerState: state });
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

// 종료 시 타이머 상태 저장 요청
app.on('before-quit', () => {
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send('request-timer-state');
  }
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
