delete process.env.ELECTRON_RUN_AS_NODE;
const { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, screen, nativeImage, powerMonitor } = require('electron');
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
const statsPath = path.join(app.getPath('userData'), 'stats.json');

// 설정 저장/로드
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); }
  catch { return {}; }
}
function saveSettings(data) {
  const current = loadSettings();
  fs.writeFileSync(settingsPath, JSON.stringify({ ...current, ...data }), 'utf-8');
}

// 통계 저장/로드
function loadStats() {
  try { return JSON.parse(fs.readFileSync(statsPath, 'utf-8')); }
  catch { return {}; }
}
function saveStats(data) {
  const current = loadStats();
  fs.writeFileSync(statsPath, JSON.stringify({ ...current, ...data }), 'utf-8');
}

// 오늘 날짜 키
function todayKey() { return new Date().toISOString().slice(0, 10); }

// ===== 활동 감지 =====
const IDLE_THRESHOLD = 600; // 10분 이상 미입력 → 휴식
let activityInterval = null;
let currentState = 'idle'; // idle, working, resting
let sessionWorkSec = 0;
let sessionRestSec = 0;
let continuousWorkSec = 0;
let continuousRestSec = 0;
const WORK_ALERT_SEC = 60 * 50; // 50분 연속 업무 → 쉬어! 알림
const REST_ALERT_SEC = 60 * 10; // 10분 연속 휴식 → 슬슬 할까? 알림
let workAlertSent = false;
let restAlertSent = false;

function startActivityMonitor() {
  activityInterval = setInterval(() => {
    if (!petWin || petWin.isDestroyed()) return;
    const idleTime = powerMonitor.getSystemIdleTime();
    if (idleTime < IDLE_THRESHOLD) {
      currentState = 'working';
      sessionWorkSec++;
      continuousWorkSec++;
      continuousRestSec = 0;
      restAlertSent = false;

      if (continuousWorkSec >= WORK_ALERT_SEC && !workAlertSent) {
        petWin.webContents.send('activity-alert', 'work-long');
        workAlertSent = true;
      }
    } else {
      currentState = 'resting';
      sessionRestSec++;
      continuousRestSec++;
      continuousWorkSec = 0;
      workAlertSent = false;

      if (continuousRestSec >= REST_ALERT_SEC && !restAlertSent) {
        petWin.webContents.send('activity-alert', 'rest-long');
        restAlertSent = true;
      }
    }

    petWin.webContents.send('activity-state', {
      state: currentState,
      workSec: sessionWorkSec,
      restSec: sessionRestSec,
      continuousWorkSec,
      continuousRestSec
    });

    // 매 60초마다 통계 저장
    if ((sessionWorkSec + sessionRestSec) % 60 === 0) {
      const key = todayKey();
      const stats = loadStats();
      stats[key] = { workSec: sessionWorkSec, restSec: sessionRestSec };
      saveStats(stats);
    }
  }, 1000);
}

// 멀티모니터
function getAllDisplayBounds() {
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const { x, y, width, height } = d.bounds;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width); maxY = Math.max(maxY, y + height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function createSelectWindow() {
  selectWin = new BrowserWindow({
    width: 380, height: 620, show: true,
    title: 'OGQ Desk Pet', resizable: false,
    webPreferences: { preload: preloadPath, nodeIntegration: false, contextIsolation: true },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });
  selectWin.loadFile('select.html');
  selectWin.center();
  selectWin.setMenuBarVisibility(false);
  selectWin.show();
}

function createPetWindow(petData) {
  if (petWin) petWin.close();
  const bounds = getAllDisplayBounds();

  petWin = new BrowserWindow({
    width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y,
    transparent: true, frame: false, alwaysOnTop, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: preloadPath, nodeIntegration: false, contextIsolation: true }
  });

  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.setOpacity(petOpacity / 100);
  petWin.loadFile('pet.html');

  petWin.webContents.on('did-finish-load', () => {
    const cursorPos = screen.getCursorScreenPoint();
    const winBounds = petWin.getBounds();
    petWin.webContents.send('pet-data', {
      ...petData,
      startX: cursorPos.x - winBounds.x,
      startY: cursorPos.y - winBounds.y
    });
    // 활동 감지 시작
    if (!activityInterval) startActivityMonitor();
  });

  if (selectWin) selectWin.hide();
  saveSettings({ lastPet: petData });
  rebuildTrayMenu();
}

