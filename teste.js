import bancoz from './bancoz.js';

bancoz.path('./BANCO Z TESTE');
bancoz.cache(true);

const userId = 'ana';

await bancoz.criar('app/usuarios', userId, {
  nome: 'Ana',
  email: 'ana@email.com',
  plano: 'free',
  pontos: 10
});

await bancoz.atualizar('app/usuarios', userId, {
  plano: 'pro',
  pontos: 25,
  ativo: true
});

await bancoz.atualizar('app/usuarios', userId, 'ana@bancoz.dev', 'email');

const usuario = await bancoz.ler('app/usuarios', userId);
const todosUsuarios = await bancoz.ler('app/usuarios');
const busca = await bancoz.search('pro', 'app/usuarios');
const analise = await bancoz.analise(false);

console.log('Usuario salvo:');
console.log(usuario);

console.log('\nArquivo completo:');
console.log(todosUsuarios);

console.log('\nBusca por "pro":');
console.log(busca);

console.log('\nResumo da pasta local:');
console.log({
  pasta: analise.pasta,
  arquivos: analise.quantidadeArquivos,
  tamanho: analise.tamanhoTotalFormatado
});

console.log('\nCache:');
console.log(bancoz.getCache(false, 'files'));
