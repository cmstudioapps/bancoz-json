package bancoz

import (
	"path/filepath"
	"reflect"
	"testing"
	
)

// Helper to check for equality without testify
func assertEqual(t *testing.T, expected, actual any, msg string) {
	t.Helper()
	if !reflect.DeepEqual(expected, actual) {
		t.Errorf("%s: expected %v, got %v", msg, expected, actual)
	}
}

func assertError(t *testing.T, err error, msg string) {
	t.Helper()
	if err == nil {
		t.Errorf("%s: expected error, got nil", msg)
	}
}

func assertNoError(t *testing.T, err error, msg string) {
	t.Helper()
	if err != nil {
		t.Errorf("%s: unexpected error: %v", msg, err)
	}
}


func TestNew(t *testing.T) {
	b := New()
	if b == nil {
		t.Fatal("New() returned nil")
	}
	assertEqual(t, "pt", b.idioma, "default language should be pt")
	assertEqual(t, 30000, b.lockTimeoutMs, "lock timeout should be 30000")
	assertEqual(t, 120000, b.lockStaleMs, "lock stale should be 120000")
	if b.cacheArquivos == nil {
		t.Error("cacheArquivos map not initialized")
	}
}

func TestDefault(t *testing.T) {
	b1 := Default()
	b2 := Default()
	if b1 != b2 {
		t.Error("Default() did not return singleton")
	}
}

func TestConfig(t *testing.T) {
	b := New()
	tmpDir := t.TempDir()
	
	b.Fila(true)
	assertEqual(t, true, b.filaAtiva, "Fila()")

	b.Bk(true)
	assertEqual(t, true, b.backupAtivo, "Bk()")

	b.Log(true)
	assertEqual(t, true, b.logAtivo, "Log()")

	b.Lang("en")
	assertEqual(t, "en", b.idioma, "Lang()")

	b.ApiKey("secret")
	assertEqual(t, "secret", b.apiKey, "ApiKey()")
	b.ApiKey("") // reset

	b.Path(tmpDir)
	// it should match exactly because tempdir is absolute
	assertEqual(t, tmpDir, b.pastaBancoCustom, "Path()")

	b.Cache(true, 5)
	assertEqual(t, true, b.cacheAtivo, "Cache()")
	assertEqual(t, int64(5*60*1000), b.cacheTtlMs, "Cache() TTL")
}

func TestNormalizarNomeArquivo(t *testing.T) {
	tests := []struct {
		in      string
		out     string
		wantErr bool
	}{
		{"teste", "teste.json", false},
		{"teste.json", "teste.json", false},
		{"/abs/path", "", true},
		{"../up", "", true},
		{"loja/clientes", filepath.Join("loja", "clientes.json"), false},
	}

	for _, tt := range tests {
		res, err := normalizarNomeArquivo(tt.in)
		if tt.wantErr {
			assertError(t, err, "expected error for " + tt.in)
		} else {
			assertNoError(t, err, "unexpected error for " + tt.in)
			assertEqual(t, tt.out, res, "normalizarNomeArquivo("+tt.in+")")
		}
	}
}

func TestCriarELer(t *testing.T) {
	b := New()
	tmpDir := t.TempDir()
	b.Path(tmpDir)

	// Sem nó
	dados1 := map[string]any{"nome": "Maria"}
	_, err := b.Criar("arq1", "", dados1)
	assertNoError(t, err, "Criar sem no")

	lido1, err := b.Ler("arq1")
	assertNoError(t, err, "Ler sem no")
	if m, ok := lido1.(map[string]any); !ok || m["nome"] != "Maria" {
		t.Errorf("Expected nome=Maria, got %v", lido1)
	}

	// Com nó
	dados2 := map[string]any{"idade": 30.0} // unmarshal decodes numbers to float64
	_, err = b.Criar("arq2", "user1", dados2)
	assertNoError(t, err, "Criar com no")

	lido2, err := b.Ler("arq2", "user1")
	assertNoError(t, err, "Ler com no")
	if m, ok := lido2.(map[string]any); !ok || m["idade"] != 30.0 {
		t.Errorf("Expected idade=30, got %v", lido2)
	}
}

