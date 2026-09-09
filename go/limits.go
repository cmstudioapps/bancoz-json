package bancoz

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
)

func (b *Bancoz) ContarEstrutura(obj any) Estrutura {
	return b.contarEstruturaRecursivo(obj, 0)
}

func (b *Bancoz) contarEstruturaRecursivo(obj any, profundidade int) Estrutura {
	if !isObjetoSimples(obj) && !isSlice(obj) {
		return Estrutura{Nodes: 0, Subnodes: 0, Arrays: 0}
	}

	var nodes, subnodes, arrays int

	if slice, ok := obj.([]any); ok {
		nodes = len(slice)
		arrays += len(slice)
		for _, item := range slice {
			sub := b.contarEstruturaRecursivo(item, profundidade+1)
			arrays += sub.Arrays
			subnodes += sub.Nodes + sub.Subnodes
		}
	} else if mp, ok := obj.(map[string]any); ok {
		nodes = len(mp)
		for _, val := range mp {
			sub := b.contarEstruturaRecursivo(val, profundidade+1)
			subnodes += sub.Nodes
			arrays += sub.Arrays
			if profundidade > 0 {
				subnodes += sub.Subnodes
			}
		}
	}

	return Estrutura{Nodes: nodes, Subnodes: subnodes, Arrays: arrays}
}

func (b *Bancoz) ContarEstruturaPorProfundidade(obj any) EstruturaProfundidade {
	resultado := make(map[int]*EstruturaPorNivel)
	maxDepth := 0

	var contarRecursivo func(valor any, depth int) (int, int, int)
	contarRecursivo = func(valor any, depth int) (int, int, int) {
		if !isObjetoSimples(valor) && !isSlice(valor) {
			return 0, 0, depth
		}

		if resultado[depth] == nil {
			resultado[depth] = &EstruturaPorNivel{Keys: 0, Nodes: 0, Subnodes: 0}
		}

		keysCount := 0
		localNodes := 0
		localSubnodes := 0
		localMaxDepth := depth

		if slice, ok := valor.([]any); ok {
			keysCount = len(slice)
			resultado[depth].Keys += keysCount
			localNodes = keysCount
			for _, item := range slice {
				n, sn, md := contarRecursivo(item, depth+1)
				localSubnodes += n + sn
				if md > localMaxDepth {
					localMaxDepth = md
				}
			}
		} else if mp, ok := valor.(map[string]any); ok {
			keysCount = len(mp)
			resultado[depth].Keys += keysCount
			localNodes = keysCount
			for _, val := range mp {
				n, _, md := contarRecursivo(val, depth+1)
				localSubnodes += n
				if md > localMaxDepth {
					localMaxDepth = md
				}
			}
		}

		resultado[depth].Nodes += localNodes
		resultado[depth].Subnodes += localSubnodes
		if depth > localMaxDepth {
			localMaxDepth = depth
		}

		return localNodes, localSubnodes, localMaxDepth
	}

	_, _, maxDepth = contarRecursivo(obj, 0)
	return EstruturaProfundidade{PorProfundidade: resultado, MaxDepth: maxDepth}
}

func isSlice(v any) bool {
	_, ok := v.([]any)
	return ok
}

func (b *Bancoz) caminhoLimitJson() (string, error) {
	pasta, err := b.garantirPastaConfigsBanco()
	if err != nil {
		return "", err
	}
	return filepath.Join(pasta, "limit.json"), nil
}

func (b *Bancoz) caminhoAdvancedLimitJson() (string, error) {
	pasta, err := b.garantirPastaConfigsBanco()
	if err != nil {
		return "", err
	}
	return filepath.Join(pasta, "advanced-limits.json"), nil
}

func (b *Bancoz) lerLimites() (map[string]any, error) {
	caminho, err := b.caminhoLimitJson()
	if err != nil {
		return make(map[string]any), nil
	}
	_, dados, _ := b.lerJsonComRetry(caminho, 5)
	if mp, ok := dados.(map[string]any); ok {
		return mp, nil
	}
	return make(map[string]any), nil
}

