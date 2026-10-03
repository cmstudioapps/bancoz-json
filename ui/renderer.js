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
let currentRecords = [];

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
  
  document.querySelectorAll('.collection-item').forEach(el => {
    if (el.querySelector('.collection-name').innerText === name) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
  
  currentTitle.innerText = name;
  currentModeBadge.innerText = mode.toUpperCase();
  currentModeBadge.className = `badge ${mode === 'engine' ? 'engine' : ''}`;
  currentModeBadge.classList.remove('hidden');
  
  searchInput.disabled = false;
  searchInput.value = '';
  
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

// Monta um objeto limpo a partir dos registros, filtrando por busca
function buildCleanObject(searchTerm) {
  const cleanObj = {};
  
  for (const rec of currentRecords) {
    if (searchTerm) {
      const valueStr = typeof rec.value === 'object' ? JSON.stringify(rec.value) : String(rec.value);
      if (!rec.key.toLowerCase().includes(searchTerm) && !valueStr.toLowerCase().includes(searchTerm)) {
        continue;
      }
    }
    cleanObj[rec.key] = rec.value;
  }
  
  return cleanObj;
}

// Renderizar como um único painel de código
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
  
  const cleanObj = buildCleanObject(searchTerm);
  const keys = Object.keys(cleanObj);
  
  if (keys.length === 0) {
    dataContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-message">
          <p>Nenhum resultado encontrado para "${searchTerm}"</p>
        </div>
      </div>
    `;
    return;
  }

  // Gera JSON com espaçamento visual entre registros
  let jsonLines = ['{'];
  const entries = Object.entries(cleanObj);
  
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];
    const valueStr = JSON.stringify(value, null, 2);
    const valueLines = valueStr.split('\n');
    
    // Chave do registro
    if (valueLines.length === 1) {
      // Valor simples numa linha só
      const comma = i < entries.length - 1 ? ',' : '';
      jsonLines.push(`  "${key}": ${valueStr}${comma}`);
    } else {
      // Valor objeto/array multi-linha: indentar cada linha
      jsonLines.push(`  "${key}": ${valueLines[0]}`);
      for (let j = 1; j < valueLines.length; j++) {
        const isLast = j === valueLines.length - 1;
        const comma = (isLast && i < entries.length - 1) ? ',' : '';
        jsonLines.push(`  ${valueLines[j]}${comma}`);
      }
    }
    
    // Linha em branco entre registros para separação visual
    if (i < entries.length - 1) {
      jsonLines.push('');
    }
  }
  
  jsonLines.push('}');
  
  const fullJson = jsonLines.join('\n');
  const highlighted = syntaxHighlight(fullJson);
  
  // Line numbers
  let lineNumbersHTML = '';
  for (let i = 1; i <= jsonLines.length; i++) {
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
  if (!currentRecords || currentRecords.length === 0) return;
  
  const cleanObj = buildCleanObject('');
  
  navigator.clipboard.writeText(JSON.stringify(cleanObj, null, 2)).then(() => {
    const btn = document.getElementById('btn-copy-json');
    const originalText = btn.innerHTML;
    btn.innerHTML = '✅ Copiado!';
    setTimeout(() => btn.innerHTML = originalText, 2000);
  });
});

// Iniciar app
init();
