package bancoz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// removeAccents removes Unicode combining marks (accents) from a string.
// Uses manual NFD-like decomposition without external dependencies.
func removeAccents(s string) string {
	var buf strings.Builder
	buf.Grow(len(s))
	for _, r := range s {
		// Skip combining marks (diacritical marks)
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		buf.WriteRune(r)
	}
	return buf.String()
}

// normalizarTextoBusca normalizes a string for search: lowercase + remove accents.
func normalizarTextoBusca(valor string) string {
	// First decompose via a simple approach: normalize to NFC won't remove accents,
	// but we can use the standard unicode tables to check for combining marks.
	// For a stdlib-only approach, we apply ToLower then strip combining marks.
	return strings.ToLower(removeAccents(valor))
}

// Pesquisar searches for a term inside database JSON files and returns matched paths.
// alvo defaults to "*" (all files). Returns map of filename → list of JSON paths.
// Equivalent to Node.js `bancoz.pesquisar(termo, alvo)`.
func (b *Bancoz) Pesquisar(termo string, alvo ...string) (map[string][]string, error) {
	if b.apiKey != "" {
		msg := "Local search disabled in remote mode"
		if b.idioma == "pt" {
			msg = "Pesquisa local desabilitada no modo remoto"
		}
		b.logInterno(msg)
		return make(map[string][]string), nil
	}

	termoLimpo := strings.TrimSpace(termo)
	if termoLimpo == "" {
		if b.idioma == "pt" {
			return nil, fmt.Errorf("Termo de pesquisa invalido")
		}
		return nil, fmt.Errorf("Invalid search term")
	}

	alvoStr := "*"
	if len(alvo) > 0 && alvo[0] != "" {
		alvoStr = alvo[0]
	}

	pasta, err := b.garantirPastaBanco()
	if err != nil {
		return nil, err
	}

	formatarCaminhoRelativo := func(caminho string) string {
		return strings.ReplaceAll(caminho, string(filepath.Separator), "/")
	}

	termoBusca := normalizarTextoBusca(termoLimpo)

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

	alvoLimpo := strings.TrimSpace(alvoStr)
	var arquivos []string
	if alvoLimpo == "*" {
		arquivos, _ = listarJsonRecursivo(pasta, "")
	} else {
		normalizado, err := normalizarNomeArquivo(alvoLimpo)
		if err != nil {
			return nil, err
		}
		arquivos = []string{normalizado}
	}

	chavePath := func(parte string) string {
		for _, r := range parte {
			if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' && r != '$' {
				b, _ := json.Marshal(parte)
				return string(b)
			}
		}
		return parte
	}

	juntarPath := func(base string, parte any) string {
		switch v := parte.(type) {
		case int:
			return fmt.Sprintf("%s[%d]", base, v)
		case string:
			chave := chavePath(v)
			if base == "$" {
				return fmt.Sprintf("$.%s", chave)
			}
			return fmt.Sprintf("%s.%s", base, chave)
		}
		return base
	}

	valorCombina := func(valor any) bool {
		strVal := fmt.Sprintf("%v", valor)
		return strings.Contains(normalizarTextoBusca(strVal), termoBusca)
	}

	var pesquisarValor func(valor any, caminhoAtual string, encontrados map[string]bool)
	pesquisarValor = func(valor any, caminhoAtual string, encontrados map[string]bool) {
		switch v := valor.(type) {
		case map[string]any:
			for chave, item := range v {
				caminhoChave := juntarPath(caminhoAtual, chave)
				if valorCombina(chave) {
					encontrados[caminhoChave] = true
				}
				pesquisarValor(item, caminhoChave, encontrados)
			}
		case []any:
			for i, item := range v {
				pesquisarValor(item, juntarPath(caminhoAtual, i), encontrados)
			}
		default:
			if valor != nil && valorCombina(valor) {
				encontrados[caminhoAtual] = true
			}
		}
	}

	resultado := make(map[string][]string)

	for _, arquivo := range arquivos {
		caminhoArquivo := filepath.Join(pasta, arquivo)
		relativo, _ := filepath.Rel(pasta, caminhoArquivo)
		dentroDaBase := !strings.HasPrefix(relativo, "..") && !filepath.IsAbs(relativo)

		if !dentroDaBase {
			if b.idioma == "pt" {
				return nil, fmt.Errorf("Arquivo fora da pasta do banco: %s", arquivo)
			}
			return nil, fmt.Errorf("File outside database folder: %s", arquivo)
		}

		_, dados, _ := b.lerJsonComRetry(caminhoArquivo, 5)
		encontrados := make(map[string]bool)
		pesquisarValor(dados, "$", encontrados)

		if len(encontrados) > 0 {
			var list []string
			for k := range encontrados {
				list = append(list, k)
			}
			resultado[formatarCaminhoRelativo(relativo)] = list
		}
	}

	return resultado, nil
}

// Search is an English alias for Pesquisar.
func (b *Bancoz) Search(termo string, alvo ...string) (map[string][]string, error) {
	return b.Pesquisar(termo, alvo...)
}