func TestAtualizar(t *testing.T) {
	b := New()
	b.Path(t.TempDir())

	dados := map[string]any{"nome": "Carlos", "idade": 20.0}
	b.Criar("users", "u1", dados)

	// Atualizar parcial
	_, err := b.Atualizar("users", "u1", map[string]any{"idade": 21.0})
	assertNoError(t, err, "Atualizar parcial")

	lido, _ := b.Ler("users", "u1")
	m := lido.(map[string]any)
	assertEqual(t, 21.0, m["idade"], "Idade should be updated")
	assertEqual(t, "Carlos", m["nome"], "Nome should remain")

	// Atualizar chave especifica
	_, err = b.Atualizar("users", "u1", "Silva", "sobrenome") // wait, the signature is Atualizar(arquivo, no, dados, chave...) -> dados="Silva", chave="sobrenome"
	assertNoError(t, err, "Atualizar chave especifica")
	
	lido, _ = b.Ler("users", "u1")
	m = lido.(map[string]any)
	assertEqual(t, "Silva", m["sobrenome"], "Sobrenome should be added")

	// Atualizar substituir
	_, err = b.Atualizar("users", "u1", map[string]any{"novo": true}, map[string]any{"substituir": true})
	assertNoError(t, err, "Atualizar substituir")
	
	lido, _ = b.Ler("users", "u1")
	m = lido.(map[string]any)
	assertEqual(t, true, m["novo"], "Novo should be true")
	if _, ok := m["nome"]; ok {
		t.Error("Nome should be gone after substituir")
	}
}

func TestDeletar(t *testing.T) {
	b := New()
	b.Path(t.TempDir())

	dados := map[string]any{"a": 1.0, "b": 2.0, "c": 3.0}
	b.Criar("test", "n1", dados)

	// Deletar chave especifica
	b.Deletar("test", "n1", "a")
	lido, _ := b.Ler("test", "n1")
	m := lido.(map[string]any)
	if _, ok := m["a"]; ok {
		t.Error("a should be deleted")
	}

	// Deletar no inteiro
	b.Deletar("test", "n1")
	lido, _ = b.Ler("test", "n1")
	if lido != nil {
		t.Error("n1 should be deleted")
	}
}

func TestAliasesIngles(t *testing.T) {
	b := New()
	b.Path(t.TempDir())

	b.Create("f1", "n1", map[string]any{"x": 1.0})
	lido, _ := b.Read("f1", "n1")
	assertEqual(t, 1.0, lido.(map[string]any)["x"], "Create/Read alias")

	b.Update("f1", "n1", map[string]any{"x": 2.0})
	lido, _ = b.Read("f1", "n1")
	assertEqual(t, 2.0, lido.(map[string]any)["x"], "Update alias")

	b.Delete("f1", "n1")
	lido, _ = b.Read("f1", "n1")
	if lido != nil {
		t.Error("Delete alias failed")
	}
}

func TestSubpastas(t *testing.T) {
	b := New()
	b.Path(t.TempDir())

	_, err := b.Criar("loja/clientes", "cli1", map[string]any{"nome": "Ze"})
	assertNoError(t, err, "Criar subpasta")
	
	lido, _ := b.Ler("loja/clientes", "cli1")
	assertEqual(t, "Ze", lido.(map[string]any)["nome"], "Ler subpasta")
}

func TestFila(t *testing.T) {
	b := New()
	b.Path(t.TempDir())
	b.Fila(true)

	for i := 0; i < 5; i++ {
		b.Criar("fila", "n1", map[string]any{"c": float64(i)})
	}
	
	// Because operations are synchronous when awaited (Criar returns result), they execute sequentially.
	// Wait, actually Fila uses a goroutine for processing queue but block wait for result.
	// We'll just verify the last one.
	lido, _ := b.Ler("fila", "n1")
	assertEqual(t, 4.0, lido.(map[string]any)["c"], "Queue last op")
}

