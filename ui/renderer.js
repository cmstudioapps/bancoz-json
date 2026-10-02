// Elementos da UI
const appVersion = document.getElementById('app-version');
const appPath = document.getElementById('app-path');
const collectionsList = document.getElementById('collections-list');
const currentTitle = document.getElementById('current-collection-title');
const currentModeBadge = document.getElementById('current-mode-badge');
const dataContainer = document.getElementById('data-container');
const searchInput = document.getElementById('search-input');

let currentCollection = null;
let currentMode = null;
let currentData = {};

// Inicialização
async function init() {
  const info = await window.bancozAPI.getInfo();
  appVersion.innerText = info.version;
  appPath.innerText = info.path;
  appPath.title = info.path;
  
  await loadCollections();
  
  searchInput.addEventListener('input', (e) => {
    renderData(e.target.value.toLowerCase());
  });
}

// Carregar lista de coleções
async function loadCollections() {
  const collections = await window.bancozAPI.listCollections();
  
  collectionsList.innerHTML = '';
  
  if (collections.length === 0) {
    collectionsList.innerHTML = '<li class="collection-item"><span class="collection-name text-muted">Vazio</span></li>';
    return;
  }
  
  collections.sort((a, b) => a.name.localeCompare(b.name));
  
  collections.forEach(col => {
    const li = document.createElement('li');
    li.className = 'collection-item';
    li.onclick = () => selectCollection(col.name, col.mode);
    
    li.innerHTML = `
      <span class="collection-name">${col.name}</span>
      <span class="badge ${col.mode === 'engine' ? 'engine' : ''}">${col.mode.toUpperCase()}</span>
    `;
    
    collectionsList.appendChild(li);
  });
}

// Selecionar coleção e carregar dados
async function selectCollection(name, mode) {
  currentCollection = name;
  currentMode = mode;
  
  // Atualizar visual da lista
  document.querySelectorAll('.collection-item').forEach(el => {
    if (el.querySelector('.collection-name').innerText === name) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
  
  // Atualizar Header
  currentTitle.innerText = name;
  currentModeBadge.innerText = mode.toUpperCase();
  currentModeBadge.className = `badge ${mode === 'engine' ? 'engine' : ''}`;
  currentModeBadge.classList.remove('hidden');
  
  searchInput.disabled = false;
  searchInput.value = '';
  
  // Carregar dados
  dataContainer.innerHTML = '<div class="empty-state"><div class="empty-message">Carregando dados...</div></div>';
  
  currentData = await window.bancozAPI.getCollectionData({ name, mode });
  renderData();
}

// Formatar JSON com syntax highlight
function syntaxHighlight(json) {
  if (typeof json != 'string') {
    json = JSON.stringify(json, undefined, 2);
  }
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
        if (/:$/.test(match)) {
            cls = 'json-key';
        } else {
            cls = 'json-string';
        }
    } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
    } else if (/null/.test(match)) {
        cls = 'json-null';
    }
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

// Deletar um registro
async function deleteRecord(composedKey) {
  if (confirm(`Tem certeza que deseja deletar este registro?`)) {
    const parts = composedKey.split('::');
    const actualKey = parts.pop();
    const collection = parts.join('::');

    const res = await window.bancozAPI.deleteKey({ 
      collection: collection, 
      key: actualKey, 
      mode: currentMode 
    });
    
    if (res.success) {
      delete currentData[composedKey];
      renderData(searchInput.value.toLowerCase());
    } else {
      alert('Erro ao deletar: ' + res.error);
    }
  }
}

// Renderizar cards de dados
function renderData(searchTerm = '') {
  dataContainer.innerHTML = '';
  
  const keys = Object.keys(currentData);
  
  if (keys.length === 0) {
    dataContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-message">
          <p>Coleção vazia</p>
        </div>
      </div>
    `;
    return;
  }
  
  let count = 0;
  
  for (const key of keys) {
    const value = currentData[key];
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    
    if (searchTerm && !key.toLowerCase().includes(searchTerm) && !valueStr.toLowerCase().includes(searchTerm)) {
      continue;
    }
    
    count++;
    
    const displayKey = key.includes('::') ? key.split('::').pop() : key;
    
    const card = document.createElement('div');
    card.className = 'record-card';
    
    card.innerHTML = `
      <div class="record-header">
        <span class="record-key">${displayKey}</span>
        <button class="btn-delete" title="Deletar registro" onclick="deleteRecord('${key}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </button>
      </div>
      <div class="record-body">${syntaxHighlight(value)}</div>
    `;
    
    dataContainer.appendChild(card);
  }
  
  if (count === 0) {
    dataContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-message">
          <p>Nenhum resultado encontrado para "${searchTerm}"</p>
        </div>
      </div>
    `;
  }
}

// Iniciar app
init();
