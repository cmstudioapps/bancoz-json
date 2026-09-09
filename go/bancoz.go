// Package bancoz implements a simple JSON file-based NoSQL database
// with queue, backup, cache, limits, search and remote API support.
//
// This is a faithful Go port of the Node.js bancoz library.
//
// Usage:
//
//	import bancoz "github.com/cmstudioapps/bancoz-json"
//
//	db := bancoz.New()
//	db.Fila(true)
//	db.Bk(true)
//	db.Criar("usuarios", "ana", map[string]any{"nome": "Ana", "plano": "pro"})
package bancoz

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// --------------- Types ---------------

// Estrutura represents the recursive count of nodes, subnodes, and arrays.
type Estrutura struct {
	Nodes    int `json:"nodes"`
	Subnodes int `json:"subnodes"`
	Arrays   int `json:"arrays"`
}

// EstruturaPorNivel represents structure counts at a specific depth level.
type EstruturaPorNivel struct {
	Keys     int `json:"keys"`
	Nodes    int `json:"nodes"`
	Subnodes int `json:"subnodes"`
}

// EstruturaProfundidade holds per-depth structure analysis.
type EstruturaProfundidade struct {
	PorProfundidade map[int]*EstruturaPorNivel `json:"porProfundidade"`
	MaxDepth        int                        `json:"maxDepth"`
}

// ResumoArquivo holds analysis results for a single JSON file.
type ResumoArquivo struct {
	Arquivo                   string  `json:"arquivo"`
	TamanhoBytes              int64   `json:"tamanhoBytes"`
	TamanhoFormatado          string  `json:"tamanhoFormatado"`
	TempoLeituraMs            float64 `json:"tempoLeituraMs"`
	VelocidadeBytesPorSegundo int64   `json:"velocidadeBytesPorSegundo"`
	VelocidadeFormatada       string  `json:"velocidadeFormatada"`
	JsonValido                bool    `json:"jsonValido"`
	QuantidadeNos             int     `json:"quantidadeNos"`
}

// Resumo holds the full database analysis summary.
type Resumo struct {
	Pasta                 string          `json:"pasta"`
	QuantidadeArquivos    int             `json:"quantidadeArquivos"`
	TamanhoTotalBytes     int64           `json:"tamanhoTotalBytes"`
	TamanhoTotalFormatado string          `json:"tamanhoTotalFormatado"`
	TempoTotalLeituraMs   float64         `json:"tempoTotalLeituraMs"`
	TempoMedioLeituraMs   float64         `json:"tempoMedioLeituraMs"`
	Arquivos              []ResumoArquivo `json:"arquivos"`
}

// CacheArquivoInfo represents metadata of a single cached file.
type CacheArquivoInfo struct {
	Arquivo          string `json:"arquivo"`
	Caminho          string `json:"caminho"`
	ExpiraEm         int64  `json:"expiraEm"`
	ExpiraEmSegundos int64  `json:"expiraEmSegundos"`
	Expirado         bool   `json:"expirado"`
}

// CacheInfo represents the full cache status snapshot.
type CacheInfo struct {
	Ativo      bool                `json:"ativo"`
	TtlMs      int64               `json:"ttlMs"`
	Quantidade int                 `json:"quantidade"`
	Arquivos   []CacheArquivoInfo  `json:"arquivos"`
	Dados      map[string]any      `json:"dados,omitempty"`
}

// LimiteInfo represents flat limit configuration and current usage.
type LimiteInfo struct {
	Limites  map[string]int  `json:"limites"`
	Atual    Estrutura       `json:"atual"`
	Restante map[string]*int `json:"restante"`
}

// LimiteAvancadoInfo represents advanced per-depth limits and usage.
type LimiteAvancadoInfo struct {
	Limites  map[string]map[string]int  `json:"limites"`
	Atual    EstruturaProfundidade      `json:"atual"`
	Restante map[string]map[string]*int `json:"restante"`
}

// --------------- Internal types ---------------

// cacheItem stores a single file's cached data.
type cacheItem struct {
	conteudo string // raw JSON string, empty if file didn't exist
	dados    any    // parsed JSON data
	expiraEm int64  // Unix milliseconds, 0 = no expiry
	existe   bool   // whether the file existed on disk
}

// cacheSnapshot stores a point-in-time snapshot of a cache entry for rollback.
type cacheSnapshot struct {
	existe bool
	chave  string
	valor  *cacheItem
}

// operacao represents a pending database operation.
type operacao struct {
	tipo    string // "criar", "ler", "atualizar", "deletar"
	arquivo string
	no      string
	dados   any
	chave   any
}

// filaResult carries the result of a queued operation.
type filaResult struct {
	valor any
	err   error
}

// filaItem pairs an operation with its result channel.
type filaItem struct {
	op     operacao
	result chan filaResult
}

// --------------- Bancoz struct ---------------

