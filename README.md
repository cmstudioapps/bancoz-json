# Bancoz

Um banco de dados JSON simples, direto e sem servidor para projetos Node.js e Python.

O Bancoz nasceu para aquele momento em que voce quer salvar dados de verdade, mas nao quer montar um banco, configurar ORM, abrir conexao, criar schema ou escrever `fs.readFile` + `JSON.parse` + `fs.writeFile` toda vez.

Com Bancoz, isto:

```js
await bancoz.criar('usuarios', 'ana', { nome: 'Ana', plano: 'pro' });
```

vira automaticamente um arquivo JSON em `BANCO Z/usuarios.json`.

## Por que usar?

- Simples: arquivos JSON legiveis, sem servidor e sem configuracao obrigatoria.
- Pratico: CRUD em uma linha para criar, ler, atualizar e deletar.
- Seguro para uso local: escrita atomica e lock por arquivo para reduzir conflito entre operacoes.
- Organizado: separa dados por arquivos e tambem aceita subpastas, como `loja/clientes`.
- Hibrido: usa disco local por padrao, ou API remota quando voce define `api_key`.
- Util: tem cache em memoria, backup, busca por texto, leitura de `.txt`, limites, analise dos arquivos e uma LLM local experimental.

## Bancoz vs fs

Com `fs`, voce normalmente precisa fazer isso:

```js
import { promises as fs } from 'fs';

const arquivo = './BANCO Z/usuarios.json';
const bruto = await fs.readFile(arquivo, 'utf8').catch(() => '{}');
const usuarios = JSON.parse(bruto);

usuarios.ana = { nome: 'Ana', plano: 'pro' };

await fs.mkdir('./BANCO Z', { recursive: true });
await fs.writeFile(arquivo, JSON.stringify(usuarios, null, 2));
```

Com Bancoz:

```js
await bancoz.criar('usuarios', 'ana', { nome: 'Ana', plano: 'pro' });
```

E pronto. O Bancoz cuida da pasta, do `.json`, da leitura, do parse, da escrita e da atualizacao.

## Instalacao

### Node.js

```bash
npm install bancoz
```

Em projetos ESM:

```js
import bancoz from 'bancoz';
```

Se voce estiver testando este repositorio localmente:

```js
import bancoz from './bancoz.js';
```

### Python

```bash
pip install bancoz
```

Uso em Python:

```py
from bancoz import bancoz

bancoz.criar('usuarios', 'ana', {
    'nome': 'Ana',
    'plano': 'pro'
})

usuario = bancoz.ler('usuarios', 'ana')
print(usuario)
```

A ideia da versao Python e manter a mesma experiencia: arquivo, no e dados.

## Uso rapido no Node.js

```js
import bancoz from 'bancoz';

await bancoz.criar('usuarios', 'ana', {
  nome: 'Ana',
  email: 'ana@email.com',
  plano: 'free'
});

await bancoz.atualizar('usuarios', 'ana', {
  plano: 'pro',
  ativo: true
});

const ana = await bancoz.ler('usuarios', 'ana');
console.log(ana);

await bancoz.deletar('usuarios', 'ana', 'email');
```

O arquivo gerado fica assim:

```txt
BANCO Z/
  usuarios.json
```

E o conteudo fica legivel:

```json
{
  "ana": {
    "nome": "Ana",
    "plano": "pro",
    "ativo": true
  }
}
```

## API principal

### `criar(arquivo, no, dados)`

Cria ou substitui um no dentro de um arquivo JSON.

```js
await bancoz.criar('produtos', 'cafe', {
  nome: 'Cafe especial',
  preco: 29.9
});
```

Tambem da para criar/substituir o arquivo inteiro omitindo o no:

```js
await bancoz.criar('config', null, {
  tema: 'claro',
  versao: 1
});
```

### `ler(arquivo, no?)`

Le um arquivo inteiro ou apenas um no.

```js
const todos = await bancoz.ler('produtos');
const cafe = await bancoz.ler('produtos', 'cafe');
```

Arquivos `.txt` tambem podem ser lidos diretamente:

```js
const texto = await bancoz.ler('llm/treino.txt');
```

Arquivos `.txt` suportam apenas leitura e nao usam nos.

### `atualizar(arquivo, no, dados)`

Atualiza parcialmente um objeto.

```js
await bancoz.atualizar('produtos', 'cafe', {
  estoque: 12
});
```

Tambem da para atualizar uma chave especifica:

```js
await bancoz.atualizar('produtos', 'cafe', 39.9, 'preco');
```

Para substituir o no inteiro:

```js
await bancoz.atualizar('produtos', 'cafe', {
  nome: 'Cafe novo',
  preco: 35
}, { substituir: true });
```

### `deletar(arquivo, no, chaves?)`

Remove um no inteiro ou somente algumas chaves.

```js
await bancoz.deletar('produtos', 'cafe', 'estoque');
await bancoz.deletar('produtos', 'cafe', ['preco', 'categoria']);
await bancoz.deletar('produtos', 'cafe');
```

## Subpastas

Voce pode organizar os dados por pastas sem criar diretorios manualmente.

```js
await bancoz.criar('loja/clientes', 'ana', { nome: 'Ana' });
await bancoz.criar('loja/pedidos', 'pedido-1', { total: 129.9 });
```

Resultado:

```txt
BANCO Z/
  loja/
    clientes.json
    pedidos.json
```

## Pasta personalizada

Por padrao, o Bancoz salva em `BANCO Z/` no diretorio atual.

