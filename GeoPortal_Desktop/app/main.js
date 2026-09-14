'use strict';

const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const net = require('net');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const tar = require('tar');

const PRODUCT = 'GeoPortal Desktop';
let mainWindow = null;
let tomcatProcess = null;
let serverPort = null;
let runtimeBase = null;
let logFile = null;
let appIsQuitting = false;

const isDev = !app.isPackaged;
const resourceRoot = () => isDev ? path.join(__dirname, '..') : process.resourcesPath;
const bundled = (...p) => path.join(resourceRoot(), ...p);

function fileExists(p) {
  try { return fs.existsSync(p); } catch (_) { return false; }
}

function executableName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

async function appendLog(line) {
  if (!logFile) return;
  const text = `[${new Date().toISOString()}] ${line}\n`;
  try { await fsp.appendFile(logFile, text, 'utf8'); } catch (_) {}
}

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

async function chooseFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function ensureRuntimeFolders() {
  runtimeBase = path.join(app.getPath('userData'), 'runtime');
  logFile = path.join(app.getPath('userData'), 'geoportal-desktop.log');
  const dirs = ['conf', 'logs', 'temp', 'work', 'webapps', 'data'];
  await Promise.all(dirs.map(d => fsp.mkdir(path.join(runtimeBase, d), { recursive: true })));
}

async function syncWar() {
  const src = bundled('resources', 'geoportal.war');
  const packagedSrc = bundled('geoportal.war');
  const realSrc = fileExists(packagedSrc) ? packagedSrc : src;
  if (!fileExists(realSrc)) throw new Error(`GeoPortal WAR is missing: ${realSrc}`);

  const dst = path.join(runtimeBase, 'webapps', 'geoportal.war');
  const marker = `${dst}.sha256`;
  const srcHash = await sha256File(realSrc);
  let oldHash = '';
  try { oldHash = (await fsp.readFile(marker, 'utf8')).trim(); } catch (_) {}
  if (!fileExists(dst) || oldHash !== srcHash) {
    await fsp.rm(path.join(runtimeBase, 'webapps', 'geoportal'), { recursive: true, force: true });
    await fsp.copyFile(realSrc, dst);
    await fsp.writeFile(marker, srcHash, 'utf8');
    await appendLog('Updated embedded geoportal.war.');
  }
}

function javaPath() {
  const candidates = [
    bundled('java', 'bin', executableName('java')),
    bundled('runtime', 'java', 'bin', executableName('java')),
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', executableName('java')) : null,
    executableName('java')
  ].filter(Boolean);
  for (const p of candidates) {
    if (p === executableName('java') || fileExists(p)) return p;
  }
  return executableName('java');
}

function tomcatHome() {
  const candidates = [bundled('tomcat'), bundled('runtime', 'tomcat')];
  for (const p of candidates) if (fileExists(path.join(p, 'bin', 'bootstrap.jar'))) return p;
  throw new Error('Embedded Apache Tomcat runtime is missing. Rebuild the desktop package with scripts/prepare-runtime.*');
}

async function ensureGisRuntime() {
  const packedCandidates = [bundled('gis-runtime.tar.gz'), bundled('runtime', 'gis-runtime.tar.gz')];
  const packed = packedCandidates.find(fileExists);
  if (!packed) {
    await appendLog('No bundled GIS runtime archive found; using system GDAL/OGR/PDAL detection.');
    return null;
  }

  const dst = path.join(app.getPath('userData'), 'gis-runtime');
  const marker = path.join(dst, '.geoportal-runtime-ready');
  const archiveHash = await sha256File(packed);
  let current = '';
  try { current = (await fsp.readFile(marker, 'utf8')).trim(); } catch (_) {}
  if (current !== archiveHash) {
    await appendLog('Installing bundled GIS runtime for this user profile...');
    await fsp.rm(dst, { recursive: true, force: true });
    await fsp.mkdir(dst, { recursive: true });
    await tar.x({ file: packed, cwd: dst, preservePaths: false });

    const unpackCandidates = process.platform === 'win32'
      ? [path.join(dst, 'Scripts', 'conda-unpack.exe'), path.join(dst, 'Scripts', 'conda-unpack-script.py')]
      : [path.join(dst, 'bin', 'conda-unpack')];
    const unpack = unpackCandidates.find(fileExists);
    if (unpack) {
      const result = spawnSync(unpack, [], { cwd: dst, encoding: 'utf8', windowsHide: true });
      await appendLog(`conda-unpack exit=${result.status}; ${result.stderr || result.stdout || ''}`);
    }
    await fsp.writeFile(marker, archiveHash, 'utf8');
  }
  return dst;
}

function findFirst(candidates) {
  return candidates.find(p => p && fileExists(p)) || null;
}

