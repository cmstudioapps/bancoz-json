#!/bin/bash
echo "🚀 Iniciando teste ISOLADO (Node.js, Go e Python)..."
echo "Aguarde... Eles estão recebendo 100% dos recursos da máquina, um de cada vez."
echo "--------------------------------------------------------"

# 1. Corre o Node.js isolado
rm -rf "BENCHMARK_DB"
node bench_node.js > node.log
echo "✅ Node.js terminou sua corrida isolada."

# 2. Corre o Go isolado
rm -rf "BENCHMARK_DB"
cd go_bench && go run bench_go.go > ../go.log && cd ..
echo "✅ Go terminou sua corrida isolada."

# 3. Corre o Python isolado
rm -rf "BENCHMARK_DB"
python3 bench_python.py > python.log
echo "✅ Python terminou sua corrida isolada."

echo "--------------------------------------------------------"
echo "📊 RESULTADOS DA PERFORMANCE ISOLADA (VELOCIDADE MÁXIMA):"
echo "========================================================"
cat node.log
echo "========================================================"
cat go.log
echo "========================================================"
cat python.log
echo "========================================================"

# Limpa os logs temporários
rm node.log go.log python.log
