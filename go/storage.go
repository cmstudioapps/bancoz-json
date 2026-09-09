package bancoz

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"time"
)

// esperar is a simple time.Sleep wrapper.
func (b *Bancoz) esperar(ms int) {
	time.Sleep(time.Duration(ms) * time.Millisecond)
}

// lerJsonComRetry reads a JSON file with retry logic and cache support.
func (b *Bancoz) lerJsonComRetry(caminhoArquivo string, tentativas int) (string, any, error) {
	if b.cacheAtivo {
		b.cacheMu.RLock()
		item, ok := b.cacheArquivos[caminhoArquivo]
		b.cacheMu.RUnlock()

		if ok {
			agora := time.Now().UnixMilli()
			if item.expiraEm == 0 || agora < item.expiraEm {
				return item.conteudo, clonarJson(item.dados), nil
			}
			b.cacheMu.Lock()
			delete(b.cacheArquivos, caminhoArquivo)
			b.cacheMu.Unlock()
		}
	}

	for tentativa := 1; tentativa <= tentativas; tentativa++ {
		conteudoBytes, err := os.ReadFile(caminhoArquivo)
		if err != nil {
			if os.IsNotExist(err) {
				// We don't have definirCacheArquivo here so we will just implement it inline if needed or assume it's in another file.
				// Based on the prompt: "Calls definirCacheArquivo to cache results."
				b.definirCacheArquivo(caminhoArquivo, "", map[string]any{})
				return "", map[string]any{}, nil
			}

			if tentativa == tentativas {
				return "", nil, err
			}

			b.esperar(10 * tentativa)
			continue
		}

		conteudo := string(conteudoBytes)
		var dados any
		err = json.Unmarshal(conteudoBytes, &dados)
		if err != nil {
			if tentativa == tentativas {
				return "", nil, err
			}
			b.esperar(10 * tentativa)
			continue
		}

		b.definirCacheArquivo(caminhoArquivo, conteudo, dados)
		return conteudo, dados, nil
	}

	return "", map[string]any{}, nil
}

// escreverArquivoAtomico writes content to a temp file and renames it atomically.
func (b *Bancoz) escreverArquivoAtomico(caminhoArquivo string, conteudo string) error {
	diretorio := filepath.Dir(caminhoArquivo)
	base := filepath.Base(caminhoArquivo)

	sufixo := fmt.Sprintf("%d-%d-%x", os.Getpid(), time.Now().UnixMilli(), rand.Int31())
	caminhoTemp := filepath.Join(diretorio, fmt.Sprintf(".%s.tmp-%s", base, sufixo))

	if err := os.MkdirAll(diretorio, 0755); err != nil {
		return err
	}

	if err := os.WriteFile(caminhoTemp, []byte(conteudo), 0644); err != nil {
		return err
	}

	var renameErr error
	if err := os.Rename(caminhoTemp, caminhoArquivo); err != nil {
		// Windows or fallback
		os.Remove(caminhoArquivo)
		renameErr = os.Rename(caminhoTemp, caminhoArquivo)
	}

	os.Remove(caminhoTemp) // cleanup in case of error

	if renameErr != nil {
		return renameErr
	}

	b.definirCacheArquivoPorConteudo(caminhoArquivo, conteudo)
	return nil
}


// comLockArquivo performs an operation with a file lock.
func (b *Bancoz) comLockArquivo(caminhoArquivo string, fn func() (any, error)) (any, error) {
	if err := os.MkdirAll(filepath.Dir(caminhoArquivo), 0755); err != nil {
		return nil, err
	}

	caminhoLock := caminhoArquivo + ".lock"
	inicio := time.Now().UnixMilli()

	for {
		file, err := os.OpenFile(caminhoLock, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err == nil {
			file.WriteString(fmt.Sprintf("%d\n%s\n", os.Getpid(), time.Now().UTC().Format(time.RFC3339)))
			file.Close()

			defer os.Remove(caminhoLock)
			return fn()
		}

		if !os.IsExist(err) {
			return nil, err
		}

		agora := time.Now().UnixMilli()
		if int(agora-inicio) > b.lockTimeoutMs {
			return nil, fmt.Errorf("Timeout aguardando lock do arquivo '%s'", filepath.Base(caminhoArquivo))
		}

		if stat, err := os.Stat(caminhoLock); err == nil {
			if int(agora-stat.ModTime().UnixMilli()) > b.lockStaleMs {
				os.Remove(caminhoLock)
				continue
			}
		}

		b.esperar(25 + rand.Intn(25))
	}
}
