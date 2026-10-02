#!/bin/bash
echo "🚀 Iniciando teste de stress (Node.js vs Go vs Python) simultaneamente..."
echo "Aguarde... Eles estão disputando I/O do disco e CPU agora mesmo!"
echo "--------------------------------------------------------"

# Limpa sujeiras de testes anteriores
rm -rf "BENCHMARK_DB"

# Roda o teste Node.js em background e guarda o log
node bench_node.js > node.log &

# Roda o teste Go em background e guarda o log
cd go_bench && go run bench_go.go > ../go.log &

# Roda o teste Python em background e guarda o log
python3 bench_python.py > python.log &

# Aguarda todos finalizarem a corrida
wait

echo "✅ Corrida finalizada!"
echo ""
echo "📊 RESULTADOS SEPARADOS:"
echo "========================================================"
cat node.log
echo "========================================================"
cat go.log
echo "========================================================"
cat python.log
echo "========================================================"

# Limpa os logs temporários
rm node.log go.log python.log
