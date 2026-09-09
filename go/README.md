# Bancoz (Go Version)

Um banco de dados JSON simples, direto e sem servidor, agora para projetos **Go**.

Esta é a reimplementação oficial e fiel da biblioteca `bancoz-json` de Node.js para a linguagem Go. Nasceu para aquele momento em que você quer salvar dados de verdade, mas não quer montar um banco, configurar ORM, abrir conexão ou escrever `os.ReadFile` + `json.Unmarshal` + `os.WriteFile` toda vez.

Com Bancoz, isto:

```go
db.Criar("usuarios", "ana", map[string]any{"nome": "Ana", "plano": "pro"})
```

vira automaticamente um arquivo JSON em `BANCO Z/usuarios.json`.

## Por que usar?

- **Simples**: arquivos JSON legíveis, sem servidor e sem configuração obrigatória.
- **Prático**: CRUD em uma linha para criar, ler, atualizar e deletar.
- **Seguro para uso local**: escrita atômica e lock por arquivo para reduzir conflito entre operações concorrentes.
- **Organizado**: separa dados por arquivos e também aceita subpastas, como `loja/clientes`.
- **Híbrido**: usa disco local por padrão, ou API remota quando você define `ApiKey`.
- **Útil**: tem cache em memória, fila de gravação, backup, busca por texto, limites e análise de performance integrados na *standard library* (zero dependências externas).

## Instalação

```bash
go get github.com/cmstudioapps/bancoz-json/go
```

No seu código:

```go
import bancoz "github.com/cmstudioapps/bancoz-json/go"
```

## Uso rápido em Go

```go
package main

import (
	"fmt"
	bancoz "github.com/cmstudioapps/bancoz-json/go"
)

func main() {
	db := bancoz.Default() // Retorna a instância singleton

	// Criar
	db.Criar("usuarios", "ana", map[string]any{
		"nome": "Ana",
		"email": "ana@email.com",
		"plano": "free",
	})

	// Atualizar
	db.Atualizar("usuarios", "ana", map[string]any{
		"plano": "pro",
		"ativo": true,
	})

	// Ler
	ana, _ := db.Ler("usuarios", "ana")
	fmt.Println(ana)

	// Deletar
	db.Deletar("usuarios", "ana", "email")
}
```

O arquivo gerado fica assim:

```txt
BANCO Z/
  usuarios.json
```

E o conteúdo fica legível e estruturado:

```json
{
  "ana": {
    "nome": "Ana",
    "plano": "pro",
    "ativo": true
  }
}
```

## API Principal

A versão Go possui os mesmos métodos da versão Node.js originais (e também seus alias em inglês), sempre operando a partir da struct `*Bancoz`.

### `Criar(arquivo, no, dados)` ou `Create`

Cria ou substitui um nó dentro de um arquivo JSON.

```go
db.Criar("produtos", "cafe", map[string]any{
	"nome": "Cafe especial",
	"preco": 29.9,
})
```

Também dá para criar/substituir o arquivo inteiro omitindo o nó (passando `""`):

```go
db.Criar("config", "", map[string]any{
	"tema": "claro",
	"versao": 1,
})
```

### `Ler(arquivo, no...)` ou `Read`

Lê um arquivo inteiro ou apenas um nó.

```go
todos, _ := db.Ler("produtos")
cafe, _ := db.Ler("produtos", "cafe")
```

### `Atualizar(arquivo, no, dados, chave...)` ou `Update`

Atualiza parcialmente um objeto realizando um merge das propriedades.

```go
db.Atualizar("produtos", "cafe", map[string]any{
	"estoque": 12,
})
```

Também dá para atualizar uma chave específica informando-a no último argumento:

```go
db.Atualizar("produtos", "cafe", 39.9, "preco")
```

Para substituir o nó inteiro:

```go
db.Atualizar("produtos", "cafe", map[string]any{
	"nome": "Cafe novo",
	"preco": 35,
}, map[string]any{"substituir": true})
```

### `Deletar(arquivo, no, chaves...)` ou `Delete`

Remove um nó inteiro ou somente algumas chaves.

