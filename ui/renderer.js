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
let currentRecords = [];  // Array de { key, value, _collection, _mode }

const RECORDS_PER_PAGE = 20;
let visibleCount = RECORDS_PER_PAGE;

// Inicialização
async function init() {
  const info = await window.bancozAPI.getInfo();
  appVersion.innerText = info.version;
  appPath.innerText = info.path;
  appPath.title = info.path;
  
  await loadCollections();
  
  searchInput.addEventListener('input', (e) => {
    visibleCount = RECORDS_PER_PAGE;
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
  visibleCount = RECORDS_PER_PAGE;
  
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
  
  currentRecords = await window.bancozAPI.getCollectionData({ name, mode });
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

// Gerar bloco de código com line numbers para um valor
function buildCodeBlock(value) {
  const jsonStr = JSON.stringify(value, null, 2);
  const highlighted = syntaxHighlight(jsonStr);
  const lines = jsonStr.split('\n');
  
  let lineNumbersHTML = '';
  for (let i = 1; i <= lines.length; i++) {
    lineNumbersHTML += `<div>${i}</div>`;
  }
  
  return `<div class="code-viewer">
    <div class="line-numbers">${lineNumbersHTML}</div>
    <div class="code-content">${highlighted}</div>
  </div>`;
}

// Renderizar registros como blocos visuais separados
function renderData(searchTerm = '') {
  dataContainer.innerHTML = '';
  document.getElementById('data-toolbar').style.display = 'flex';
  
  if (!currentRecords || currentRecords.length === 0) {
    dataContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-message">
          <p>Coleção vazia</p>
        </div>
      </div>
    `;
    return;
  }
  
  // Filtrar registros pelo termo de busca
  let filtered = currentRecords;
  if (searchTerm) {
    filtered = currentRecords.filter(rec => {
      const valueStr = typeof rec.value === 'object' ? JSON.stringify(rec.value) : String(rec.value);
      return rec.key.toLowerCase().includes(searchTerm) || valueStr.toLowerCase().includes(searchTerm);
    });
  }
  
  if (filtered.length === 0) {
    dataContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-message">
          <p>Nenhum resultado encontrado para "${searchTerm}"</p>
        </div>
      </div>
    `;
    return;
  }
  
  // Paginação: mostrar apenas os N primeiros
  const toShow = filtered.slice(0, visibleCount);
  
  for (const record of toShow) {
    const block = document.createElement('div');
    block.className = 'record-block';
    
    block.innerHTML = `
      <div class="record-block-header">
        <span class="record-block-key">${record.key}</span>
      </div>
      ${buildCodeBlock(record.value)}
    `;
    
    dataContainer.appendChild(block);
  }
  
  // Botão "Carregar mais" se houver mais registros
  if (filtered.length > visibleCount) {
    const loadMore = document.createElement('button');
    loadMore.className = 'btn-load-more';
    loadMore.textContent = `Carregar mais (${filtered.length - visibleCount} restantes)`;
    loadMore.onclick = () => {
      visibleCount += RECORDS_PER_PAGE;
      renderData(searchTerm);
    };
    dataContainer.appendChild(loadMore);
  }
}

// Botão de Copiar JSON (copia todos os registros visíveis como um objeto limpo)
document.getElementById('btn-copy-json').addEventListener('click', () => {
  if (!currentRecords || currentRecords.length === 0) return;
  
  const cleanObj = {};
  for (const rec of currentRecords) {
    cleanObj[rec.key] = rec.value;
  }
  
  navigator.clipboard.writeText(JSON.stringify(cleanObj, null, 2)).then(() => {
    const btn = document.getElementById('btn-copy-json');
    const originalText = btn.innerHTML;
    btn.innerHTML = '✅ Copiado!';
    setTimeout(() => btn.innerHTML = originalText, 2000);
  });
});

// Iniciar app
init();
