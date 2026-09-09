package main

import (
	"fmt"
	"time"
	bancoz "github.com/cmstudioapps/bancoz-json/go"
)

func main() {
	start := time.Now()
	fmt.Println("[Go] Iniciando benchmark...")
	
	db := bancoz.New()
	
	// Isola o banco de dados do benchmark para não sobrescrever dados reais do usuário
	db.Path("../BENCHMARK_DB")
	
	// Gera um objeto gigante com 100.000 nós
	giant := make(map[string]any)
	for i := 0; i < 100000; i++ {
		giant[fmt.Sprintf("node_%d", i)] = map[string]any{
			"id": i,
			"nome": "teste de performance go",
			"timestamp": time.Now().UnixMilli(),
			"ativo": true,
		}
	}
	
	// 1. Escrita massiva
	fmt.Println("[Go] Escrevendo JSON gigante...")
	db.Criar("bench_go", "", giant)
	
	// 2. Leitura massiva
	fmt.Println("[Go] Lendo JSON gigante...")
	db.Ler("bench_go")
	
	// 3. Deletar massivo
	fmt.Println("[Go] Deletando 10.000 nós...")
	chavesParaDeletar := make([]any, 10000)
	for i := 0; i < 10000; i++ {
		chavesParaDeletar[i] = fmt.Sprintf("node_%d", i)
	}
	db.Deletar("bench_go", "", chavesParaDeletar)
	
	fmt.Printf("[Go] 🏁 Finalizado em %d ms\n", time.Since(start).Milliseconds())
}