function desktopEnvironment(gisRoot) {
  const env = { ...process.env };
  env.GEOPORTAL_DATA_DIR = path.join(runtimeBase, 'data');
  env.GEOPORTAL_MAX_UPLOAD_BYTES = env.GEOPORTAL_MAX_UPLOAD_BYTES || String(2 * 1024 * 1024 * 1024);
  env.CPL_TMPDIR = path.join(runtimeBase, 'temp');

  const extraPath = [];
  if (gisRoot) {
    if (process.platform === 'win32') {
      const libBin = path.join(gisRoot, 'Library', 'bin');
      const scripts = path.join(gisRoot, 'Scripts');
      extraPath.push(gisRoot, libBin, scripts);
      env.GEOPORTAL_GIS_BIN = fileExists(libBin) ? libBin : gisRoot;
      env.GEOPORTAL_GDAL_BIN = env.GEOPORTAL_GIS_BIN;
      env.GEOPORTAL_OGR_BIN = env.GEOPORTAL_GIS_BIN;
      env.GEOPORTAL_PDAL_BIN = env.GEOPORTAL_GIS_BIN;
      const py = findFirst([path.join(gisRoot, 'python.exe'), path.join(gisRoot, 'python3.exe')]);
      if (py) env.GEOPORTAL_PYTHON = py;
      const calc = findFirst([
        path.join(scripts, 'gdal_calc.py'),
        path.join(scripts, 'gdal_calc-script.py'),
        path.join(libBin, 'gdal_calc.py')
      ]);
      if (calc) env.GEOPORTAL_GDAL_CALC = calc;
    } else {
      const bin = path.join(gisRoot, 'bin');
      extraPath.push(bin);
      env.GEOPORTAL_GIS_BIN = bin;
      env.GEOPORTAL_GDAL_BIN = bin;
      env.GEOPORTAL_OGR_BIN = bin;
      env.GEOPORTAL_PDAL_BIN = bin;
      const py = findFirst([path.join(bin, 'python3'), path.join(bin, 'python')]);
      if (py) env.GEOPORTAL_PYTHON = py;
      const calc = findFirst([path.join(bin, 'gdal_calc.py'), path.join(bin, 'gdal_calc')]);
      if (calc) env.GEOPORTAL_GDAL_CALC = calc;
    }
  }

  // Preserve existing installations as a fallback.
  if (process.platform === 'win32') {
    extraPath.push('C:\\OSGeo4W\\bin', 'C:\\OSGeo4W64\\bin', 'C:\\Program Files\\PDAL\\bin');
  } else if (process.platform === 'darwin') {
    extraPath.push('/opt/homebrew/bin', '/usr/local/bin');
  }
  env.PATH = extraPath.filter(fileExists).concat([env.PATH || '']).join(path.delimiter);
  return env;
}

