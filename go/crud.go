package bancoz

import (
	"encoding/json"
	"fmt"
	"path/filepath"
)

// --------------- Public CRUD API (Portuguese) ---------------

// Criar creates data in a JSON file.
// If no is empty, sets the entire file content to dados.
// If no is provided, sets dadosArquivo[no] = dados.
// Equivalent to Node.js `bancoz.criar(arquivo, no, dados)`.
func (b *Bancoz) Criar(arquivo string, no string, dados any) (any, error) {
	return b.executarOperacao("criar", arquivo, no, dados, nil)
}

// Ler reads data from a JSON file.
// If no is omitted/empty, reads the entire file.
// If no is provided, reads dadosArquivo[no].
// Equivalent to Node.js `bancoz.ler(arquivo, no?)`.
func (b *Bancoz) Ler(arquivo string, no ...string) (any, error) {
	n := ""
	if len(no) > 0 {
		n = no[0]
	}
	return b.executarOperacao("ler", arquivo, n, nil, nil)
}

// Atualizar updates data in a JSON file.
// Optional opts[0] can be:
//   - string: specific key to update (e.g., "email")
//   - map[string]any with "substituir": true to replace the entire node
//
// Equivalent to Node.js `bancoz.atualizar(arquivo, no, dados, chave?)`.
func (b *Bancoz) Atualizar(arquivo string, no string, dados any, opts ...any) (any, error) {
	var chave any
	if len(opts) > 0 {
		chave = opts[0]
	}
	return b.executarOperacao("atualizar", arquivo, no, dados, chave)
}

// Deletar deletes data from a JSON file.
// If chaves is omitted, deletes the entire node.
// chaves can be:
//   - string: single key to delete
//   - []string: multiple keys to delete
//   - []any: multiple keys to delete
//   - map[string]any: delete keys from the map's keys
//
// Equivalent to Node.js `bancoz.deletar(arquivo, no, chaves?)`.
func (b *Bancoz) Deletar(arquivo string, no string, chaves ...any) (any, error) {
	var ch any
	if len(chaves) > 0 {
		ch = chaves[0]
	}
	return b.executarOperacao("deletar", arquivo, no, ch, nil)
}

// --------------- Public CRUD API (English aliases) ---------------

// Create is an English alias for Criar.
func (b *Bancoz) Create(arquivo string, no string, dados any) (any, error) {
	return b.Criar(arquivo, no, dados)
}

// Read is an English alias for Ler.
func (b *Bancoz) Read(arquivo string, no ...string) (any, error) {
	return b.Ler(arquivo, no...)
}

// Update is an English alias for Atualizar.
func (b *Bancoz) Update(arquivo string, no string, dados any, opts ...any) (any, error) {
	return b.Atualizar(arquivo, no, dados, opts...)
}

// Delete is an English alias for Deletar.
func (b *Bancoz) Delete(arquivo string, no string, chaves ...any) (any, error) {
	return b.Deletar(arquivo, no, chaves...)
}

// --------------- Core operation processor ---------------

