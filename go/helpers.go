package bancoz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// --------------- JSON helpers ---------------

// clonarJson deep-clones a JSON-compatible value via marshal/unmarshal.
// Equivalent to Node.js JSON.parse(JSON.stringify(valor)).
func clonarJson(valor any) any {
	if valor == nil {
		return nil
	}
	b, err := json.Marshal(valor)
	if err != nil {
		return nil
	}
	var result any
	if err := json.Unmarshal(b, &result); err != nil {
		return nil
	}
	return result
}

// jsonTemDados checks if a JSON value contains data (non-nil, non-empty).
// Equivalent to Node.js jsonTemDados.
func jsonTemDados(valor any) bool {
	if valor == nil {
		return false
	}
	switch v := valor.(type) {
	case map[string]any:
		return len(v) > 0
	case []any:
		return len(v) > 0
	default:
		return true
	}
}

// isObjetoSimples checks if value is a plain object (map), not nil and not array.
// Equivalent to Node.js isObjetoSimples.
func isObjetoSimples(valor any) bool {
	if valor == nil {
		return false
	}
	_, ok := valor.(map[string]any)
	return ok
}

// temChave checks if an object has a specific key.
// Equivalent to Node.js Object.prototype.hasOwnProperty.call(obj, key).
func temChave(obj map[string]any, key string) bool {
	_, ok := obj[key]
	return ok
}

// noNaoInformado checks if a node name was not provided (empty string).
// Equivalent to Node.js `no === null || typeof no === 'undefined'`.
func noNaoInformado(no string) bool {
	return no == ""
}

// operacaoEhLeitura checks if the operation type is a read.
func operacaoEhLeitura(tipo string) bool {
	return tipo == "ler" || tipo == "read"
}

// operacaoEhCriacao checks if the operation type is a create.
func operacaoEhCriacao(tipo string) bool {
	return tipo == "criar" || tipo == "create"
}

// operacaoEhAtualizacao checks if the operation type is an update.
func operacaoEhAtualizacao(tipo string) bool {
	return tipo == "atualizar" || tipo == "update"
}

// --------------- File name helpers ---------------

// normalizarNomeArquivo validates and normalizes a file name.
// Ensures .json extension, rejects absolute paths and traversal.
// Equivalent to Node.js normalizarNomeArquivo.
func normalizarNomeArquivo(arquivo string) (string, error) {
	if arquivo == "" {
		return "", fmt.Errorf("Nome de arquivo inválido")
	}

	nome := strings.TrimSpace(arquivo)
	if len(nome) == 0 {
		return "", fmt.Errorf("Nome de arquivo inválido")
	}

	if filepath.IsAbs(nome) {
		return "", fmt.Errorf("Nome de arquivo inválido: não use caminho absoluto em '%s'", arquivo)
	}

	// Split by both forward and back slashes (matching Node.js behavior)
	partes := splitPath(nome)
	for _, parte := range partes {
		if len(parte) == 0 || parte == "." || parte == ".." {
			return "", fmt.Errorf("Nome de arquivo inválido: '%s'", arquivo)
		}
	}

	// Append .json if missing
	ultimo := len(partes) - 1
	if !strings.HasSuffix(partes[ultimo], ".json") {
		partes[ultimo] = partes[ultimo] + ".json"
	}

	return filepath.Join(partes...), nil
}

// splitPath splits a file path by both / and \ separators.
func splitPath(name string) []string {
	// Replace backslashes with forward slashes, then split
	normalized := strings.ReplaceAll(name, "\\", "/")
	parts := strings.Split(normalized, "/")
	// Filter empty parts (from leading/trailing/double slashes)
	var result []string
	for _, p := range parts {
		if p != "" {
			result = append(result, p)
		}
	}
	if len(result) == 0 {
		return []string{name}
	}
	return result
}

// --------------- Directory helpers ---------------

// garantirPastaBanco ensures the data directory exists and returns its path.
func (b *Bancoz) garantirPastaBanco() (string, error) {
	pasta := b.pastaBanco()
	if err := os.MkdirAll(pasta, 0755); err != nil {
		return "", err
	}
	return pasta, nil
}

// garantirPastaConfigsBanco ensures the configs directory exists and returns its path.
func (b *Bancoz) garantirPastaConfigsBanco() (string, error) {
	pasta := b.pastaConfigsBanco()
	if err := os.MkdirAll(pasta, 0755); err != nil {
		return "", err
	}
	return pasta, nil
}

// --------------- JSON serialization helpers ---------------

// jsonMarshalIndent serializes data with 2-space indentation (matching Node.js JSON.stringify(x, null, 2)).
func jsonMarshalIndent(v any) ([]byte, error) {
	return json.MarshalIndent(v, "", "  ")
}

// jsonParseAny parses a JSON byte slice into any (map[string]any / []any / primitives).
func jsonParseAny(data []byte) (any, error) {
	var result any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// formatarJsonParaTerminal formats a JSON value with 2-space indentation.
func formatarJsonParaTerminal(valor any) string {
	b, err := json.MarshalIndent(valor, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", valor)
	}
	return string(b)
}

// imprimirAtualizacaoNoTerminal prints a before/after update to stdout.
func (b *Bancoz) imprimirAtualizacaoNoTerminal(arquivo, no string, antes, depois any) {
	if !b.logAtivo {
		return
	}

	var titulo, labelAntes, labelDepois string
	if b.idioma == "en" {
		titulo = fmt.Sprintf("[BANCO Z] Node updated: %s/%s", arquivo, no)
		labelAntes = "Before:"
		labelDepois = "After:"
	} else {
		titulo = fmt.Sprintf("[BANCO Z] Nó atualizado: %s/%s", arquivo, no)
		labelAntes = "Anterior:"
		labelDepois = "Atual:"
	}

	fmt.Println(titulo)
	fmt.Println(labelAntes)
	fmt.Println(formatarJsonParaTerminal(antes))
	fmt.Println(labelDepois)
	fmt.Println(formatarJsonParaTerminal(depois))
}

// --------------- Formatting helpers ---------------

// formatarBytes formats a byte count into a human-readable string.
func formatarBytes(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	}
	if bytes < 1024*1024 {
		return fmt.Sprintf("%.2f KB", float64(bytes)/1024)
	}
	return fmt.Sprintf("%.2f MB", float64(bytes)/(1024*1024))
}

// desenharBarra draws a simple bar chart in the terminal.
func desenharBarra(valor, maximo float64, largura int, caractere string) string {
	if maximo <= 0 {
		return strings.Repeat(" ", largura)
	}
	preenchido := int(float64(largura) * valor / maximo)
	if preenchido < 1 {
		preenchido = 1
	}
	if preenchido > largura {
		preenchido = largura
	}
	return strings.Repeat(caractere, preenchido) + strings.Repeat(" ", largura-preenchido)
}

// truncarOuPadStr pads or truncates a string to exactly n characters.
func truncarOuPadStr(s string, n int) string {
	if len(s) >= n {
		return s[:n]
	}
	return s + strings.Repeat(" ", n-len(s))
}

// fileExists checks if a file exists on disk.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
