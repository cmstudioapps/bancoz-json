package bancoz

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func (b *Bancoz) processarOperacaoRemota(op operacao) (any, error) {
	const BASE_URL = "https://bancoz.squareweb.app"
	var endpoint string
	
	normalizado, err := normalizarNomeArquivo(op.arquivo)
	if err != nil {
		return nil, err
	}
	filenameBase := strings.TrimSuffix(normalizado, ".json")

	switch op.tipo {
	case "criar", "create":
		endpoint = "/criar-arquivo"
		if noNaoInformado(op.no) {
			reqBody := map[string]string{
				"api_key": b.apiKey,
				"filename": filenameBase,
			}
			reqBytes, _ := json.Marshal(reqBody)
			resp, err := http.Post(BASE_URL+"/ler-arquivo", "application/json", bytes.NewReader(reqBytes))
			if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
				bodyBytes, _ := io.ReadAll(resp.Body)
				var dataExistente map[string]any
				json.Unmarshal(bodyBytes, &dataExistente)
				
				conteudoExistente := dataExistente["content"]
				if conteudoExistente == nil {
					conteudoExistente = dataExistente
				}
				if jsonTemDados(conteudoExistente) {
					return nil, fmt.Errorf("Arquivo %s já possui dados. Use atualizar() para alterar.", filenameBase)
				}
			}
			if resp != nil && resp.Body != nil {
				resp.Body.Close()
			}
		}
	case "atualizar", "update":
		endpoint = "/atualizar-arquivo"
	case "deletar", "delete":
		endpoint = "/excluir-arquivo"
	case "ler", "read":
		endpoint = "/ler-arquivo"
	default:
		return nil, fmt.Errorf("Tipo %s não suportado no modo remoto", op.tipo)
	}

	body := map[string]any{
		"api_key": b.apiKey,
		"filename": filenameBase,
	}

	if op.tipo == "criar" || op.tipo == "create" {
		if noNaoInformado(op.no) {
			body["content"] = op.dados
		} else {
			body["content"] = map[string]any{op.no: op.dados}
		}
	} else if op.tipo == "atualizar" || op.tipo == "update" {
		body["content"] = map[string]any{op.no: op.dados}
	}

	b.logInterno(fmt.Sprintf("API %s → %s", endpoint, filenameBase))

	reqBytes, _ := json.Marshal(body)
	resp, err := http.Post(BASE_URL+endpoint, "application/json", bytes.NewReader(reqBytes))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errText, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API %s %d: %s", endpoint, resp.StatusCode, string(errText))
	}

	var data map[string]any
	bodyBytes, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(bodyBytes, &data); err != nil {
		// Try parsing as simple response
		if op.tipo == "deletar" || op.tipo == "delete" {
			b.logInterno(fmt.Sprintf("%s remoto OK: %s", op.tipo, filenameBase))
			return true, nil
		}
		return nil, err
	}

	var resultado any
	if content, ok := data["content"]; ok {
		resultado = content
	} else {
		if op.tipo == "deletar" || op.tipo == "delete" {
			resultado = true
		} else {
			resultado = data
		}
	}

	b.logInterno(fmt.Sprintf("%s remoto OK: %s", op.tipo, filenameBase))
	return resultado, nil
}