```js
bancoz.path('./dados');

await bancoz.criar('usuarios', 'ana', { nome: 'Ana' });
```

Para voltar ao padrao:

```js
bancoz.path(null);
```

## Cache em memoria

Para leituras repetidas do mesmo JSON, ative o cache:

```js
bancoz.cache(true);

await bancoz.ler('usuarios');
await bancoz.ler('usuarios');
```

Com tempo de expiracao em minutos:

```js
bancoz.cache(true, 10);
```

Para inspecionar:

```js
bancoz.getCache(true, 'files');
bancoz.getCache(true, 'data');
```

Para obter apenas o snapshot em codigo, sem imprimir no terminal:

```js
const cache = bancoz.getCache(false, 'files');
console.log(cache.quantidade);
```

## Busca

Pesquise uma palavra em todos os JSONs locais:

```js
const resultado = await bancoz.search('ana', '*');
console.log(resultado);
```

Ou em um arquivo especifico:

```js
const resultado = await bancoz.pesquisar('pro', 'usuarios');
```

O retorno mostra os caminhos encontrados dentro do JSON.

## Backup, fila e logs

```js
bancoz.bk(true);     // cria .backup antes de alteracoes
bancoz.fila(true);   // processa operacoes em fila
bancoz.log(true);    // exibe logs no terminal
bancoz.lang('en');   // logs em ingles
```

Tambem existem aliases em ingles para configuracoes:

```js
await bancoz.backup(true);
await bancoz.queue(true);
await bancoz.language('en');
```

Aliases em ingles para CRUD:

```js
await bancoz.create('users', 'ana', { name: 'Ana' });
await bancoz.update('users', 'ana', { plan: 'pro' });
await bancoz.read('users', 'ana');
await bancoz.delete('users', 'ana');
```

## Limites

Defina limites simples para um arquivo local:

```js
await bancoz.limite('usuarios', 100, 500, 50);
const uso = await bancoz.getLimite('usuarios');
console.log(uso);
```

Ou limites por profundidade:

```js
await bancoz.limiteAvancado('usuarios', {
  0: { maxKeys: 100 },
  1: { maxKeys: 10, maxSubnodes: 50 }
});

const usoAvancado = await bancoz.getLimiteAvancado('usuarios');
console.log(usoAvancado);
```

Aliases em ingles:

```js
await bancoz.setLimit('users', 100, 500, 50);
await bancoz.advancedLimit('users', {
  0: { maxKeys: 100 },
  1: { maxKeys: 10 }
});

await bancoz.getLimit('users');
await bancoz.getAdvancedLimit('users');
```

## Modo remoto

O modo local e o padrao. Para usar a API remota:

```js
bancoz.api_key('sua_api_key');

await bancoz.criar('usuarios', 'ana', { nome: 'Ana' });
const usuarios = await bancoz.ler('usuarios');

bancoz.api_key(null); // volta para o modo local
```

Quando a chave esta ativa, as operacoes CRUD sao enviadas para `https://bancoz.squareweb.app`.

## Analise dos arquivos

```js
const relatorio = await bancoz.analise(true);
console.log(relatorio.quantidadeArquivos);
```

## Prompt no terminal

Use `prompt()` para pedir texto no terminal sem configurar `readline` manualmente:

```js
const nome = await bancoz.prompt('Seu nome: ');
await bancoz.criar('usuarios', bancoz.criarID(), { nome });
```

## Gerar IDs

```js
const id = bancoz.criarID();
await bancoz.criar('sessoes', id, { criadoEm: new Date().toISOString() });
```

Tambem da para controlar os caracteres e o tamanho:

```js
const idCurto = bancoz.criarID('abcdef012345', 8);
const idEnglish = bancoz.createID();
```

## LLM local experimental

O Bancoz inclui uma mini engine textual local baseada em contexto, n-gram e frequencia. Ela nao usa API externa, embeddings ou rede neural.

```js
const IA = bancoz.llm();

await IA.treinar('auto'); // ativa auto-treino com as mensagens recebidas
await IA.treinar('bancoz salva dados em json local');

const resposta = await IA.responder('bancoz salva', {
  maxPalavras: 20
});

console.log(resposta);
```

O modelo e salvo em:

```txt
BANCO Z/
  llm/
    llm.json
```

Metodos disponiveis na engine:

```js
await IA.carregar();
await IA.salvar();
await IA.treinar('texto para treino');
await IA.treinar(false); // ou 'manual', desativa auto-treino
await IA.responder('mensagem', { maxPalavras: 24 });
const aprendizado = await IA.aprendizado();
```

Tambem da para usar direto com `await` passando uma mensagem inicial:

```js
const resposta = await bancoz.llm('ola bancoz');
```

## CLI

O pacote instala o comando `bancoz`.

```bash
bancoz help
bancoz llm
bancoz view-cache
bancoz-view-cache
```

`bancoz llm` abre um chat local usando a LLM experimental. Os comandos de cache mostram o cache do processo atual do CLI; para ver o cache do seu app, use `bancoz.getCache()` dentro dele.

## Teste local

Este repositorio inclui exemplos em `teste.js` e `testeIA.js`.

```bash
npm start
```

Ou:

```bash
node teste.js
node testeIA.js
```

## Objetivo da bancoz

Use Bancoz quando voce quer persistencia simples, JSON legivel e codigo direto.

Ele nao tenta substituir bancos relacionais, documentos gigantes ou consultas complexas. Ele resolve bem o caso mais comum: salvar e ler dados pequenos/medios com o minimo de codigo possivel.