func (b *Bancoz) lerLimitesAvancados() (map[string]any, error) {
	caminho, err := b.caminhoAdvancedLimitJson()
	if err != nil {
		return make(map[string]any), nil
	}
	_, dados, _ := b.lerJsonComRetry(caminho, 5)
	if mp, ok := dados.(map[string]any); ok {
		return mp, nil
	}
	return make(map[string]any), nil
}

func (b *Bancoz) salvarLimites(limites map[string]any) error {
	caminho, err := b.caminhoLimitJson()
	if err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(limites, "", "  ")
	if err != nil {
		return err
	}
	return b.escreverArquivoAtomico(caminho, string(bytes))
}

func (b *Bancoz) salvarLimitesAvancados(limites map[string]any) error {
	caminho, err := b.caminhoAdvancedLimitJson()
	if err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(limites, "", "  ")
	if err != nil {
		return err
	}
	return b.escreverArquivoAtomico(caminho, string(bytes))
}

func (b *Bancoz) verificarLimiteAvancado(arquivo string, dadosNovos any) error {
	limites, err := b.lerLimitesAvancados()
	if err != nil {
		return nil
	}
	nomeArquivo, err := normalizarNomeArquivo(arquivo)
	if err != nil {
		return err
	}
	
	configAny, ok := limites[nomeArquivo]
	if !ok {
		return nil
	}
	config, ok := configAny.(map[string]any)
	if !ok {
		return nil
	}

	pasta, err := b.garantirPastaBanco()
	if err != nil {
		return err
	}
	caminho := filepath.Join(pasta, nomeArquivo)
	_, dadosAtual, _ := b.lerJsonComRetry(caminho, 5)

	dadosFull := make(map[string]any)
	if d, ok := dadosAtual.(map[string]any); ok {
		for k, v := range d {
			dadosFull[k] = v
		}
	}
	if d, ok := dadosNovos.(map[string]any); ok {
		for k, v := range d {
			dadosFull[k] = v
		}
	}

	estruturaFull := b.ContarEstruturaPorProfundidade(dadosFull)

	msgErro := func(tipo string, limite int, depth int) string {
		if b.idioma == "pt" {
			tipos := map[string]string{"keys": "chaves", "nodes": "nós", "subnodes": "subnós"}
			return fmt.Sprintf("Limite de %d %s no nível %d atingido para %s", limite, tipos[tipo], depth, nomeArquivo)
		}
		return fmt.Sprintf("Limit of %d %s at depth %d reached for %s", limite, tipo, depth, nomeArquivo)
	}

	for depthStr, levelConfigAny := range config {
		depth, err := strconv.Atoi(depthStr)
		if err != nil {
			continue
		}
		levelConfig, ok := levelConfigAny.(map[string]any)
		if !ok {
			continue
		}
		
		levelAtual, exists := estruturaFull.PorProfundidade[depth]
		if !exists {
			levelAtual = &EstruturaPorNivel{}
		}

		if maxKeys, ok := levelConfig["maxKeys"].(float64); ok && maxKeys > 0 {
			if levelAtual.Keys > int(maxKeys) {
				return fmt.Errorf("%s", msgErro("keys", int(maxKeys), depth))
			}
		}
		if maxNodes, ok := levelConfig["maxNodes"].(float64); ok && maxNodes > 0 {
			if levelAtual.Nodes > int(maxNodes) {
				return fmt.Errorf("%s", msgErro("nodes", int(maxNodes), depth))
			}
		}
		if maxSubnodes, ok := levelConfig["maxSubnodes"].(float64); ok && maxSubnodes > 0 {
			if levelAtual.Subnodes > int(maxSubnodes) {
				return fmt.Errorf("%s", msgErro("subnodes", int(maxSubnodes), depth))
			}
		}
	}
	return nil
}

