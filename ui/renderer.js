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

// Renderizar visualizador de código único
function renderData(searchTerm = '') {
  dataContainer.innerHTML = '';
  document.getElementById('data-toolbar').style.display = 'flex';
  
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
  
  let filteredData = {};
  let count = 0;
  
  for (const key of keys) {
    const value = currentData[key];
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    
    if (searchTerm && !key.toLowerCase().includes(searchTerm) && !valueStr.toLowerCase().includes(searchTerm)) {
      continue;
    }
    
    count++;
    filteredData[key] = value;
  }
  
  if (count === 0) {
    dataContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-message">
          <p>Nenhum resultado encontrado para "${searchTerm}"</p>
        </div>
      </div>
    `;
    return;
  }

  // Gera o JSON formatado
  const jsonString = JSON.stringify(filteredData, null, 2);
  const highlighted = syntaxHighlight(jsonString);
  
  // Calcula numeração de linhas
  const lineCount = jsonString.split('\\n').length;
  let lineNumbersHTML = '';
  for (let i = 1; i <= lineCount; i++) {
    lineNumbersHTML += `<div>${i}</div>`;
  }
  
  dataContainer.innerHTML = `
    <div class="code-viewer">
      <div class="line-numbers">${lineNumbersHTML}</div>
      <div class="code-content" id="json-code-content">${highlighted}</div>
    </div>
  `;
}

// Botão de Copiar JSON
document.getElementById('btn-copy-json').addEventListener('click', () => {
  const content = document.getElementById('json-code-content');
  if (content) {
    // Usamos textContent para pegar o JSON puro sem as tags do syntax highlight
    navigator.clipboard.writeText(content.textContent).then(() => {
      const btn = document.getElementById('btn-copy-json');
      const originalText = btn.innerHTML;
      btn.innerHTML = '✅ Copiado!';
      setTimeout(() => btn.innerHTML = originalText, 2000);
    });
  }
});

// Iniciar app
init();
