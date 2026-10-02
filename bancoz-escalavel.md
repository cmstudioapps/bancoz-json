# Bancoz Escalável

## Documento de arquitetura e estratégias de evolução

O Bancoz nasceu com uma proposta simples: oferecer uma camada de persistência direta, com uma API pequena e intuitiva, sem exigir servidor, ORM, schema ou configuração pesada.

A API pode ser extremamente simples:

```js
await bancoz.criar('usuarios', 'caio', {
  nome: 'Caio',
  plano: 'pro'
});

const usuario = await bancoz.ler('usuarios', 'caio');

await bancoz.atualizar('usuarios', 'caio', {
  plano: 'enterprise'
});

await bancoz.deletar('usuarios', 'caio');
```

A simplicidade da API, porém, não obriga o mecanismo interno de armazenamento a continuar sendo o mesmo para sempre.

Este documento apresenta estratégias para transformar o Bancoz em uma solução capaz de trabalhar com volumes muito maiores de dados sem necessariamente transformá-lo em apenas uma camada sobre SQL.

---

# 1. O problema do modelo atual

O Bancoz atual usa arquivos JSON como armazenamento local.

Um exemplo conceitual seria:

```text
BANCO Z/
└── usuarios.json
```

Com conteúdo:

```json
{
  "caio": {
    "nome": "Caio",
    "idade": 20
  },
  "ana": {
    "nome": "Ana",
    "idade": 25
  },
  "joao": {
    "nome": "João",
    "idade": 31
  }
}
```

Esse modelo é excelente para dados pequenos e médios.

O problema aparece quando o arquivo cresce demais.

## 1.1 O custo da leitura

Se o usuário executar:

```js
await bancoz.ler('usuarios', 'caio');
```

o mecanismo tradicional pode precisar fazer:

```text
usuarios.json
       ↓
ler o arquivo
       ↓
JSON.parse()
       ↓
obter "caio"
```

Mesmo que só um registro seja necessário, o arquivo inteiro pode precisar entrar em memória para que o JSON seja interpretado.

## 1.2 O custo da atualização

Imagine:

```text
usuarios.json = 500 MB
```

Uma operação como:

```js
await bancoz.atualizar('usuarios', 'caio', {
  idade: 21
});
```

pode resultar conceitualmente em:

```text
ler 500 MB
    ↓
parsear 500 MB
    ↓
alterar poucos bytes
    ↓
serializar novamente centenas de MB
    ↓
gravar novamente
```

O problema fundamental é que o custo está relacionado ao tamanho do arquivo, e não necessariamente ao tamanho do registro alterado.

---

# 2. A pergunta certa

A questão não é:

> "Como fazer um JSON gigante ficar rápido?"

A questão é:

> "Como manter a API simples do Bancoz enquanto o armazenamento interno deixa de depender de um único JSON gigante?"

Essa mudança de perspectiva é importante.

A API pública pode permanecer:

```js
bancoz.criar()
bancoz.ler()
bancoz.atualizar()
bancoz.deletar()
```

enquanto o mecanismo interno evolui completamente.

---

# 3. Estratégia 1: dividir os dados em múltiplos arquivos

A primeira evolução natural é quebrar um arquivo lógico em vários arquivos físicos.

Em vez de:

```text
usuarios.json
```

teríamos algo como:

```text
usuarios/
├── shard-001.json
├── shard-002.json
├── shard-003.json
└── shard-004.json
```

Cada arquivo contém apenas uma parte dos registros.

Por exemplo:

```text
shard-001.json
├── ana
├── bia
└── bruno
```

e:

```text
shard-002.json
├── caio
├── carlos
└── celso
```

## 3.1 Vantagem

Um arquivo de 1 GB pode ser dividido em centenas ou milhares de arquivos menores.

Assim, uma operação não precisa necessariamente trabalhar com 1 GB de dados.

Isso cria o conceito de **particionamento físico**.

## 3.2 Novo problema

Surge imediatamente uma pergunta:

> "Como a Bancoz descobre em qual arquivo está cada registro?"

Uma solução óbvia seria criar um índice.

---

# 4. Estratégia 2: índice global

Poderíamos ter:

```text
usuarios/
├── index.json
├── shard-001.json
├── shard-002.json
├── shard-003.json
└── ...
```

E:

```json
{
  "caio": "shard-003",
  "ana": "shard-001",
  "joao": "shard-004"
}
```

