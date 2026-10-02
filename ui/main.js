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

ipcMain.handle('bancoz:listCollections', async () => {
  // Ler as pastas (no modo engine) ou arquivos json (no modo json)
  const engine = bancoz._getEngine();
  const baseDir = bancoz.pastaBanco();
  
  try {
    const collections = [];
    
    // Modo JSON: ler arquivos .json em BANCO Z/
    const fs = await import('fs/promises');
    try {
      const files = await fs.readdir(baseDir, { withFileTypes: true });
      for (const f of files) {
        if (f.isFile() && f.name.endsWith('.json')) {
          const name = f.name.replace('.json', '');
          // Não ler os dados ainda para economizar RAM, só ler as chaves
          collections.push({ name, mode: 'json' });
        }
      }
    } catch(e) {}
    
    // Modo Engine: listar pastas em BANCO Z/db/
    try {
      const dbPath = path.join(baseDir, 'db');
      const dirs = await fs.readdir(dbPath, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory()) {
          // Evitar duplicatas caso o user tenha migrado
          if (!collections.find(c => c.name === d.name)) {
            collections.push({ name: d.name, mode: 'engine' });
          } else {
            // Se tem nos dois, marca como híbrido/engine
            const col = collections.find(c => c.name === d.name);
            col.mode = 'engine';
          }
        }
      }
    } catch(e) {}
    
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