// Bancoz is the main database instance.
type Bancoz struct {
	filaAtiva       bool
	backupAtivo     bool
	logAtivo        bool
	idioma          string // "pt" or "en"
	lockTimeoutMs   int
	lockStaleMs     int
	apiKey          string // empty = local mode
	pastaBancoCustom string // empty = default "BANCO Z"

	cacheAtivo bool
	cacheTtlMs int64 // 0 = no expiry

	cacheMu       sync.RWMutex
	cacheArquivos map[string]*cacheItem

	filaMu          sync.Mutex
	filaOperacoes   []filaItem
	processandoFila bool
}

// New creates a new Bancoz instance with default settings.
// Equivalent to `new Bancoz()` in Node.js.
func New() *Bancoz {
	return &Bancoz{
		idioma:        "pt",
		lockTimeoutMs: 30000,
		lockStaleMs:   120000,
		cacheArquivos: make(map[string]*cacheItem),
	}
}

var (
	defaultInstance *Bancoz
	defaultOnce     sync.Once
)

// Default returns the package-level singleton Bancoz instance.
// Equivalent to Node.js `export default new Bancoz()`.
func Default() *Bancoz {
	defaultOnce.Do(func() {
		defaultInstance = New()
	})
	return defaultInstance
}

// --------------- Configuration methods ---------------

// Fila activates/deactivates the operation queue.
// Equivalent to Node.js `bancoz.fila(valor)`.
func (b *Bancoz) Fila(valor bool) {
	b.filaAtiva = valor
	b.logInterno(fmt.Sprintf("Fila de operações %s", boolParaAtivoDesativo(valor)))
}

// Bk activates/deactivates the backup mode.
// Equivalent to Node.js `bancoz.bk(valor)`.
func (b *Bancoz) Bk(valor bool) {
	b.backupAtivo = valor
	b.logInterno(fmt.Sprintf("Modo backup %s", boolParaAtivoDesativo(valor)))
}

// Log activates/deactivates the logging system.
// Equivalent to Node.js `bancoz.log(valor)`.
func (b *Bancoz) Log(valor bool) {
	b.logAtivo = valor
	var msg string
	if b.idioma == "pt" {
		msg = fmt.Sprintf("Sistema de log %s", boolParaAtivoDesativo(valor))
	} else {
		msg = fmt.Sprintf("Log system %s", boolParaAtivoDesativoEN(valor))
	}
	fmt.Printf("[BANCO Z LOG] %s\n", msg)
}

// Lang sets the log language ("pt" for Portuguese, "en" for English).
// Equivalent to Node.js `bancoz.lang(idioma)`.
func (b *Bancoz) Lang(idioma string) {
	if idioma == "en" {
		b.idioma = "en"
	} else {
		b.idioma = "pt"
	}
	var nome string
	if b.idioma == "pt" {
		nome = "português"
	} else {
		nome = "inglês"
	}
	b.logInterno(fmt.Sprintf("Idioma definido para %s", nome))
}

// ApiKey sets the API key for remote mode (https://bancoz.squareweb.app).
// Pass empty string to switch back to local mode.
// Equivalent to Node.js `bancoz.api_key(key)`.
func (b *Bancoz) ApiKey(key string) string {
	b.apiKey = key
	var modo string
	if key != "" {
		modo = "remoto (API bancoz.squareweb.app)"
	} else {
		modo = "local (BANCO Z)"
	}
	b.logInterno(fmt.Sprintf("Modo %s", modo))
	return key
}

// Path sets the base directory used by Bancoz in local mode.
// Pass empty string to reset to default ("BANCO Z" in current directory).
// Equivalent to Node.js `bancoz.path(caminhoDaPasta)`.
func (b *Bancoz) Path(caminhoDaPasta string) string {
	if caminhoDaPasta == "" {
		b.pastaBancoCustom = ""
		b.cacheMu.Lock()
		b.cacheArquivos = make(map[string]*cacheItem)
		b.cacheMu.Unlock()
		pasta := b.pastaBanco()
		b.logInterno(fmt.Sprintf("Pasta do Bancoz definida para %s", pasta))
		return pasta
	}

	abs, err := filepath.Abs(caminhoDaPasta)
	if err != nil {
		abs = caminhoDaPasta
	}
	b.pastaBancoCustom = abs
	b.cacheMu.Lock()
	b.cacheArquivos = make(map[string]*cacheItem)
	b.cacheMu.Unlock()
	b.logInterno(fmt.Sprintf("Pasta do Bancoz definida para %s", b.pastaBancoCustom))
	return b.pastaBancoCustom
}