// processarOperacao processes a single database operation.
// This is the heart of the CRUD system.
func (b *Bancoz) processarOperacao(op operacao) (any, error) {
	// Remote mode: delegate to API
	if b.apiKey != "" {
		b.logInterno(fmt.Sprintf("Operação %s via API remota (key ativa)", op.tipo))
		return b.processarOperacaoRemota(op)
	}

	// Local mode
	pasta, err := b.garantirPastaBanco()
	if err != nil {
		return nil, err
	}

	nomeArquivo, err := normalizarNomeArquivo(op.arquivo)
	if err != nil {
		return nil, err
	}

	caminhoArquivo := filepath.Join(pasta, nomeArquivo)
	apenasLeitura := operacaoEhLeitura(op.tipo)

	executar := func() (any, error) {
		b.logInterno(fmt.Sprintf("Iniciando operação: %s em %s/%s", op.tipo, op.arquivo, op.no))

		// Read current file content
		conteudo, dadosLidos, err := b.lerJsonComRetry(caminhoArquivo, 5)
		if err != nil {
			return nil, err
		}

		dadosArquivo, ok := dadosLidos.(map[string]any)
		if !ok {
			if dadosLidos == nil {
				dadosArquivo = make(map[string]any)
			} else {
				// File contains non-object data (e.g., array at root)
				// For create without node, this is fine; for others we need a map
				if operacaoEhCriacao(op.tipo) && noNaoInformado(op.no) {
					// Will be replaced entirely
					dadosArquivo = nil
				} else if apenasLeitura && noNaoInformado(op.no) {
					// Return raw data
					return dadosLidos, nil
				} else {
					dadosArquivo = make(map[string]any)
				}
			}
		}

		// Check if file already has data (for create without node)
		if operacaoEhCriacao(op.tipo) && noNaoInformado(op.no) && conteudo != "" && jsonTemDados(dadosLidos) {
			return nil, fmt.Errorf("Arquivo %s já possui dados. Use atualizar() para alterar.", op.arquivo)
		}

		// Create backup before modification
		if !apenasLeitura && b.backupAtivo && conteudo != "" {
			caminhoBackup := caminhoArquivo + ".backup"
			if err := b.escreverArquivoAtomico(caminhoBackup, conteudo); err != nil {
				b.logInterno(fmt.Sprintf("ERRO ao criar backup: %s", err.Error()))
			} else {
				b.logInterno(fmt.Sprintf("Backup criado: %s (local only)", filepath.Base(caminhoBackup)))
			}
		}

		// Check limits for create/update
		if b.apiKey == "" && (operacaoEhCriacao(op.tipo) || operacaoEhAtualizacao(op.tipo)) {
			var dadosParaLimite any
			if operacaoEhCriacao(op.tipo) && noNaoInformado(op.no) {
				dadosParaLimite = op.dados
			} else {
				dadosParaLimite = map[string]any{op.no: op.dados}
			}
			if err := b.verificarLimite(op.arquivo, dadosParaLimite); err != nil {
				return nil, err
			}
		}

		// Execute operation
		var resultado any
		var dadosFinais any // what to write back to disk
		var atualizacaoTerminal *[4]any // {arquivo, no, antes, depois}

		switch op.tipo {
		case "criar", "create":
			if noNaoInformado(op.no) {
				dadosFinais = op.dados
				resultado = op.dados
				b.logInterno(fmt.Sprintf("Dados criados em %s", op.arquivo))
			} else {
				if dadosArquivo == nil {
					dadosArquivo = make(map[string]any)
				}
				dadosArquivo[op.no] = op.dados
				dadosFinais = dadosArquivo
				resultado = op.dados
				b.logInterno(fmt.Sprintf("Dados criados em %s/%s", op.arquivo, op.no))
			}

		case "atualizar", "update":
			if dadosArquivo == nil {
				dadosArquivo = make(map[string]any)
			}

			mostrarNoTerminal := b.logAtivo
			var antesAtualizacao any
			if mostrarNoTerminal {
				antesAtualizacao = clonarJson(dadosArquivo[op.no])
			}

			// Determine if chave is a specific key string
			chaveEspecifica := ""
			if s, ok := op.chave.(string); ok && s != "" {
				chaveEspecifica = s
			}

			// Determine if chave is an options object (e.g., {substituir: true})
			var opcoes map[string]any
			if isObjetoSimples(op.chave) && chaveEspecifica == "" {
				opcoes, _ = op.chave.(map[string]any)
			}

			if chaveEspecifica != "" {
				// Update a specific key within the node
				noData, ok := dadosArquivo[op.no].(map[string]any)
				if !ok {
					noData = make(map[string]any)
					dadosArquivo[op.no] = noData
				}
				noData[chaveEspecifica] = op.dados
				resultado = dadosArquivo[op.no]
				b.logInterno(fmt.Sprintf("Chave '%s' atualizada em %s/%s", chaveEspecifica, op.arquivo, op.no))
				if mostrarNoTerminal {
					atualizacaoTerminal = &[4]any{op.arquivo, op.no, antesAtualizacao, clonarJson(dadosArquivo[op.no])}
				}
			} else if opcoes != nil {
				if sub, ok := opcoes["substituir"]; ok && sub == true {
					// Replace entire node
					dadosArquivo[op.no] = op.dados
					resultado = op.dados
					b.logInterno(fmt.Sprintf("Nó completo atualizado em %s/%s", op.arquivo, op.no))
					if mostrarNoTerminal {
						atualizacaoTerminal = &[4]any{op.arquivo, op.no, antesAtualizacao, clonarJson(dadosArquivo[op.no])}
					}
				}
			} else if isObjetoSimples(op.dados) {
				// Partial update via object merge
				noData, ok := dadosArquivo[op.no].(map[string]any)
				if !ok {
					if dadosArquivo[op.no] != nil && !isObjetoSimples(dadosArquivo[op.no]) {
						errMsg := fmt.Sprintf("Nó '%s' não é um objeto em %s", op.no, op.arquivo)
						return nil, fmt.Errorf("%s", errMsg)
					}
					noData = make(map[string]any)
					dadosArquivo[op.no] = noData
				}

				atualizacoes, _ := op.dados.(map[string]any)
				for k, v := range atualizacoes {
					noData[k] = v
				}
				resultado = dadosArquivo[op.no]
				b.logInterno(fmt.Sprintf("Nó '%s' atualizado em %s", op.no, op.arquivo))
				if mostrarNoTerminal {
					atualizacaoTerminal = &[4]any{op.arquivo, op.no, antesAtualizacao, clonarJson(dadosArquivo[op.no])}
				}
			} else {
				// Replace entire node (fallback)
				dadosArquivo[op.no] = op.dados
				resultado = op.dados
				b.logInterno(fmt.Sprintf("Nó completo atualizado em %s/%s", op.arquivo, op.no))
				if mostrarNoTerminal {
					atualizacaoTerminal = &[4]any{op.arquivo, op.no, antesAtualizacao, clonarJson(dadosArquivo[op.no])}
				}
			}
			dadosFinais = dadosArquivo

		case "deletar", "delete":
			if dadosArquivo == nil {
				dadosArquivo = make(map[string]any)
			}

			deletarChaves := op.dados
			deletarNoInteiro := noNaoInformado2(deletarChaves)

			if deletarNoInteiro {
				// Delete entire node
				if _, exists := dadosArquivo[op.no]; exists {
					delete(dadosArquivo, op.no)
					resultado = true
					b.logInterno(fmt.Sprintf("Nó '%s' deletado de %s", op.no, op.arquivo))
				} else {
					resultado = false
					b.logInterno(fmt.Sprintf("Nó '%s' não encontrado em %s", op.no, op.arquivo))
				}
			} else {
				// Delete specific keys from node
				if _, exists := dadosArquivo[op.no]; !exists {
					resultado = false
					b.logInterno(fmt.Sprintf("Nó '%s' não encontrado em %s", op.no, op.arquivo))
					dadosFinais = dadosArquivo
					goto writeBack
				}

				noData, ok := dadosArquivo[op.no].(map[string]any)
				if !ok {
					return nil, fmt.Errorf("Nó '%s' não é um objeto em %s", op.no, op.arquivo)
				}

				chavesParaDeletar, err := extrairChavesParaDeletar(deletarChaves)
				if err != nil {
					return nil, fmt.Errorf("Parâmetro de chaves inválido para deletar em %s/%s", op.arquivo, op.no)
				}

				// Check for non-existent keys
				var chavesInexistentes []string
				for _, k := range chavesParaDeletar {
					if !temChave(noData, k) {
						chavesInexistentes = append(chavesInexistentes, k)
					}
				}
				if len(chavesInexistentes) > 0 {
					return nil, fmt.Errorf("Chave(s) inexistente(s) no nó '%s': %s", op.no, joinStrings(chavesInexistentes, ", "))
				}

				for _, k := range chavesParaDeletar {
					delete(noData, k)
				}
				resultado = dadosArquivo[op.no]
				b.logInterno(fmt.Sprintf("Chave(s) deletada(s) de %s/%s", op.arquivo, op.no))
			}
			dadosFinais = dadosArquivo

		case "ler", "read":
			if noNaoInformado(op.no) {
				resultado = dadosLidos // return the raw parsed data (could be map or array)
				b.logInterno(fmt.Sprintf("Leitura completa de %s", op.arquivo))
			} else {
				if dadosArquivo != nil {
					val, exists := dadosArquivo[op.no]
					if exists {
						resultado = val
					}
				}
				if resultado != nil {
					b.logInterno(fmt.Sprintf("Leitura de %s/%s bem-sucedida", op.arquivo, op.no))
				} else {
					b.logInterno(fmt.Sprintf("Leitura de %s/%s não encontrado", op.arquivo, op.no))
				}
			}
			return resultado, nil
		}

	writeBack:
		if dadosFinais == nil {
			dadosFinais = dadosArquivo
		}

		// Update cache before writing to disk, take snapshot for rollback
		snapshotAntes := b.snapshotCacheArquivo(caminhoArquivo)

		conteudoAtualizado, err := jsonMarshalIndent(dadosFinais)
		if err != nil {
			return nil, fmt.Errorf("erro ao serializar dados: %w", err)
		}

		b.atualizarCacheArquivoAntesDoDisco(caminhoArquivo, dadosFinais)

		if err := b.escreverArquivoAtomico(caminhoArquivo, string(conteudoAtualizado)); err != nil {
			b.restaurarSnapshotCacheArquivo(snapshotAntes)
			return nil, err
		}

		b.logInterno(fmt.Sprintf("Arquivo %s salvo com sucesso", op.arquivo))

		if atualizacaoTerminal != nil {
			b.imprimirAtualizacaoNoTerminal(
				atualizacaoTerminal[0].(string),
				atualizacaoTerminal[1].(string),
				atualizacaoTerminal[2],
				atualizacaoTerminal[3],
			)
		}

		return resultado, nil
	}

	// Wrapper that adds backup error recovery
	executarComRecuperacao := func() (any, error) {
		result, err := executar()
		if err != nil {
			b.logInterno(fmt.Sprintf("ERRO: %s", err.Error()))
			// Try to restore backup on error
			if !apenasLeitura && b.backupAtivo {
				caminhoBackup := caminhoArquivo + ".backup"
				if fileExists(caminhoBackup) {
					if restoreErr := b.restaurarBackupSeNecessario(caminhoArquivo, true); restoreErr != nil {
						b.logInterno(fmt.Sprintf("ERRO CRÍTICO: Falha ao restaurar backup - %s", restoreErr.Error()))
					} else {
						b.logInterno("Backup restaurado após erro")
					}
				}
			}
			return nil, err
		}
		return result, nil
	}

	if apenasLeitura {
		return executarComRecuperacao()
	}

	return b.comLockArquivo(caminhoArquivo, executarComRecuperacao)
}