func (b *Bancoz) verificarLimite(arquivo string, dadosNovos any) error {
	limites, _ := b.lerLimites()
	nomeArquivo, err := normalizarNomeArquivo(arquivo)
	if err != nil {
		return err
	}

	if configAny, ok := limites[nomeArquivo]; ok {
		if config, ok := configAny.(map[string]any); ok {
			pasta, err := b.garantirPastaBanco()
			if err != nil {
				return err
			}
			caminho := filepath.Join(pasta, nomeArquivo)
			_, dadosAtual, _ := b.lerJsonComRetry(caminho, 5)

			estruturaAtual := b.ContarEstrutura(dadosAtual)
			estruturaNovos := b.ContarEstrutura(dadosNovos)

			novoTotalNodes := estruturaAtual.Nodes + estruturaNovos.Nodes
			novoTotalSubnodes := estruturaAtual.Subnodes + estruturaNovos.Subnodes
			novoTotalArrays := estruturaAtual.Arrays + estruturaNovos.Arrays

			msgErro := func(tipo string, limite int) string {
				if b.idioma == "pt" {
					tipos := map[string]string{"nodes": "nós", "subnodes": "subnós", "arrays": "arrays"}
					return fmt.Sprintf("Limite de %d %s atingido para %s", limite, tipos[tipo], nomeArquivo)
				}
				return fmt.Sprintf("Limit of %d %s reached for %s", limite, tipo, nomeArquivo)
			}

			if l, ok := config["nodes"].(float64); ok && int(l) > 0 && novoTotalNodes > int(l) {
				return fmt.Errorf("%s", msgErro("nodes", int(l)))
			}
			if l, ok := config["subnodes"].(float64); ok && int(l) > 0 && novoTotalSubnodes > int(l) {
				return fmt.Errorf("%s", msgErro("subnodes", int(l)))
			}
			if l, ok := config["arrays"].(float64); ok && int(l) > 0 && novoTotalArrays > int(l) {
				return fmt.Errorf("%s", msgErro("arrays", int(l)))
			}
		}
	}

	return b.verificarLimiteAvancado(arquivo, dadosNovos)
}

func (b *Bancoz) Limite(arquivo string, nodeLimit, subnodeLimit, arrayLimit *int) (any, error) {
	caminho, err := b.caminhoLimitJson()
	if err != nil {
		return nil, err
	}
	
	fn := func() (any, error) {
		limites, _ := b.lerLimites()
		nome, err := normalizarNomeArquivo(arquivo)
		if err != nil {
			return nil, err
		}

		novoLimite := make(map[string]int)
		if nodeLimit != nil {
			novoLimite["nodes"] = *nodeLimit
		}
		if subnodeLimit != nil {
			novoLimite["subnodes"] = *subnodeLimit
		}
		if arrayLimit != nil {
			novoLimite["arrays"] = *arrayLimit
		}

		if len(novoLimite) == 0 {
			delete(limites, nome)
		} else {
			limites[nome] = novoLimite
		}

		b.salvarLimites(limites)
		
		var logMsg string
		if len(novoLimite) == 0 {
			logMsg = "sem limite"
		} else {
			jsBytes, _ := json.Marshal(novoLimite)
			logMsg = string(jsBytes)
		}
		b.logInterno(fmt.Sprintf("Limites definidos para %s: %s", nome, logMsg))
		
		if len(novoLimite) == 0 {
			return nil, nil
		}
		return novoLimite, nil
	}
	
	return b.comLockArquivo(caminho, fn)
}

func (b *Bancoz) SetLimit(arquivo string, nodeLimit, subnodeLimit, arrayLimit *int) (any, error) {
	return b.Limite(arquivo, nodeLimit, subnodeLimit, arrayLimit)
}

func (b *Bancoz) GetLimite(arquivo string) (any, error) {
	if b.apiKey != "" {
		msg := "Local limits disabled in remote mode"
		if b.idioma == "pt" {
			msg = "Limites locais desabilitados no modo remoto"
		}
		b.logInterno(msg)
		return msg, nil
	}

	limites, _ := b.lerLimites()
	nome, err := normalizarNomeArquivo(arquivo)
	if err != nil {
		return nil, err
	}

	configAny, ok := limites[nome]
	if !ok {
		if b.idioma == "pt" {
			return "Sem limites definidos", nil
		}
		return "No limits set", nil
	}

	configMap, ok := configAny.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid config map")
	}

	config := make(map[string]int)
	for k, v := range configMap {
		if val, ok := v.(float64); ok {
			config[k] = int(val)
		}
	}

	pasta, err := b.garantirPastaBanco()
	if err != nil {
		return nil, err
	}
	caminho := filepath.Join(pasta, nome)
	_, dados, _ := b.lerJsonComRetry(caminho, 5)
	atual := b.ContarEstrutura(dados)

	restante := make(map[string]*int)
	if l, ok := config["nodes"]; ok {
		val := max(0, l - atual.Nodes)
		restante["nodes"] = &val
	}
	if l, ok := config["subnodes"]; ok {
		val := max(0, l - atual.Subnodes)
		restante["subnodes"] = &val
	}
	if l, ok := config["arrays"]; ok {
		val := max(0, l - atual.Arrays)
		restante["arrays"] = &val
	}

	return LimiteInfo{
		Limites: config,
		Atual: atual,
		Restante: restante,
	}, nil
}

