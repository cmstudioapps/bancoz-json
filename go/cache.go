package bancoz

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"
)

// chaveCacheArquivo returns filepath.Abs of the path (or path itself on error).
func (b *Bancoz) chaveCacheArquivo(caminhoArquivo string) string {
	abs, err := filepath.Abs(caminhoArquivo)
	if err != nil {
		return caminhoArquivo
	}
	return abs
}

// definirCacheArquivo If !cacheAtivo, return. Creates cacheItem with deep-cloned dados, 
// calculates expiraEm based on cacheTtlMs. Stores in cacheArquivos map under absolute path key.
// Use cacheMu write lock.
func (b *Bancoz) definirCacheArquivo(caminhoArquivo string, conteudo string, dados any) {
	if !b.cacheAtivo {
		return
	}

	chave := b.chaveCacheArquivo(caminhoArquivo)
	
	var expiraEm int64
	if b.cacheTtlMs > 0 {
		expiraEm = time.Now().UnixMilli() + b.cacheTtlMs
	}

	clonedDados := clonarJson(dados)

	b.cacheMu.Lock()
	defer b.cacheMu.Unlock()

	b.cacheArquivos[chave] = &cacheItem{
		conteudo: conteudo,
		dados:    clonedDados,
		expiraEm: expiraEm,
		existe:   true,
	}
}

// cacheExpirado Returns true if item.expiraEm > 0 and current time >= expiraEm.
func (b *Bancoz) cacheExpirado(item *cacheItem) bool {
	return item.expiraEm > 0 && time.Now().UnixMilli() >= item.expiraEm
}

// definirCacheArquivoPorConteudo If !cacheAtivo, return. Parses conteudo as JSON, 
// calls definirCacheArquivo. On parse error, deletes cache entry.
func (b *Bancoz) definirCacheArquivoPorConteudo(caminhoArquivo string, conteudo string) {
	if !b.cacheAtivo {
		return
	}

	chave := b.chaveCacheArquivo(caminhoArquivo)
	var dados any
	err := json.Unmarshal([]byte(conteudo), &dados)
	if err != nil {
		b.cacheMu.Lock()
		delete(b.cacheArquivos, chave)
		b.cacheMu.Unlock()
		return
	}

	b.definirCacheArquivo(caminhoArquivo, conteudo, dados)
}

// snapshotCacheArquivo If !cacheAtivo, return nil. Returns snapshot of current cache entry (deep-cloned) for rollback.
func (b *Bancoz) snapshotCacheArquivo(caminhoArquivo string) *cacheSnapshot {
	if !b.cacheAtivo {
		return nil
	}

	chave := b.chaveCacheArquivo(caminhoArquivo)

	b.cacheMu.RLock()
	item, exists := b.cacheArquivos[chave]
	b.cacheMu.RUnlock()

	if !exists {
		return &cacheSnapshot{
			existe: false,
			chave:  chave,
		}
	}

	return &cacheSnapshot{
		existe: true,
		chave:  chave,
		valor: &cacheItem{
			conteudo: item.conteudo,
			dados:    clonarJson(item.dados),
			expiraEm: item.expiraEm,
			existe:   item.existe,
		},
	}
}

// restaurarSnapshotCacheArquivo Restores cache entry from snapshot.
func (b *Bancoz) restaurarSnapshotCacheArquivo(snapshot *cacheSnapshot) {
	if snapshot == nil {
		return
	}

	b.cacheMu.Lock()
	defer b.cacheMu.Unlock()

	if snapshot.existe {
		b.cacheArquivos[snapshot.chave] = snapshot.valor
	} else {
		delete(b.cacheArquivos, snapshot.chave)
	}
}

// atualizarCacheArquivoAntesDoDisco If !cacheAtivo, return. Updates cache with new data and serialized content BEFORE writing to disk.
func (b *Bancoz) atualizarCacheArquivoAntesDoDisco(caminhoArquivo string, dados any) {
	if !b.cacheAtivo {
		return
	}

	bBytes, err := jsonMarshalIndent(dados)
	if err != nil {
		return
	}

	b.definirCacheArquivo(caminhoArquivo, string(bBytes), dados)
}