A operação seria:

```text
ler("usuarios", "caio")
        ↓
index.json
        ↓
caio → shard-003
        ↓
shard-003.json
        ↓
registro
```

Isso resolve o problema de descobrir a localização.

Mas cria outro.

---

# 5. O problema do índice gigante

Se existirem milhões de registros, o próprio índice pode ficar enorme.

Por exemplo:

```text
1.000.000 registros

        ↓

index.json
   talvez enorme
```

Nesse cenário, apenas transferimos o problema.

Antes:

```text
dados gigantes
```

Agora:

```text
índice gigante
+
dados divididos
```

Portanto, um único índice global não é uma solução completa.

---

# 6. Estratégia 3: índice hierárquico

Uma alternativa é dividir o próprio índice.

Em vez de:

```text
index.json
```

teríamos algo como:

```text
index/
├── a.json
├── b.json
├── c.json
├── d.json
└── ...
```

Por exemplo:

```text
index/c.json
```

poderia conter registros que pertencem ao grupo "c":

```json
{
  "caio": "shard-37",
  "carlos": "shard-12",
  "celso": "shard-81"
}
```

Então:

```text
ler("usuarios", "caio")
        ↓
descobrir grupo "c"
        ↓
index/c.json
        ↓
caio → shard-37
        ↓
shard-37.json
```

## 6.1 Vantagem

O índice deixa de ser um único arquivo monstruoso.

Cada parte é menor e pode ser lida separadamente.

## 6.2 Limitação

Ainda estamos mantendo um mapeamento individual:

```text
caio → shard
carlos → shard
celso → shard
...
```

Em volumes muito grandes, isso continua gerando muito metadado.

Por isso existe uma estratégia ainda mais interessante.

---

# 7. Estratégia 4: localização determinística por hash

Em vez de armazenar explicitamente:

```text
caio → shard-291
```

a Bancoz pode calcular o shard.

A ideia é:

```text
ID
 ↓
hash(ID)
 ↓
bucket/shard
```

Por exemplo:

```text
hash("caio") = 837291
```

E:

```text
837291 % 1000 = 291
```

Logo:

```text
caio → shard-291
```

A Bancoz não precisa perguntar ao índice onde está `caio`.

Ela calcula.

---

# 8. Como isso funciona na prática

Poderíamos ter:

```text
usuarios/
├── 000.json
├── 001.json
├── 002.json
├── ...
├── 997.json
├── 998.json
└── 999.json
```

Para:

```js
await bancoz.ler('usuarios', 'caio');
```

o fluxo seria conceitualmente:

```text
"caio"
   ↓
hash("caio")
   ↓
837291
   ↓
837291 % 1000
   ↓
291
   ↓
usuarios/291.json
```

A vantagem é enorme:

**não existe um índice global dizendo onde cada chave está.**

A própria chave determina a partição.

---

# 9. O problema do shard ainda existir

Agora surgiu outra questão.

Suponha:

```text
usuarios/291.json
```

e esse arquivo possui:

```text
50 MB
```

Encontramos o shard correto, mas ainda precisamos encontrar o registro dentro dele.

Se a Bancoz fizer:

```text
ler 50 MB
↓
JSON.parse()
↓
procurar "caio"
```

voltamos ao problema original, apenas em menor escala.

Portanto, precisamos dividir mais uma vez.

---

# 10. Estratégia 5: buckets menores dentro dos shards

A estrutura pode se tornar hierárquica:

```text
usuarios/
├── 000/
│   ├── 000.json
│   ├── 001.json
│   └── 002.json
├── 001/
│   ├── 000.json
│   └── 001.json
├── ...
└── 291/
    ├── 000.json
    ├── 001.json
    └── 002.json
```

Ou:

```text
usuarios/
└── 291/
    ├── segment-001.json
    ├── segment-002.json
    └── segment-003.json
```

A ideia passa a ser:

```text
chave
 ↓
hash
 ↓
shard
 ↓
segmento
 ↓
registro
```

Isso reduz progressivamente a quantidade de dados que precisa ser lida por operação.

---

# 11. Estratégia 6: índice local por shard

Outra abordagem é permitir que cada shard possua seu próprio índice.

Exemplo:

```text
usuarios/
└── 291/
    ├── index.json
    ├── data-001.json
    ├── data-002.json
    └── data-003.json
```

