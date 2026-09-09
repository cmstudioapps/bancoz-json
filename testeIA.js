import bancoz from './bancoz.js';


bancoz.cache(true);

const IA = bancoz.llm();

await IA.treinar('auto');
const texto = await bancoz.ler('llm/treino.txt')
console.log(`Treino carregado: ${texto.length} caracteres`);
await IA.treinar(texto);

const msg = await bancoz.prompt('SUA MSG: ');
const resposta = await IA.responder(msg);

console.log('Resposta da IA:');
console.log(resposta);
