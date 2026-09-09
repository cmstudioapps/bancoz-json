# Bancoz Benchmark (Node.js vs Go)

Este diretório contém os scripts oficiais de teste de benchmark para provar a paridade matemática e comparar o poder de fogo entre a versão original em **Node.js** e o novo port nativo em **Go**.

## O que o teste faz?

Os scripts constroem um objeto gigante com 100.000 nós na memória RAM e realizam as operações:
1. `Criar()` (Write/Parse pro disco).
2. `Ler()` (Read massivo).
3. `Deletar()` (Excluindo 10.000 nós soltos de uma vez na memória).

## Como rodar localmente?

Basta ter o Node.js e o Go instalados na sua máquina. Oferecemos duas abordagens de teste:

### 1. Teste de Performance Isolado (Recomendado para velocidade máxima)
Mede a velocidade matemática pura de cada linguagem dando 100% dos recursos do computador para uma de cada vez.
```bash
./run_isolated.sh
```

### 2. Teste de Estresse / Concorrência
Coloca o Node.js e o Go para rodar exatamente ao mesmo tempo em segundo plano. O objetivo não é ver a "velocidade máxima" teórica, mas sim descobrir qual ecossistema lida melhor com a pressão quando o sistema operacional engasga por falta de I/O de disco e CPU.
```bash
./run_stress.sh
```