func TestBackup(t *testing.T) {
	b := New()
	dir := t.TempDir()
	b.Path(dir)
	b.Bk(true)

	b.Criar("bkp", "", map[string]any{"v": 1.0})
	b.Atualizar("bkp", "", map[string]any{"v": 2.0}) // This triggers backup

	bkpPath := filepath.Join(dir, "bkp.json.backup")
	importOs := reflect.ValueOf(b) // just to ignore unused if we don't import os in this chunk, actually let's use fileExists
	
	if !fileExists(bkpPath) {
		t.Error("Backup file not created")
	}
	_ = importOs
}

func TestCache(t *testing.T) {
	b := New()
	b.Path(t.TempDir())
	b.Cache(true)

	b.Criar("cache", "", map[string]any{"a": 1.0})
	b.Ler("cache") // should cache

	b.cacheMu.RLock()
	c := b.cacheArquivos[filepath.Join(b.pastaBancoCustom, "cache.json")]
	b.cacheMu.RUnlock()

	if c == nil {
		t.Error("Cache not populated")
	} else if !c.existe {
		t.Error("Cache should say exists")
	}
}


func TestLimite(t *testing.T) {
	b := New()
	b.Path(t.TempDir())

	limNodes := 2
	b.Limite("lim", &limNodes, nil, nil)

	_, err := b.Criar("lim", "n1", map[string]any{"v": 1.0})
	assertNoError(t, err, "First node within limits")

	_, err = b.Criar("lim", "n2", map[string]any{"v": 2.0})
	assertNoError(t, err, "Second node within limits")

	_, err = b.Criar("lim", "n3", map[string]any{"v": 3.0})
	assertError(t, err, "Third node should fail limit")
}

func TestCriarID(t *testing.T) {
	b := New()
	id1 := b.CriarID()
	id2 := b.CriarID()
	
	if id1 == "" || id2 == "" {
		t.Error("CriarID returned empty")
	}
	if id1 == id2 {
		t.Error("CriarID returned duplicate")
	}
	if len(id1) < 10 {
		t.Error("CriarID too short")
	}
}

func TestPesquisar(t *testing.T) {
	b := New()
	b.Path(t.TempDir())

	b.Criar("p1", "n1", map[string]any{"txt": "hello world"})
	b.Criar("p2", "n2", map[string]any{"txt": "bye world"})

	res, err := b.Pesquisar("hello")
	assertNoError(t, err, "Pesquisar")
	
	if _, ok := res["p1.json"]; !ok {
		t.Errorf("Expected p1.json in results, got %v", res)
	}
	if len(res) != 1 {
		t.Errorf("Expected exactly 1 file match, got %d", len(res))
	}
}

func TestAnalise(t *testing.T) {
	b := New()
	b.Path(t.TempDir())

	b.Criar("a1", "", map[string]any{"x": 1.0})
	b.Criar("a2", "", map[string]any{"y": 2.0, "z": 3.0})

	res, err := b.Analise(false)
	assertNoError(t, err, "Analise")

	assertEqual(t, 2, res.QuantidadeArquivos, "Should find 2 files")
}

func TestContarEstrutura(t *testing.T) {
	b := New()
	
	obj := map[string]any{
		"a": 1.0,
		"b": []any{1.0, 2.0},
		"c": map[string]any{"x": 1.0},
	}
	
	est := b.ContarEstrutura(obj)
	// 'a' is just a value. 'b' is array, 'c' is map.
	// nodes in root = 3.
	if est.Nodes == 0 {
		t.Error("Expected nodes > 0")
	}
}

func TestJsonTemDados(t *testing.T) {
	assertEqual(t, false, jsonTemDados(nil), "nil")
	
	assertEqual(t, false, jsonTemDados([]any{}), "empty slice")
	assertEqual(t, false, jsonTemDados(map[string]any{}), "empty map")
	assertEqual(t, true, jsonTemDados(map[string]any{"a": 1}), "non-empty map")
}

func TestClonarJson(t *testing.T) {
	orig := map[string]any{"a": 1.0, "b": []any{2.0}}
	clone := clonarJson(orig)
	
	orig["a"] = 2.0
	
	mClone, ok := clone.(map[string]any)
	if !ok || mClone["a"] != 1.0 {
		t.Errorf("Clone was mutated: %v", clone)
	}
}