// --------------- Helper functions for CRUD ---------------

// noNaoInformado2 checks if the "chaves" param for delete was not provided.
// Equivalent to Node.js noNaoInformado applied to the chaves/dados parameter.
func noNaoInformado2(v any) bool {
	return v == nil
}

// extrairChavesParaDeletar extracts the list of keys to delete from various input types.
func extrairChavesParaDeletar(chaves any) ([]string, error) {
	switch v := chaves.(type) {
	case string:
		return []string{v}, nil
	case []string:
		return v, nil
	case []any:
		result := make([]string, 0, len(v))
		for _, item := range v {
			s, ok := item.(string)
			if !ok {
				return nil, fmt.Errorf("chave inválida na lista")
			}
			result = append(result, s)
		}
		return result, nil
	case map[string]any:
		result := make([]string, 0, len(v))
		for k := range v {
			result = append(result, k)
		}
		return result, nil
	default:
		return nil, fmt.Errorf("tipo de chaves inválido")
	}
}

// joinStrings joins strings with a separator (simple helper to avoid importing strings).
func joinStrings(ss []string, sep string) string {
	if len(ss) == 0 {
		return ""
	}
	result := ss[0]
	for i := 1; i < len(ss); i++ {
		result += sep + ss[i]
	}
	return result
}

// jsonStringify converts any value to a JSON string for error messages.
func jsonStringify(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}