func (b *Bancoz) GetLimit(arquivo string) (any, error) {
	return b.GetLimite(arquivo)
}

func (b *Bancoz) LimiteAvancado(arquivo string, limitesPorNivel map[string]map[string]int) (any, error) {
	caminho, err := b.caminhoAdvancedLimitJson()
	if err != nil {
		return nil, err
	}

	fn := func() (any, error) {
		limites, _ := b.lerLimitesAvancados()
		nome, err := normalizarNomeArquivo(arquivo)
		if err != nil {
			return nil, err
		}

		limites[nome] = limitesPorNivel
		b.salvarLimitesAvancados(limites)
		
		js, _ := json.Marshal(limitesPorNivel)
		b.logInterno(fmt.Sprintf("Limites avançados definidos para %s: %s", nome, string(js)))
		return limitesPorNivel, nil
	}

	return b.comLockArquivo(caminho, fn)
}

func (b *Bancoz) AdvancedLimit(arquivo string, limitesPorNivel map[string]map[string]int) (any, error) {
	return b.LimiteAvancado(arquivo, limitesPorNivel)
}

func (b *Bancoz) GetLimiteAvancado(arquivo string) (any, error) {
	if b.apiKey != "" {
		msg := "Local limits disabled in remote mode"
		if b.idioma == "pt" {
			msg = "Limites locais desabilitados no modo remoto"
		}
		b.logInterno(msg)
		return msg, nil
	}

	limites, _ := b.lerLimitesAvancados()
	nome, err := normalizarNomeArquivo(arquivo)
	if err != nil {
		return nil, err
	}

	configAny, ok := limites[nome]
	if !ok {
		if b.idioma == "pt" {
			return "Sem limites avançados definidos", nil
		}
		return "No advanced limits set", nil
	}
	
	configMap, ok := configAny.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid config map")
	}

	config := make(map[string]map[string]int)
	for k, v := range configMap {
		levelMap := make(map[string]int)
		if vm, ok := v.(map[string]any); ok {
			for mk, mv := range vm {
				if mval, ok := mv.(float64); ok {
					levelMap[mk] = int(mval)
				}
			}
		}
		config[k] = levelMap
	}

	pasta, err := b.garantirPastaBanco()
	if err != nil {
		return nil, err
	}
	caminho := filepath.Join(pasta, nome)
	_, dados, _ := b.lerJsonComRetry(caminho, 5)
	atual := b.ContarEstruturaPorProfundidade(dados)

	restante := make(map[string]map[string]*int)
	for depthStr, levelConfig := range config {
		depth, _ := strconv.Atoi(depthStr)
		levelAtual, ok := atual.PorProfundidade[depth]
		if !ok {
			levelAtual = &EstruturaPorNivel{}
		}

		levelRestante := make(map[string]*int)
		if l, ok := levelConfig["maxKeys"]; ok {
			v := max(0, l - levelAtual.Keys)
			levelRestante["keys"] = &v
		}
		if l, ok := levelConfig["maxNodes"]; ok {
			v := max(0, l - levelAtual.Nodes)
			levelRestante["nodes"] = &v
		}
		if l, ok := levelConfig["maxSubnodes"]; ok {
			v := max(0, l - levelAtual.Subnodes)
			levelRestante["subnodes"] = &v
		}
		restante[depthStr] = levelRestante
	}

	return LimiteAvancadoInfo{
		Limites: config,
		Atual: atual,
		Restante: restante,
	}, nil
}

func (b *Bancoz) GetAdvancedLimit(arquivo string) (any, error) {
	return b.GetLimiteAvancado(arquivo)
}


