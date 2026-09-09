package bancoz

import (
	"fmt"
)

// processarOperacao is implemented in crud.go
// func (b *Bancoz) processarOperacao(op operacao) (any, error)

// executarOperacao If filaAtiva, creates a filaItem with a result channel, 
// pushes to filaOperacoes (under filaMu lock), calls go processarFila(), 
// then blocks waiting on the channel. If !filaAtiva, calls processarOperacao directly.
func (b *Bancoz) executarOperacao(tipo, arquivo, no string, dados any, chave any) (any, error) {
	op := operacao{
		tipo:    tipo,
		arquivo: arquivo,
		no:      no,
		dados:   dados,
		chave:   chave,
	}

	if b.filaAtiva {
		resultChan := make(chan filaResult, 1)
		
		b.filaMu.Lock()
		b.filaOperacoes = append(b.filaOperacoes, filaItem{
			op:     op,
			result: resultChan,
		})
		b.logInterno(fmt.Sprintf("Operação %s enfileirada para %s/%s", tipo, arquivo, no))
		
		if !b.processandoFila {
			go b.processarFila()
		}
		b.filaMu.Unlock()

		res := <-resultChan
		return res.valor, res.err
	}

	return b.processarOperacao(op)
}

// processarFila Under filaMu lock, checks if processandoFila is true (if so, return). 
// Sets processandoFila = true. Then loops: under lock, shift first item from filaOperacoes, 
// unlock, call processarOperacao, send result on channel. When queue is empty, set processandoFila = false.
func (b *Bancoz) processarFila() {
	b.filaMu.Lock()
	if b.processandoFila || len(b.filaOperacoes) == 0 {
		b.filaMu.Unlock()
		return
	}
	b.processandoFila = true
	b.filaMu.Unlock()

	for {
		b.filaMu.Lock()
		if len(b.filaOperacoes) == 0 {
			b.processandoFila = false
			b.filaMu.Unlock()
			break
		}
		
		item := b.filaOperacoes[0]
		b.filaOperacoes = b.filaOperacoes[1:]
		b.filaMu.Unlock()

		valor, err := b.processarOperacao(item.op)
		item.result <- filaResult{valor: valor, err: err}
	}
}