O índice seria pequeno em relação a um índice global:

```json
{
  "caio": "data-002",
  "carlos": "data-001",
  "celso": "data-003"
}
```

Então:

```text
caio
 ↓
hash
 ↓
shard 291
 ↓
index do shard
 ↓
data-002
 ↓
caio
```

Isso reduz o tamanho máximo de cada índice.

---

# 12. Estratégia 7: offsets em vez de nome de arquivo

Podemos ir além.

Em vez de registrar:

```json
{
  "caio": "data-002"
}
```

podemos registrar uma posição:

```json
{
  "caio": {
    "offset": 18420,
    "tamanho": 512
  }
}
```

O significado poderia ser:

```text
offset  = posição inicial do registro
tamanho = quantidade de bytes
```

Assim:

```text
arquivo de dados
─────────────────────────────────────────────
                     ↑
                  offset
                     ↓
              [registro caio]
```

O armazenamento pode buscar diretamente a região relevante.

## 12.1 Por que isso é poderoso?

Porque a leitura deixa de depender da estrutura completa do JSON.

Conceitualmente:

```text
arquivo
  ↓
posição 18420
  ↓
ler 512 bytes
  ↓
decodificar registro
```

Isso aproxima o Bancoz de um mecanismo de armazenamento orientado a registros.

---

# 13. O problema dos registros que mudam de tamanho

Offsets criam um novo problema.

Imagine:

```text
caio
offset = 1000
tamanho = 200
```

Depois:

```js
await bancoz.atualizar('usuarios', 'caio', {
  descricao: "um texto enorme..."
});
```

O registro pode passar de:

```text
200 bytes
```

para:

```text
5000 bytes
```

Ele talvez não caiba mais no lugar original.

Então o mecanismo precisa de uma política.

Algumas possibilidades:

### Opção A: mover o registro

```text
posição antiga
      ↓
registro removido
      ↓
registro escrito em outro local
      ↓
índice atualizado
```

### Opção B: usar espaço livre

Reservar áreas livres para crescimento.

### Opção C: append-only

Nunca sobrescrever diretamente.

Toda alteração gera uma nova versão no final do arquivo:

```text
registro antigo
registro novo
```

E o índice passa a apontar para a versão mais recente.

Essa terceira abordagem é especialmente interessante para um engine próprio.

---

# 14. Estratégia 8: armazenamento append-only

Um arquivo pode funcionar como uma sequência de registros.

Exemplo conceitual:

```text
[data registro A]
[data registro B]
[data registro C]
[data registro D]
```

Quando `B` é atualizado:

```text
[data A]
[data B antigo]
[data C]
[data D]
[data B novo]
```

O índice agora aponta para:

```text
B → posição do "B novo"
```

A escrita é simples porque normalmente adiciona dados ao final.

Depois, o Bancoz pode executar **compactação**.

---

# 15. Compactação

Com o passar do tempo, um sistema append-only pode acumular versões antigas.

Exemplo:

```text
B antigo
B novo
B mais novo
B atual
```

A compactação poderia transformar isso em:

```text
B atual
```

O processo seria:

```text
segmentos antigos
        ↓
analisar registros válidos
        ↓
descartar versões obsoletas
        ↓
criar segmento compacto
        ↓
atualizar índice
```

Isso é conhecido como **compaction**.

---

# 16. Estratégia 9: segmentos rotativos

Em vez de um arquivo crescer indefinidamente:

```text
data
```

o Bancoz pode criar segmentos:

```text
data/
├── 000001.data
├── 000002.data
├── 000003.data
└── ...
```

Cada segmento pode ter um limite:

```text
10 MB
50 MB
100 MB
```

Quando o segmento atinge o limite:

```text
segment-001
      ↓
cheio
      ↓
segment-002
```

Isso permite controlar melhor:

- tamanho dos arquivos;
- compactação;
- recuperação;
- manutenção;
- paralelismo.

---

# 17. Estratégia 10: índice em níveis

Em vez de pensar apenas em:

```text
chave → arquivo
```

podemos pensar em uma árvore:

```text
                 índice raiz
                     ↓
              índice de bucket
                     ↓
               índice local
                     ↓
                   dado
```

Conceitualmente:

```text
Bancoz
  ↓
Root Index
  ↓
Bucket Index
  ↓
Shard
  ↓
Segment Index
  ↓
Offset
  ↓
Registro
```