// Cache activates/deactivates the in-memory file cache.
// Optional minutes parameter sets TTL; omit for no expiration.
// Equivalent to Node.js `bancoz.cache(valor, minutos)`.
func (b *Bancoz) Cache(valor bool, minutos ...float64) bool {
	b.cacheAtivo = valor

	var ttlMs int64
	if len(minutos) > 0 && minutos[0] > 0 {
		ttlMs = int64(minutos[0] * 60 * 1000)
	}

	if b.cacheAtivo {
		b.cacheTtlMs = ttlMs
	} else {
		b.cacheTtlMs = 0
	}

	b.cacheMu.Lock()
	if !b.cacheAtivo {
		b.cacheArquivos = make(map[string]*cacheItem)
	} else {
		agora := time.Now().UnixMilli()
		for _, item := range b.cacheArquivos {
			if b.cacheTtlMs > 0 {
				item.expiraEm = agora + b.cacheTtlMs
			} else {
				item.expiraEm = 0
			}
		}
	}
	b.cacheMu.Unlock()

	var tempo string
	if b.cacheTtlMs == 0 {
		tempo = "sem expiração"
	} else {
		if len(minutos) > 0 {
			tempo = fmt.Sprintf("%.0f minuto(s)", minutos[0])
		}
	}
	if b.cacheAtivo {
		b.logInterno(fmt.Sprintf("Cache em memória ativado (%s)", tempo))
	} else {
		b.logInterno("Cache em memória desativado")
	}
	return b.cacheAtivo
}

// Queue is an English alias for Fila.
func (b *Bancoz) Queue(valor bool) {
	b.Fila(valor)
}

// Backup is an English alias for Bk.
func (b *Bancoz) Backup(valor bool) {
	b.Bk(valor)
}

// Language is an English alias for Lang.
func (b *Bancoz) Language(idioma string) {
	b.Lang(idioma)
}

// --------------- Internal helpers ---------------

// pastaBanco returns the base directory for data files.
func (b *Bancoz) pastaBanco() string {
	if b.pastaBancoCustom != "" {
		return b.pastaBancoCustom
	}
	cwd, err := os.Getwd()
	if err != nil {
		cwd = "."
	}
	return filepath.Join(cwd, "BANCO Z")
}

// pastaConfigsBanco returns the configs subdirectory path.
func (b *Bancoz) pastaConfigsBanco() string {
	return filepath.Join(b.pastaBanco(), "configs", "bancoz")
}

// logInterno prints a timestamped log message if logging is active.
func (b *Bancoz) logInterno(mensagem string) {
	if !b.logAtivo {
		return
	}

	msg := mensagem
	if b.idioma == "en" {
		msg = traduzirMensagem(mensagem)
	}

	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	fmt.Printf("[%s] [BANCO Z LOG] %s\n", timestamp, msg)
}

// boolParaAtivoDesativo returns "ativada"/"desativada" or "ativado"/"desativado".
func boolParaAtivoDesativo(v bool) string {
	if v {
		return "ativada"
	}
	return "desativada"
}

func boolParaAtivoDesativoEN(v bool) string {
	if v {
		return "activated"
	}
	return "deactivated"
}

// traduzirMensagem translates known Portuguese log phrases to English.
func traduzirMensagem(msg string) string {
	traducoes := [][2]string{
		{"Fila de operações", "Operation queue"},
		{"ativada", "activated"},
		{"desativada", "deactivated"},
		{"Modo backup", "Backup mode"},
		{"Sistema de log", "Log system"},
		{"Idioma definido para", "Language set to"},
		{"português", "portuguese"},
		{"inglês", "english"},
		{"Operação", "Operation"},
		{"enfileirada para", "queued for"},
		{"Iniciando operação", "Starting operation"},
		{"Backup criado", "Backup created"},
		{"Dados criados em", "Data created in"},
		{"Chave", "Key"},
		{"atualizada em", "updated in"},
		{"Nó completo atualizado em", "Complete node updated in"},
		{"Nó deletado de", "Node deleted from"},
		{"Nó não encontrado em", "Node not found in"},
		{"Leitura de", "Reading from"},
		{"bem-sucedida", "successful"},
		{"não encontrado", "not found"},
		{"Arquivo salvo com sucesso", "File saved successfully"},
		{"Backup removido após operação bem-sucedida", "Backup removed after successful operation"},
		{"ERRO", "ERROR"},
		{"Backup restaurado após erro", "Backup restored after error"},
		{"ERRO CRÍTICO", "CRITICAL ERROR"},
		{"Limites definidos para", "Limits set for"},
		{"Limites avançados definidos para", "Advanced limits set for"},
		{"Limites locais desabilitados no modo remoto", "Local limits disabled in remote mode"},
		{"Pesquisa local desabilitada no modo remoto", "Local search disabled in remote mode"},
		{"Cache em memória", "In-memory cache"},
		{"Pasta do Bancoz definida para", "Bancoz folder set to"},
		{"Nó atualizado em", "Node updated in"},
		{"Chave(s) deletada(s) de", "Key(s) deleted from"},
		{"Leitura completa de", "Full read of"},
		{"ativado", "activated"},
		{"desativado", "deactivated"},
	}

	result := msg
	for _, t := range traducoes {
		// Simple replacement (matches Node.js behavior)
		for {
			idx := indexOf(result, t[0])
			if idx < 0 {
				break
			}
			result = result[:idx] + t[1] + result[idx+len(t[0]):]
		}
	}
	return result
}

// indexOf returns the index of substr in s, or -1.
func indexOf(s, substr string) int {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
