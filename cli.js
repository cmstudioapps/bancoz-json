#!/usr/bin/env node
import path from 'path';

const args = process.argv.slice(2);
const binChamado = path.basename(process.argv[1] || '');
const comando = args[0] || 'help';
const deveVerCache = binChamado === 'bancoz-view-cache' || comando === 'view-cache';

function modoCache() {
  const indiceModo = binChamado === 'bancoz-view-cache' ? 0 : 1;
  const valor = args[indiceModo];

  if (valor === 'files' || valor === '--files') return 'files';
  if (valor === 'data' || valor === '--data') return 'data';
  return 'files';
}

if (deveVerCache) {
  const { default: bancoz } = await import('./bancoz.js');

  console.log('Inspecionando cache do processo atual do CLI...');
  console.log('O cache do Bancoz fica na RAM de cada processo Node.');
  console.log('Este comando nao consegue ler o cache de outro app ja rodando.');
  console.log('Para ver o cache do seu app, chame bancoz.getCache() dentro dele.');

  bancoz.getCache(true, modoCache());
} else {
  console.log(`
Bancoz v2.0.8
Pasta dados: ./BANCO Z/
API remota: bancoz.api_key('key')

Comandos:
  bancoz-view-cache  <- Visualiza o cache do processo atual do CLI
  bancoz view-cache  <- Visualiza o cache do processo atual do CLI
  bancoz help        <- Ajuda

Use em Node.js:
import bancoz from 'bancoz.js';
await bancoz.criar('users', 'id1', { nome: 'Joao' });
  `);
}