A busca deixa de varrer uma massa de dados.

Ela segue uma rota conhecida.

---

# 18. O Bancoz poderia escolher automaticamente a estratégia

A API poderia continuar simples:

```js
await bancoz.criar('usuarios', 'caio', dados);
```

Mas internamente:

```text
Bancoz
  ↓
Storage Engine
  ↓
resolver chave
  ↓
hash
  ↓
bucket
  ↓
segmento
  ↓
índice
  ↓
offset
  ↓
registro
```

O usuário não precisa saber nada disso.

---

# 19. Uma arquitetura possível

Uma arquitetura futura poderia ser:

```text
                         Bancoz API
                              │
                  ┌───────────┴───────────┐
                  │                       │
             Local Engine            Remote Engine
                  │                       │
          ┌───────┼───────┐               │
          │       │       │               │
         JSON   SQLite   Custom            API
          │                       ┌───────┼────────┐
          │                       │       │        │
          │                    Storage  Cache   Replicação
          │                       │
          │                  Bancoz Engine
          │                       │
          │              ┌────────┴────────┐
          │              │                 │
          │           Shards           Índices
          │              │                 │
          │          Segmentos          Offsets
          │              │
          └──────────────┴───────────────► Dados
```

O ponto importante dessa arquitetura é que a API do Bancoz fica desacoplada do armazenamento.

---

# 20. JSON não precisa desaparecer

A evolução não precisa ser:

```text
JSON
   ↓
abandona JSON
   ↓
SQL
```

Pode ser:

```text
JSON simples
   ↓
JSON particionado
   ↓
JSON + índices
   ↓
segmentos
   ↓
engine próprio
```

O JSON pode continuar sendo usado onde ele faz sentido.

Por exemplo:

### Projeto pequeno

```text
BANCO Z/
└── usuarios.json
```

### Projeto maior

```text
BANCO Z/
└── usuarios/
    ├── shard-000/
    ├── shard-001/
    ├── shard-002/
    └── ...
```

A API continua igual.

---

# 21. Compatibilidade com o Bancoz atual

Uma das vantagens dessa estratégia é preservar a filosofia da biblioteca.

Código atual:

```js
await bancoz.criar('usuarios', 'caio', {
  nome: 'Caio'
});
```

Código futuro:

```js
await bancoz.criar('usuarios', 'caio', {
  nome: 'Caio'
});
```

Nenhuma mudança.

O mecanismo poderia decidir automaticamente:

```text
arquivo pequeno?
    ↓
JSON simples

arquivo maior?
    ↓
armazenamento particionado

volume alto?
    ↓
engine segmentado
```

Isso torna a implementação progressiva.

---

# 22. O papel do hash

O hash é especialmente importante quando não queremos depender de um índice global.

Uma função de hash pode distribuir chaves:

```text
caio   → 291
ana    → 104
joao   → 877
maria  → 451
```

Então:

```text
hash(chave) % quantidadeDeBuckets
```

pode determinar o bucket.

## 22.1 Vantagem

Não precisamos armazenar:

```text
caio → 291
ana → 104
joao → 877
```

porque a localização pode ser calculada.

## 22.2 Cuidado

Se a quantidade de buckets mudar de:

```text
100
```

para:

```text
1000
```

o resultado do módulo muda.

Isso pode fazer muitos registros "mudarem de lugar" logicamente.

Portanto, um sistema robusto precisa pensar em:

- buckets fixos;
- hash consistente;
- diretório de partições;
- split de shards;
- migração controlada.

---

# 23. Split de shard

Uma técnica interessante é permitir que um shard cresça até determinado limite.

Exemplo:

```text
shard-291
  100 MB
```

Quando passar do limite:

```text
shard-291
      ↓
split
      ↓
shard-291-a
shard-291-b
```

O Bancoz atualiza a maneira de localizar as chaves daquele shard.

Isso permite crescimento gradual.

---

# 24. E se um shard ficar muito quente?

Existe outro problema: **hot shard**.

Imagine que muitas requisições caem no mesmo bucket:

```text
shard-291
████████████████████████████████
```

Enquanto outros ficam quase parados:

```text
shard-100
██

shard-200
█

shard-300
███
```

Uma arquitetura mais avançada pode dividir o shard quente novamente.

Assim:

```text
shard-291
    ↓
291-A
291-B
291-C
```

