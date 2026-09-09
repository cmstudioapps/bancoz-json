package bancoz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (b *Bancoz) Analise(exibirTerminal bool) (Resumo, error) {
	pasta, err := b.garantirPastaBanco()
	if err != nil {
		return Resumo{}, err
	}

	var listarJsonRecursivo func(diretorio string, prefixo string) ([]string, error)
	listarJsonRecursivo = func(diretorio string, prefixo string) ([]string, error) {
		entradas, err := os.ReadDir(diretorio)
		if err != nil {
			return nil, err
		}
		var arquivos []string
		for _, entrada := range entradas {
			if entrada.Name() == "configs" && prefixo == "" {
				continue
			}

			relativo := entrada.Name()
			if prefixo != "" {
				relativo = filepath.Join(prefixo, entrada.Name())
			}
			caminhoEntrada := filepath.Join(diretorio, entrada.Name())

			if entrada.IsDir() {
				subArquivos, _ := listarJsonRecursivo(caminhoEntrada, relativo)
				arquivos = append(arquivos, subArquivos...)
				continue
			}

			if strings.HasSuffix(strings.ToLower(entrada.Name()), ".json") {
				arquivos = append(arquivos, relativo)
			}
		}
		return arquivos, nil
	}

	arquivosJson, _ := listarJsonRecursivo(pasta, "")

	var resultados []ResumoArquivo

	for _, nome := range arquivosJson {
		caminhoArquivo := filepath.Join(pasta, nome)
		stat, err := os.Stat(caminhoArquivo)
		if err != nil {
			continue
		}

		inicio := time.Now()
		conteudoBytes, err := os.ReadFile(caminhoArquivo)
		duracaoMs := float64(time.Since(inicio).Nanoseconds()) / 1000000.0

		jsonValido := true
		quantidadeNos := 0

		if err == nil {
			var js any
			if err := json.Unmarshal(conteudoBytes, &js); err == nil {
				if slice, ok := js.([]any); ok {
					quantidadeNos = len(slice)
				} else if mp, ok := js.(map[string]any); ok {
					quantidadeNos = len(mp)
				}
			} else {
				jsonValido = false
			}
		} else {
			jsonValido = false
		}

		var bytesPorSegundo int64
		if duracaoMs > 0 {
			bytesPorSegundo = int64(float64(stat.Size()) / (duracaoMs / 1000.0))
		} else {
			bytesPorSegundo = stat.Size()
		}

		resultados = append(resultados, ResumoArquivo{
			Arquivo: nome,
			TamanhoBytes: stat.Size(),
			TamanhoFormatado: formatarBytes(stat.Size()),
			TempoLeituraMs: duracaoMs,
			VelocidadeBytesPorSegundo: bytesPorSegundo,
			VelocidadeFormatada: fmt.Sprintf("%s/s", formatarBytes(bytesPorSegundo)),
			JsonValido: jsonValido,
			QuantidadeNos: quantidadeNos,
		})
	}

	var totalBytes int64
	var totalTempoMs float64
	var maiorTamanho int64

	for _, r := range resultados {
		totalBytes += r.TamanhoBytes
		totalTempoMs += r.TempoLeituraMs
		if r.TamanhoBytes > maiorTamanho {
			maiorTamanho = r.TamanhoBytes
		}
	}

	mediaTempoMs := 0.0
	if len(resultados) > 0 {
		mediaTempoMs = totalTempoMs / float64(len(resultados))
	}

	resumo := Resumo{
		Pasta: pasta,
		QuantidadeArquivos: len(resultados),
		TamanhoTotalBytes: totalBytes,
		TamanhoTotalFormatado: formatarBytes(totalBytes),
		TempoTotalLeituraMs: totalTempoMs,
		TempoMedioLeituraMs: mediaTempoMs,
		Arquivos: resultados,
	}

	if exibirTerminal {
		fmt.Println("\n[BANCO Z ANALISE]")
		fmt.Printf("Pasta: %s\n", pasta)
		fmt.Printf("Arquivos JSON: %d\n", resumo.QuantidadeArquivos)
		fmt.Printf("Tamanho total: %s\n", resumo.TamanhoTotalFormatado)
		fmt.Printf("Tempo total de leitura: %.3f ms\n", resumo.TempoTotalLeituraMs)
		fmt.Printf("Tempo medio por arquivo: %.3f ms\n", resumo.TempoMedioLeituraMs)

		if len(resultados) == 0 {
			fmt.Printf("Nenhum arquivo JSON encontrado em BANCO Z.\n\n")
			return resumo, nil
		}

		fmt.Println("\nArquivos e tamanhos:")
		for _, item := range resultados {
			status := "JSON INVALIDO"
			if item.JsonValido {
				status = "JSON OK"
			}
			fmt.Printf("- %s | %s | %.3f ms | %s | %s\n", item.Arquivo, item.TamanhoFormatado, item.TempoLeituraMs, item.VelocidadeFormatada, status)
		}

		fmt.Println("\nGrafico de tamanho dos arquivos:")
		for _, item := range resultados {
			fmt.Printf("%s %s %s\n", truncarOuPadStr(item.Arquivo, 24), desenharBarra(float64(item.TamanhoBytes), float64(maiorTamanho), 28, "#"), item.TamanhoFormatado)
		}
		fmt.Println("")
	}

	return resumo, nil
}
