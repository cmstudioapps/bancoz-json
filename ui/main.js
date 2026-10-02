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
  return {
    path: bancoz.pastaBanco(),
    mode: bancoz.storageMode,
    version: '2.3.3'
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
    // Modo JSON: ler arquivos .json em BANCO Z/ (recursivo ignorando db, configs, llm)
    const jsonIgnores = ['db', 'configs', 'llm'];
    const jsonBaseLength = baseDir.length + 1; // +1 para barra
    const jsonCols = await walkDirRecursively(fs, baseDir, jsonBaseLength, 'json', jsonIgnores);
    collections = collections.concat(jsonCols);
    
    // Modo Engine: listar pastas em BANCO Z/db/ que contenham wal.log
    const dbPath = path.join(baseDir, 'db');
    const engineBaseLength = dbPath.length + 1;
    const engineCols = await walkDirRecursively(fs, dbPath, engineBaseLength, 'engine', []);
    
    // Merge de resultados (evita duplicação caso migrado)
    for (const ec of engineCols) {
      const existing = collections.find(c => c.name === ec.name);
      if (!existing) {
        collections.push(ec);
      } else {
        existing.mode = 'engine'; // Engine tem prioridade visual
      }
    }
    
    return collections;
  } catch (err) {
    console.error(err);
    return [];
  }
});

ipcMain.handle('bancoz:getCollectionData', async (event, { name, mode }) => {
  try {
    // Força o modo de storage temporariamente se quisermos ler específico,
    // mas o ideal é deixar o Bancoz resolver
    
    let result = {};
    if (mode === 'engine') {
      const engine = bancoz._getEngine();
      result = await engine.getAll(name);
    } else {
      bancoz.storage('json');
      result = await bancoz.ler(name);
    }
    
    return result || {};
  } catch (err) {
    console.error(err);
    return { _error: err.message };
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