function togglePetVisibility() {
  if (!petWin || petWin.isDestroyed()) return;
  petWin.isVisible() ? petWin.hide() : petWin.show();
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const petVisible = petWin && !petWin.isDestroyed() && petWin.isVisible();
  const template = [
    { label: petVisible ? '펫 숨기기' : '펫 보이기', click: togglePetVisibility },
    { label: '캐릭터 변경', click: () => {
      if (petWin) { petWin.close(); petWin = null; }
      if (selectWin) { selectWin.show(); selectWin.center(); }
      else createSelectWindow();
    }},
    { label: '저장된 펫 초기화', click: () => {
      saveSettings({ lastPet: null });
      if (petWin) { petWin.close(); petWin = null; }
      if (selectWin) { selectWin.show(); selectWin.center(); }
      else createSelectWindow();
    }},
    { type: 'separator' },
    { label: '항상 위', type: 'checkbox', checked: alwaysOnTop, click: (item) => {
      alwaysOnTop = item.checked;
      if (petWin && !petWin.isDestroyed()) petWin.setAlwaysOnTop(alwaysOnTop);
    }},
    { label: '투명도', submenu: [100, 75, 50, 25].map(v => ({
      label: `${v}%`, type: 'radio', checked: petOpacity === v,
      click: () => { petOpacity = v; if (petWin && !petWin.isDestroyed()) petWin.setOpacity(v / 100); }
    }))},
    { type: 'separator' },
    { label: '시작 시 자동 실행', type: 'checkbox', checked: autoLaunch, click: (item) => {
      autoLaunch = item.checked;
      app.setLoginItemSettings({ openAtLogin: autoLaunch });
    }},
    { type: 'separator' },
    { label: '종료', click: () => app.quit() }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip('OGQ Desktop Pet v0.2.0');
  rebuildTrayMenu();

  const shortcut = process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';
  globalShortcut.register(shortcut, togglePetVisibility);

  const settings = loadSettings();
  if (settings.lastPet) createPetWindow(settings.lastPet);
  else createSelectWindow();

  ipcMain.on('select-pet', (_event, petData) => createPetWindow(petData));
  ipcMain.on('quit-app', () => app.quit());
  ipcMain.on('set-ignore-mouse-events', (_event, ignore, options) => {
    if (petWin && !petWin.isDestroyed()) petWin.setIgnoreMouseEvents(ignore, options || {});
  });
  ipcMain.on('back-to-select', () => {
    if (petWin) { petWin.close(); petWin = null; }
    if (selectWin) { selectWin.show(); selectWin.center(); }
  });
  ipcMain.handle('get-saved-pet', () => loadSettings().lastPet || null);
  ipcMain.on('clear-saved-pet', () => saveSettings({ lastPet: null }));

  // 메모
  ipcMain.handle('get-memo', () => loadSettings().memo || []);
  ipcMain.on('save-memo', (_event, memo) => saveSettings({ memo }));

  // 통계 요청
  ipcMain.handle('get-stats', () => {
    const stats = loadStats();
    return { today: stats[todayKey()] || { workSec: 0, restSec: 0 }, weekly: getWeeklyStats(stats) };
  });

  ipcMain.on('show-context-menu', (event) => {
    const template = [
      { label: '메모하기', click: () => petWin?.webContents.send('context-menu-action', 'show-memo') },
      { label: '활동 리포트', click: () => petWin?.webContents.send('context-menu-action', 'show-stats') },
      { type: 'separator' },
      { label: '타이머 시작', click: () => petWin?.webContents.send('context-menu-action', 'timer-start') },
      { label: '타이머 멈춤', click: () => petWin?.webContents.send('context-menu-action', 'timer-stop') },
      { label: '타이머 설정', click: () => petWin?.webContents.send('context-menu-action', 'show-timer-settings') },
      { type: 'separator' },
      { label: '캐릭터 변경', click: () => {
        if (petWin) { petWin.close(); petWin = null; }
        if (selectWin) { selectWin.show(); selectWin.center(); }
        else createSelectWindow();
      }},
      { type: 'separator' },
      { label: '종료', click: () => app.quit() }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
  });
});

// 주간 통계 계산
function getWeeklyStats(stats) {
  const result = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    result.push({
      date: key,
      day: dayNames[d.getDay()],
      workSec: stats[key]?.workSec || 0,
      restSec: stats[key]?.restSec || 0
    });
  }
  return result;
}

// 종료 시 통계 저장
app.on('before-quit', () => {
  const key = todayKey();
  const stats = loadStats();
  stats[key] = { workSec: sessionWorkSec, restSec: sessionRestSec };
  saveStats(stats);
  if (activityInterval) clearInterval(activityInterval);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (!selectWin || selectWin.isDestroyed()) createSelectWindow();
});
app.on('second-instance', () => {
  if (petWin && !petWin.isDestroyed()) petWin.show();
  else if (selectWin && !selectWin.isDestroyed()) { selectWin.show(); selectWin.focus(); }
});

} // end of gotLock