```go
db.Deletar("produtos", "cafe", "estoque")
db.Deletar("produtos", "cafe", []string{"preco", "categoria"})
db.Deletar("produtos", "cafe") // deleta o nó 'cafe' inteiro
```

## Subpastas

Você pode organizar os dados por pastas sem precisar criar os diretórios manualmente usando `os.Mkdir`. O Bancoz cuida disso:

```go
db.Criar("loja/clientes", "ana", map[string]any{"nome": "Ana"})
db.Criar("loja/pedidos", "pedido-1", map[string]any{"total": 129.9})
```

## Pasta Personalizada

Por padrão, o Bancoz salva na pasta `BANCO Z/` no diretório atual de onde seu binário for executado.

```go
db.Path("./dados")
db.Criar("usuarios", "ana", map[string]any{"nome": "Ana"})
```

Para voltar ao padrão, chame passando uma string vazia:

```go
db.Path("")
```

## Cache em memória

Para otimizar leituras repetidas do mesmo JSON, ative o cache:

```go
db.Cache(true) // Ativa cache sem expiração
db.Cache(true, 10) // Ativa cache com 10 minutos de expiração

db.Ler("usuarios") // Vai ao disco
db.Ler("usuarios") // Lê da memória instantaneamente
```

Para inspecionar o status do cache no terminal:

```go
db.GetCache(true, "files")
```

## Busca

Pesquise uma palavra em todos os JSONs locais. A versão Go remove acentos automaticamente na busca.

```go
// Busca por "ana" em todos os arquivos (*)
resultado, _ := db.Pesquisar("ana", "*")
fmt.Println(resultado)
```

Ou em um arquivo específico:

```go
resultado, _ := db.Pesquisar("pro", "usuarios")
```

O retorno é um mapa contendo os caminhos (JSON paths) onde o termo foi encontrado dentro de cada arquivo.

## Fila, Backup e Logs

```go
db.Bk(true)     // ou db.Backup(true): cria .backup antes de alterações perigosas
db.Fila(true)   // ou db.Queue(true): garante que todas as operações rodem numa fila estruturada
db.Log(true)    // exibe logs de operação no terminal
db.Lang("en")   // ou db.Language("en"): altera as mensagens de log para inglês
```

## Limites (Limits)

Defina limites simples de estrutura para um arquivo local para se proteger de inflar muito o JSON:

```go
nodes := 100
subnodes := 500
arrays := 50
db.Limite("usuarios", &nodes, &subnodes, &arrays) // Ou db.SetLimit()

uso, _ := db.GetLimite("usuarios")
```

Ou limites avançados por profundidade:

```go
db.LimiteAvancado("usuarios", map[string]map[string]int{
	"0": {"maxKeys": 100},
	"1": {"maxKeys": 10, "maxSubnodes": 50},
}) // Ou db.AdvancedLimit()
```

## Modo Remoto

O modo local é o padrão. Caso você queira se conectar à API bancoz.squareweb.app:

```go
db.ApiKey("sua_api_key")

// As operações agora vão para a internet ao invés de arquivos locais
db.Criar("usuarios", "ana", map[string]any{"nome": "Ana"})

db.ApiKey("") // Volta para o modo local
```

## Análise dos arquivos

```go
relatorio, _ := db.Analise(true) // Imprime um gráfico legal no terminal
fmt.Println(relatorio.QuantidadeArquivos)
```

## Gerar IDs

```go
id := db.CriarID() // Gera timestamp-hash
db.Criar("sessoes", id, map[string]any{"criadoEm": time.Now().Unix()})

// Dá para controlar os caracteres e o tamanho:
idCurto := db.CriarID("abcdef012345", 8)
idEnglish := db.CreateID()
```

## Objetivo do Bancoz

Use o Bancoz quando você quiser persistência simples, estruturada em JSON legível e código limpo, sem dor de cabeça.

Ele não tenta substituir bancos relacionais ou otimizar consultas complexas. Ele resolve perfeitamente o caso mais comum para projetos menores e protótipos: salvar e ler dados locais com o mínimo de código e máxima segurança.
