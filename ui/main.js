import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import bancoz from '../bancoz.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: 'Bancoz UI',
    backgroundColor: '#0d1117',
    icon: path.join(__dirname, '..', 'icone.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  
  // Ocultar menu padrão no modo produção
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC: Comunicação entre a UI (Renderer) e o Core (Node.js)

ipcMain.handle('bancoz:info', async () => {
  let appVersion = '3.0.0';
  try {
    const fs = await import('fs/promises');
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkgData = await fs.readFile(pkgPath, 'utf8');
    appVersion = JSON.parse(pkgData).version;
  } catch (err) {}

  return {
    path: bancoz.pastaBanco(),
    mode: bancoz.storageMode,
    version: appVersion
  };
});

async function walkDirRecursively(fs, dir, baseLength, mode, ignores = []) {
  let results = [];
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    
    // Se for modo engine e já for uma coleção (tem wal.log), retorna
    if (mode === 'engine') {
      const hasWal = files.find(f => f.name === 'wal.log' || f.name === 'keydir.idx');
      if (hasWal) {
        const relPath = dir.substring(baseLength).replace(/\\/g, '/');
        // Adiciona à lista, mas continua a busca pois podem haver coleções filhas?
        // Em bancos chave-valor, geralmente 'users' e 'users/123' são coleções distintas,
        // mas as vezes as próprias subpastas são coleções.
        results.push({ name: relPath, mode: 'engine' });
      }
    }
    
    for (const f of files) {
      if (ignores.includes(f.name)) continue;
      
      const fullPath = path.join(dir, f.name);
      if (f.isDirectory()) {
        results = results.concat(await walkDirRecursively(fs, fullPath, baseLength, mode, ignores));
      } else if (mode === 'json' && f.isFile() && f.name.endsWith('.json')) {
        let relPath = fullPath.substring(baseLength).replace(/\\/g, '/');
        relPath = relPath.substring(0, relPath.length - 5); // remove .json
        results.push({ name: relPath, mode: 'json' });
      }
    }
  } catch (err) {}
  
  return results;
}

ipcMain.handle('bancoz:listCollections', async () => {
  const baseDir = bancoz.pastaBanco();
  const fs = await import('fs/promises');
  let collections = [];
  
  try {
    const jsonIgnores = ['db', 'configs', 'llm'];
    const jsonBaseLength = baseDir.length + 1;
    const jsonCols = await walkDirRecursively(fs, baseDir, jsonBaseLength, 'json', jsonIgnores);
    collections = collections.concat(jsonCols);
    
    const dbPath = path.join(baseDir, 'db');
    const engineBaseLength = dbPath.length + 1;
    const engineCols = await walkDirRecursively(fs, dbPath, engineBaseLength, 'engine', []);
    
    for (const ec of engineCols) {
      const existing = collections.find(c => c.name === ec.name);
      if (!existing) {
        collections.push(ec);
      } else {
        existing.mode = 'engine';
      }
    }
    
    // Group by Root Collection
    const rootMap = new Map();
    for (const col of collections) {
      const rootName = col.name.split('/')[0];
      if (!rootMap.has(rootName)) {
        rootMap.set(rootName, col.mode);
      } else {
        if (col.mode === 'engine') rootMap.set(rootName, 'engine'); // Engine overrides visually
      }
    }
    
    const rootCollections = [];
    for (const [name, mode] of rootMap.entries()) {
      rootCollections.push({ name, mode });
    }
    
    return rootCollections;
  } catch (err) {
    console.error(err);
    return [];
  }
});

ipcMain.handle('bancoz:getCollectionData', async (event, { name, mode }) => {
  try {
    const records = [];
    const baseDir = bancoz.pastaBanco();
    const fs = await import('fs/promises');

    if (mode === 'engine') {
      const engine = bancoz._getEngine();
      const dbPath = path.join(baseDir, 'db');
      const engineBaseLength = dbPath.length + 1;
      const engineCols = await walkDirRecursively(fs, dbPath, engineBaseLength, 'engine', []);
      
      for (const col of engineCols) {
        if (col.name === name || col.name.startsWith(name + '/')) {
          const data = await engine.getAll(col.name);
          for (const k in data) {
            records.push({
              key: k,
              value: data[k],
              _collection: col.name,
              _mode: 'engine'
            });
          }
        }
      }
    } else {
      bancoz.storage('json');
      const jsonIgnores = ['db', 'configs', 'llm'];
      const jsonBaseLength = baseDir.length + 1;
      const jsonCols = await walkDirRecursively(fs, baseDir, jsonBaseLength, 'json', jsonIgnores);
      
      for (const col of jsonCols) {
        if (col.name === name || col.name.startsWith(name + '/')) {
          const data = await bancoz.ler(col.name);
          if (data && typeof data === 'object') {
            for (const k in data) {
              records.push({
                key: k,
                value: data[k],
                _collection: col.name,
                _mode: 'json'
              });
            }
          }
        }
      }
    }
    
    return records;
  } catch (err) {
    console.error(err);
    return [];
  }
});

ipcMain.handle('bancoz:deleteKey', async (event, { collection, key, mode }) => {
  try {
    bancoz.storage(mode || 'json');
    await bancoz.deletar(collection, key);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