// GetCache Returns cache status. modo defaults to 'data'. Lists all cached files with metadata (path, expiry, data). 
// When exibirTerminal=true, prints to stdout in the exact Node.js format.
func (b *Bancoz) GetCache(exibirTerminal bool, modo ...string) CacheInfo {
	modoStr := "data"
	if len(modo) > 0 && modo[0] == "files" {
		modoStr = "files"
	}

	agora := time.Now().UnixMilli()
	pastaBase := b.pastaBanco()

	b.cacheMu.RLock()
	defer b.cacheMu.RUnlock()

	var arquivos []CacheArquivoInfo
	if b.cacheArquivos == nil {
		// Just in case
	}
	dadosMap := make(map[string]any)

	for caminhoArquivo, item := range b.cacheArquivos {
		relativo, err := filepath.Rel(pastaBase, caminhoArquivo)
		var arquivo string
		if err == nil && !filepath.IsAbs(relativo) && len(relativo) > 0 && relativo[:2] != ".." {
			arquivo = relativo
		} else {
			arquivo = caminhoArquivo
		}

		expirado := item.expiraEm > 0 && agora >= item.expiraEm
		var expiraEmSegundos int64
		if item.expiraEm > 0 {
			diff := float64(item.expiraEm - agora) / 1000.0
			if diff < 0 {
				diff = 0
			}
			expiraEmSegundos = int64(diff + 0.999999) // ceil
		}

		info := CacheArquivoInfo{
			Arquivo:          arquivo,
			Caminho:          caminhoArquivo,
			ExpiraEm:         item.expiraEm,
			ExpiraEmSegundos: expiraEmSegundos,
			Expirado:         expirado,
		}
		arquivos = append(arquivos, info)
		dadosMap[arquivo] = clonarJson(item.dados)
	}

	snapshot := CacheInfo{
		Ativo:      b.cacheAtivo,
		TtlMs:      b.cacheTtlMs,
		Quantidade: len(arquivos),
		Arquivos:   arquivos,
		Dados:      dadosMap,
	}

	if !exibirTerminal {
		snapshot.Dados = nil
		return snapshot
	}

	fmt.Printf("\n[BANCO Z CACHE]\n")
	status := "desativado"
	if snapshot.Ativo {
		status = "ativo"
	}
	fmt.Printf("Status: %s\n", status)
	fmt.Printf("Arquivos em cache: %d\n", snapshot.Quantidade)

	if b.cacheTtlMs == 0 {
		fmt.Printf("Expiração: sem expiração\n")
	} else {
		fmt.Printf("Expiração padrão: %d minuto(s)\n", b.cacheTtlMs/60000)
	}

	if snapshot.Quantidade == 0 {
		fmt.Printf("Cache vazio.\n\n")
		return snapshot
	}

	if modoStr == "files" {
		fmt.Printf("\nArquivos:\n")
		for i, item := range snapshot.Arquivos {
			var ttl string
			if item.ExpiraEm == 0 {
				ttl = "sem expiração"
			} else if item.Expirado {
				ttl = "expirado"
			} else {
				ttl = fmt.Sprintf("expira em %ds", item.ExpiraEmSegundos)
			}
			fmt.Printf("%d. %s (%s)\n", i+1, item.Arquivo, ttl)
		}
		fmt.Printf("\n")
		return snapshot
	}

	fmt.Printf("\nDados por arquivo:\n")
	for i, item := range snapshot.Arquivos {
		var ttl string
		if item.ExpiraEm == 0 {
			ttl = "sem expiração"
		} else if item.Expirado {
			ttl = "expirado"
		} else {
			ttl = fmt.Sprintf("expira em %ds", item.ExpiraEmSegundos)
		}
		fmt.Printf("\n%d. %s (%s)\n", i+1, item.Arquivo, ttl)
		fmt.Printf("%s\n", formatarJsonParaTerminal(snapshot.Dados[item.Arquivo]))
	}
	fmt.Printf("\n")

	return snapshot
}