async function writeTomcatConfig(port, home) {
  const serverXml = `<?xml version="1.0" encoding="UTF-8"?>\n<Server port="-1" shutdown="SHUTDOWN">\n  <Listener className="org.apache.catalina.startup.VersionLoggerListener" />\n  <Listener className="org.apache.catalina.core.AprLifecycleListener" SSLEngine="on" />\n  <Listener className="org.apache.catalina.core.JreMemoryLeakPreventionListener" />\n  <Listener className="org.apache.catalina.mbeans.GlobalResourcesLifecycleListener" />\n  <Listener className="org.apache.catalina.core.ThreadLocalLeakPreventionListener" />\n  <Service name="Catalina">\n    <Connector address="127.0.0.1" port="${port}" protocol="HTTP/1.1" connectionTimeout="20000" maxPostSize="-1" maxParameterCount="10000" />\n    <Engine name="Catalina" defaultHost="localhost">\n      <Host name="localhost" appBase="${xmlEscape(path.join(runtimeBase, 'webapps'))}" unpackWARs="true" autoDeploy="true">\n      </Host>\n    </Engine>\n  </Service>\n</Server>\n`;
  const contextXml = `<?xml version="1.0" encoding="UTF-8"?>\n<Context>\n  <WatchedResource>WEB-INF/web.xml</WatchedResource>\n</Context>\n`;
  await fsp.writeFile(path.join(runtimeBase, 'conf', 'server.xml'), serverXml, 'utf8');
  for (const name of ['catalina.properties', 'logging.properties', 'web.xml']) {
    const src = path.join(home, 'conf', name);
    const dst = path.join(runtimeBase, 'conf', name);
    if (fileExists(src)) await fsp.copyFile(src, dst);
  }
  const homeContext = path.join(home, 'conf', 'context.xml');
  if (fileExists(homeContext)) await fsp.copyFile(homeContext, path.join(runtimeBase, 'conf', 'context.xml'));
  else await fsp.writeFile(path.join(runtimeBase, 'conf', 'context.xml'), contextXml, 'utf8');
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function startTomcat() {
  serverPort = await chooseFreePort();
  await ensureRuntimeFolders();
  await syncWar();
  const home = tomcatHome();
  await writeTomcatConfig(serverPort, home);
  const gisRoot = await ensureGisRuntime();
  const java = javaPath();
  const cp = [path.join(home, 'bin', 'bootstrap.jar'), path.join(home, 'bin', 'tomcat-juli.jar')].join(path.delimiter);
  const args = [
    `-Dcatalina.home=${home}`,
    `-Dcatalina.base=${runtimeBase}`,
    `-Djava.io.tmpdir=${path.join(runtimeBase, 'temp')}`,
    '-Djava.awt.headless=true',
    '-classpath', cp,
    'org.apache.catalina.startup.Bootstrap', 'start'
  ];
  await appendLog(`Starting Tomcat: ${java} on 127.0.0.1:${serverPort}`);
  tomcatProcess = spawn(java, args, {
    cwd: runtimeBase,
    env: desktopEnvironment(gisRoot),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  tomcatProcess.stdout.on('data', d => appendLog(`TOMCAT OUT ${String(d).trimEnd()}`));
  tomcatProcess.stderr.on('data', d => appendLog(`TOMCAT ERR ${String(d).trimEnd()}`));
  tomcatProcess.on('exit', (code, signal) => appendLog(`Tomcat exited code=${code} signal=${signal}`));
  tomcatProcess.on('error', e => appendLog(`Tomcat spawn error: ${e.stack || e.message}`));
}

function requestText(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function waitForGeoPortal(totalMs = 60000) {
  const started = Date.now();
  const url = `http://127.0.0.1:${serverPort}/geoportal/api/health`;
  while (Date.now() - started < totalMs) {
    if (tomcatProcess && tomcatProcess.exitCode !== null) throw new Error(`Local GeoPortal server exited with code ${tomcatProcess.exitCode}.`);
    try {
      const r = await requestText(url);
      if (r.status === 200) {
        const data = JSON.parse(r.body);
        if (data && data.status === 'ok') return data;
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`GeoPortal backend did not become ready at ${url}. See ${logFile}`);
}

function geoUrl(page = 'index.html') {
  return `http://127.0.0.1:${serverPort}/geoportal/${page}`;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 930,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#071a16',
    title: PRODUCT,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.hostname === '127.0.0.1' && Number(u.port) === serverPort) return { action: 'allow' };
    } catch (_) {}
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      if (u.hostname === '127.0.0.1' && Number(u.port) === serverPort) return;
    } catch (_) {}
    event.preventDefault();
    shell.openExternal(url);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

async function showDiagnostics() {
  try {
    const r = await requestText(geoUrl('api/health'), 5000);
    const data = JSON.parse(r.body || '{}');
    const lines = [
      `Server: ${data.status || r.status}`,
      `GDAL: ${data.gdal ? 'Available' : 'Not detected'}`,
      `OGR: ${data.ogr ? 'Available' : 'Not detected'}`,
      `PDAL: ${data.pdal ? 'Available' : 'Not detected'}`,
      `GDAL Calc: ${data.gdalCalc ? 'Available' : 'Not detected'}`,
      `Data: ${data.dataDir || path.join(runtimeBase, 'data')}`,
      `Local URL: ${geoUrl('geoportal.html')}`
    ];
    await dialog.showMessageBox(mainWindow, { type: 'info', title: 'GeoPortal Diagnostics', message: lines.join('\n') });
  } catch (e) {
    await dialog.showMessageBox(mainWindow, { type: 'error', title: 'GeoPortal Diagnostics', message: e.message });
  }
}

function installMenu() {
  const template = [
    {
      label: 'GeoPortal', submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+H', click: () => mainWindow?.loadURL(geoUrl('index.html')) },
        { label: 'GIS Workspace', accelerator: 'CmdOrCtrl+G', click: () => mainWindow?.loadURL(geoUrl('geoportal.html')) },
        { type: 'separator' },
        { label: 'Open Data Folder', click: () => shell.openPath(path.join(runtimeBase, 'data')) },
        { label: 'Open Log File', click: () => shell.openPath(logFile) },
        { label: 'Diagnostics', click: showDiagnostics },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [{ label: 'GeoPortal Diagnostics', click: showDiagnostics }, { label: 'Open User Data Folder', click: () => shell.openPath(app.getPath('userData')) }] }
  ];
  if (process.platform === 'darwin') {
    template.unshift({ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function stopServer() {
  if (!tomcatProcess || tomcatProcess.killed) return;
  await appendLog('Stopping local GeoPortal server.');
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(tomcatProcess.pid), '/t', '/f'], { windowsHide: true });
    else tomcatProcess.kill('SIGTERM');
  } catch (_) {}
}

async function boot() {
  try {
    await ensureRuntimeFolders();
    await startTomcat();
    const health = await waitForGeoPortal();
    await appendLog(`GeoPortal ready. health=${JSON.stringify(health)}`);
    createMainWindow();
    installMenu();
    await mainWindow.loadURL(geoUrl('index.html'));
  } catch (e) {
    await appendLog(`BOOT FAILURE ${e.stack || e.message}`);
    dialog.showErrorBox('GeoPortal Desktop could not start', `${e.message}\n\nLog: ${logFile || app.getPath('userData')}`);
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(boot);
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
    createMainWindow();
    mainWindow.loadURL(geoUrl('index.html'));
  }
});

app.on('before-quit', event => {
  if (appIsQuitting) return;
  appIsQuitting = true;
  event.preventDefault();
  stopServer().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