O objetivo é evitar que uma única região concentre todas as operações.

---

# 25. Concorrência

Dividir dados não resolve tudo.

Também precisamos lidar com concorrência.

No Bancoz atual existe conceito de lock por arquivo.

Isso funciona bem para o cenário local em que os processos compartilham o mesmo sistema de arquivos.

Mas, em uma arquitetura distribuída, o problema muda.

Podemos ter:

```text
Servidor A
Servidor B
Servidor C
```

todos tentando atualizar:

```text
usuario caio
```

Então o armazenamento precisa fornecer uma forma consistente de serializar as alterações.

Num engine local isso pode envolver:

- locks;
- mutex;
- WAL;
- versionamento;
- compare-and-swap;
- filas por shard.

Num sistema remoto, pode envolver:

- controle transacional;
- liderança;
- consenso;
- armazenamento compartilhado;
- filas distribuídas.

---

# 26. WAL: Write-Ahead Log

Uma evolução importante para um engine próprio seria um **WAL**.

Antes de modificar o armazenamento principal, registramos a operação:

```text
WAL
 ↓
atualizar caio
 ↓
confirmar operação
 ↓
aplicar ao armazenamento
```

Se o processo cair no meio:

```text
aplicação caiu
     ↓
ler WAL
     ↓
identificar operação incompleta
     ↓
reconstruir estado
```

Isso melhora muito a recuperação após falhas.

---

# 27. Cache

O cache atual do Bancoz é útil, mas em um engine escalável ele pode se tornar mais sofisticado.

Podemos ter níveis:

```text
L1
RAM do processo

L2
cache compartilhado

L3
disco
```

Por exemplo:

```text
ler caio
   ↓
L1 encontrou?
   ↓
sim → retorna
não
   ↓
L2 encontrou?
   ↓
sim → retorna + popula L1
não
   ↓
disco
```

Isso pode reduzir drasticamente a leitura física.

---

# 28. Busca

Uma função como:

```js
await bancoz.pesquisar('caio', 'usuarios');
```

também precisa mudar de estratégia em grande escala.

Não é eficiente fazer:

```text
abrir todos os arquivos
        ↓
ler tudo
        ↓
procurar texto
```

Para volumes maiores seria necessário algum tipo de índice.

Exemplo:

```text
"caio"
   ↓
índice
   ↓
usuarios
   ↓
shard
   ↓
registro
```

Isso transforma pesquisa de força bruta em pesquisa indexada.

---

# 29. O que seria realmente "Bancoz escalável"?

É importante não usar "escalável" apenas como sinônimo de "tem vários JSONs".

Um Bancoz realmente escalável precisa considerar:

```text
✓ particionamento
✓ localização eficiente
✓ índices
✓ escrita incremental
✓ concorrência
✓ recuperação após falhas
✓ compactação
✓ cache
✓ crescimento dos shards
✓ hot shards
✓ integridade dos metadados
✓ controle de versões
✓ monitoramento
```

Quanto mais dessas características forem implementadas, mais próximo o sistema estará de um verdadeiro storage engine.

---

# 30. SQL continua sendo uma opção

Nada disso significa que SQL seja ruim.

SQLite, PostgreSQL ou outro banco podem ser usados como backend.

Uma arquitetura poderia ser:

```text
Bancoz API
     ↓
Storage Adapter
     ↓
PostgreSQL
```

Mas outra poderia ser:

```text
Bancoz API
     ↓
Bancoz Storage Engine
     ↓
Shards
     ↓
Segments
     ↓
Indexes
```

O segundo caminho preserva mais da ideia de um banco próprio.

---

# 31. Uma estratégia híbrida

Também é possível oferecer múltiplos backends:

```text
Bancoz
  │
  ├── JSON
  │
  ├── JSON Sharded
  │
  ├── SQLite
  │
  ├── PostgreSQL
  │
  └── Engine Bancoz
```

O usuário poderia escolher:

```js
bancoz.storage('json');
```

ou:

```js
bancoz.storage('sharded');
```

ou:

```js
bancoz.storage('sqlite');
```

ou futuramente:

```js
bancoz.storage('bancoz-engine');
```

A API de alto nível continua igual.

---

# 32. Uma possível evolução por versões

Uma evolução prática poderia seguir esta sequência.

## Fase 1 — Bancoz atual

```text
API
 ↓
JSON
```

Objetivo:

