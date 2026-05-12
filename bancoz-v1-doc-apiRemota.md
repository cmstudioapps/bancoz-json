# Bancoz v1.0 — Documentação organizada

Fonte: https://bancoz.vercel.app/

## Visão geral

A Bancoz v1.0 é uma API de arquivos/dados com autenticação por `api_key`.

A página informa:

- autenticação via `POST /login`
- endpoints CRUD tradicionais com `POST`
- um modo por parâmetros com `GET /get-data`
- status de armazenamento com `POST /storage-status`

## Autenticação

### `POST /login`

**Body:**

```json
{
  "email": "user@example.com",
  "senha": "123456"
}
```

**Resposta esperada:**

```json
{
  "ok": true,
  "api_key": "abc123...",
  "nome": "..."
}
```

## CRUD tradicional

A página lista estes endpoints:

- `POST /criar-arquivo`
- `POST /atualizar-arquivo`
- `POST /listar-arquivos`
- `POST /ler-arquivo`
- `POST /excluir-arquivo`

### `POST /criar-arquivo`

Envia:

```json
{
  "api_key": "sua_api_key",
  "filename": "users/joao",
  "content": { "nome": "João", "idade": 25 }
}
```

### `POST /atualizar-arquivo`

Envia:

```json
{
  "api_key": "sua_api_key",
  "filename": "users/joao",
  "content": { "idade": 26 }
}
```

### `POST /listar-arquivos`

Envia:

```json
{
  "api_key": "sua_api_key"
}
```

### `POST /ler-arquivo`

Envia:

```json
{
  "api_key": "sua_api_key",
  "filename": "users/joao"
}
```

### `POST /excluir-arquivo`

Envia:

```json
{
  "api_key": "sua_api_key",
  "filename": "users/joao"
}
```

## Modo fácil por query params

### `GET /get-data`

Parâmetros obrigatórios:

- `apiKey=abc123...`
- `filename=arquivo/nó/subnó/...`
- `acao=ler | postar | atualizar | deletar`

A página informa que outros params viram dados.

Exemplo:

```txt
/get-data?apiKey=abc123&filename=users/joao&acao=ler
```

### Ações

#### `acao=ler`

Lê sem alterar.

```txt
/get-data?apiKey=abc123&filename=teste/ju&acao=ler
```

#### `acao=postar`

Define valor primitivo.

```txt
/get-data?apiKey=abc123&filename=teste/ju/idade&acao=postar&idade=25
```

#### `acao=atualizar`

Faz merge de objeto e retorna atualizado.

```txt
/get-data?apiKey=abc123&filename=teste/ju&acao=atualizar&nome=João
```

#### `acao=deletar`

Remove props listadas.

```txt
/get-data?apiKey=abc123&filename=teste/ju&acao=deletar&nome
```

### Leaf Magic

A doc diz que, quando há um único parâmetro, ele vira o último segmento do path.

Exemplo:

```txt
/get-data?apiKey=abc123&filename=teste/campo&acao=postar&campo=valor123
```

Resultado indicado na doc:

```json
{
  "teste": {
    "campo": "valor123"
  }
}
```

## Status e limites

### `POST /storage-status`

Envia:

```json
{
  "api_key": "sua_api_key"
}
```

## Exemplos em JavaScript

```js
const API_KEY = 'sua_api_key';
const BASE_URL = 'https://bancoz.squareweb.app';

async function login(email, senha) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha })
  });

  return await res.json();
}

async function criarArquivo(filename, content) {
  const res = await fetch(`${BASE_URL}/criar-arquivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: API_KEY, filename, content })
  });

  return await res.json();
}

async function atualizarArquivo(filename, content) {
  const res = await fetch(`${BASE_URL}/atualizar-arquivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: API_KEY, filename, content })
  });

  return await res.json();
}

async function listarArquivos() {
  const res = await fetch(`${BASE_URL}/listar-arquivos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: API_KEY })
  });

  return await res.json();
}

async function lerArquivo(filename) {
  const res = await fetch(`${BASE_URL}/ler-arquivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: API_KEY, filename })
  });

  return await res.json();
}

async function excluirArquivo(filename) {
  const res = await fetch(`${BASE_URL}/excluir-arquivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: API_KEY, filename })
  });

  return await res.json();
}

async function getData(filename, acao, params = {}) {
  const url = new URL(`${BASE_URL}/get-data`);
  url.searchParams.set('apiKey', API_KEY);
  url.searchParams.set('filename', filename);
  url.searchParams.set('acao', acao);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url);
  return await res.json();
}
```

## Observação importante

A própria página tem uma inconsistência:

- ela lista `GET /get-data`
- mas no final diz: “Todos endpoints usam `POST`”

Então o documento acima preserva exatamente o que a página mostra, sem inventar regra extra.
