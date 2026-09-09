package bancoz

// Note: Backup logic is integrated into crud.go's processarOperacao.

// criarBackupSeNecessario creates a backup file if backup is active and there's content.
func (b *Bancoz) criarBackupSeNecessario(caminhoArquivo, conteudoAtual string) (bool, error) {
	if b.backupAtivo && conteudoAtual != "" {
		err := b.escreverArquivoAtomico(caminhoArquivo+".backup", conteudoAtual)
		if err != nil {
			return false, err
		}
		return true, nil
	}
	return false, nil
}

// restaurarBackupSeNecessario restores the backup if it was created and backup is active.
func (b *Bancoz) restaurarBackupSeNecessario(caminhoArquivo string, backupCriado bool) error {
	if b.backupAtivo && backupCriado {
		conteudo, _, err := b.lerJsonComRetry(caminhoArquivo+".backup", 1)
		if err != nil {
			return err
		}
		if conteudo != "" {
			return b.escreverArquivoAtomico(caminhoArquivo, conteudo)
		}
	}
	return nil
}