- simplicidade;
- baixo overhead;
- facilidade de debug;
- uso local.

## Fase 2 — JSON particionado

```text
API
 ↓
Shard manager
 ↓
JSON shards
```

Objetivo:

- reduzir tamanho máximo dos arquivos;
- evitar JSON gigantes.

## Fase 3 — Hash/buckets

```text
API
 ↓
Hash
 ↓
Bucket
 ↓
JSON
```

Objetivo:

- eliminar índice global;
- localizar rapidamente a partição.

## Fase 4 — Índices locais

```text
Bucket
 ↓
Índice
 ↓
Segmento
 ↓
Registro
```

Objetivo:

- acelerar localização interna.

## Fase 5 — Segmentos + offsets

```text
Hash
 ↓
Shard
 ↓
Índice
 ↓
Offset
 ↓
Registro
```

Objetivo:

- leitura parcial;
- escrita incremental;
- menor custo por operação.

## Fase 6 — WAL + compactação

```text
operação
 ↓
WAL
 ↓
segmento
 ↓
compactação
```

Objetivo:

- recuperação;
- durabilidade;
- controle do crescimento.

## Fase 7 — distribuição

```text
Cliente
   ↓
Bancoz Server
   ↓
Shard Router
   ↓
Storage Nodes
```

Objetivo:

- múltiplas máquinas;
- escalabilidade horizontal;
- distribuição de carga.

---

# 33. Uma arquitetura conceitual final

Uma possível arquitetura madura seria:

```text
                         ┌─────────────────┐
                         │   Bancoz API    │
                         └────────┬────────┘
                                  │
                         ┌────────▼────────┐
                         │ Storage Engine  │
                         └────────┬────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                 Resolver       Cache           WAL
                    │
                 Hash/Index
                    │
              ┌─────▼─────┐
              │   Shard   │
              └─────┬─────┘
                    │
             ┌──────▼──────┐
             │   Segment   │
             └──────┬──────┘
                    │
             ┌──────▼──────┐
             │   Offset    │
             └──────┬──────┘
                    │
             ┌──────▼──────┐
             │   Registro  │
             └─────────────┘
```

Essa arquitetura já não depende de:

```text
"um arquivo JSON representa todo o banco"
```

O arquivo JSON passa a ser apenas uma possível representação de partes do armazenamento.

---

# 34. A principal conclusão

A escalabilidade da Bancoz não precisa depender de transformar a biblioteca em uma camada sobre SQL.

O ponto essencial é abandonar a ideia de que:

```text
1 entidade lógica
=
1 JSON gigante
```

Uma arquitetura escalável pode evoluir para:

```text
entidade lógica
      ↓
particionamento
      ↓
shard
      ↓
segmento
      ↓
índice
      ↓
offset
      ↓
registro
```

A chave também pode determinar a localização:

```text
chave
 ↓
hash
 ↓
bucket
```

e o índice pode existir apenas onde realmente for necessário.

---

# 35. A visão mais importante para o Bancoz

O objetivo não deveria ser necessariamente:

> "Fazer JSON competir diretamente com PostgreSQL."

O objetivo mais interessante seria:

> "Fazer a API do Bancoz continuar extremamente simples enquanto o mecanismo interno evolui de um armazenamento JSON simples para um storage engine capaz de particionar, indexar, compactar e distribuir dados."

Isso permite manter:

```js
bancoz.criar()
bancoz.ler()
bancoz.atualizar()
bancoz.deletar()
```

enquanto o que existe por trás dessas funções pode crescer de:

```text
JSON simples
```

para:

```text
JSON particionado
```

depois:

```text
shards + índices
```

depois:

```text
segmentos + offsets + WAL
```

e finalmente, caso faça sentido:

```text
cluster distribuído
```

O usuário da biblioteca não precisa necessariamente perceber nenhuma dessas mudanças.

Essa separação entre **API simples** e **engine interno sofisticado** é o que permite que a Bancoz cresça sem abandonar a ideia que tornou a biblioteca simples de usar.
 seja lá qual dessas arquiteturas e estrategias seja a escolhida ela deve vim com um comando bancoz ui, q deve abrir um app desktop electron pra linux debian, essa ui deve exibir visualmente os dados organizados e com barra de pesquisa e editaveis, a ui em si deve ser inteligente ela mesmo deve ler e exibir sem travar a maquina do user.

