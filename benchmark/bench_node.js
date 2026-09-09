import bancoz from '../bancoz.js';

async function run() {
  const start = Date.now();
  console.log("[Node.js] Iniciando benchmark...");
  
  // Isola o banco de dados do benchmark para não sobrescrever dados reais do usuário
  bancoz.path('./BENCHMARK_DB');
  
  // Gera um objeto gigante com 100.000 nós
  const giant = {};
  for(let i=0; i<100000; i++) {
    giant['node_'+i] = { 
        id: i, 
        nome: "teste de performance nodejs", 
        timestamp: Date.now(),
        ativo: true 
    };
  }
  
  // 1. Escrita massiva (escreve o objeto gigante no disco)
  console.log("[Node.js] Escrevendo JSON gigante...");
  await bancoz.criar('bench_node', null, giant);
  
  // 2. Leitura massiva (lê e faz parse do JSON gigante)
  console.log("[Node.js] Lendo JSON gigante...");
  await bancoz.ler('bench_node');
  
  // 3. Deletar massivo (deleta 10.000 nós)
  console.log("[Node.js] Deletando 10.000 nós...");
  const chavesParaDeletar = [];
  for(let i=0; i<10000; i++) chavesParaDeletar.push('node_'+i);
  await bancoz.deletar('bench_node', null, chavesParaDeletar);
  
  console.log(`[Node.js] 🏁 Finalizado em ${Date.now() - start} ms`);
}

run();
