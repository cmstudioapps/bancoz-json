// bancoz.js - Biblioteca de banco de dados JSON simples com fila e backup
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

class Bancoz {
    constructor() {
        this.filaAtiva = false;
        this.backupAtivo = false;
        this.logAtivo = false;
        this.filaOperacoes = [];
        this.processandoFila = false;
        this.idioma = 'pt'; // pt ou en
        this.lockTimeoutMs = 30000;
        this.lockStaleMs = 120000;
        this.apiKey = null;
        this.pastaBancoCustomizada = null;
        this.cacheAtivo = false;
        this.cacheTtlMs = null;
        this.cacheArquivos = new Map();
    }

    // ==================== NOVOS MÉTODOS - LIMITES E ID ====================

    /**
     * Conta estrutura JSON recursivamente: nodes, subnodes, arrays (flat)
     */
    contarEstrutura(obj, profundidade = 0) {
        if (obj == null || typeof obj !== 'object') return { nodes: 0, subnodes: 0, arrays: 0 };

        let nodes = 0, subnodes = 0, arrays = 0;

        if (Array.isArray(obj)) {
            nodes = obj.length;
            arrays += obj.length;
            obj.forEach(item => {
                const sub = this.contarEstrutura(item, profundidade + 1);
                arrays += sub.arrays;
                subnodes += sub.nodes + sub.subnodes;
            });
        } else {
            nodes = Object.keys(obj).length;
            Object.values(obj).forEach(val => {
                const sub = this.contarEstrutura(val, profundidade + 1);
                subnodes += sub.nodes;
                arrays += sub.arrays;
                if (profundidade > 0) subnodes += sub.subnodes;
            });
        }

        return { nodes, subnodes, arrays };
    }

    /**
     * Conta estrutura JSON por nível de profundidade para limites avançados.
     * @param {any} obj - Objeto JSON a analisar
     * @returns {object} { [depth]: {keys: number, nodes: number, subnodes: number}, maxDepth: number }
     */
    contarEstruturaPorProfundidade(obj) {
        const resultado = {};
        let maxDepth = 0;

        const contarRecursivo = (valor, depth = 0) => {
            if (valor == null || typeof valor !== 'object') return { nodes: 0, subnodes: 0, maxDepth: depth };

            if (!resultado[depth]) {
                resultado[depth] = { keys: 0, nodes: 0, subnodes: 0 };
            }

            let keysCount = 0;
            let localNodes = 0;
            let localSubnodes = 0;

            if (Array.isArray(valor)) {
                keysCount = valor.length;
                resultado[depth].keys += keysCount;
                localNodes = keysCount;
                valor.forEach(item => {
                    const sub = contarRecursivo(item, depth + 1);
                    localSubnodes += sub.nodes + sub.subnodes;
                    maxDepth = Math.max(maxDepth, sub.maxDepth);
                });
            } else {
                keysCount = Object.keys(valor).length;
                resultado[depth].keys += keysCount;
                localNodes = keysCount;
                Object.values(valor).forEach(val => {
                    const sub = contarRecursivo(val, depth + 1);
                    localSubnodes += sub.nodes;
                    maxDepth = Math.max(maxDepth, sub.maxDepth);
                });
            }

            resultado[depth].nodes += localNodes;
            resultado[depth].subnodes += localSubnodes;
            maxDepth = Math.max(maxDepth, depth);

            return { nodes: localNodes, subnodes: localSubnodes, maxDepth: maxDepth };
        };

        contarRecursivo(obj);
        return { porProfundidade: resultado, maxDepth };
    }

    async caminhoAdvancedLimitJson() {
        const pasta = await this.garantirPastaConfigsBanco();
        return path.join(pasta, 'advanced-limits.json');
    }

    async caminhoLimitJson() {
        const pasta = await this.garantirPastaConfigsBanco();
        return path.join(pasta, 'limit.json');
    }

    /**
     * Lê limites do limit.json
     */
    async lerLimites() {
        try {
            const caminho = await this.caminhoLimitJson();
            const { dados } = await this.lerJsonComRetry(caminho);
            return dados || {};
        } catch {
            return {};
        }
    }

    /**
     * Lê limites avançados por profundidade (advanced-limits.json)
     */
    async lerLimitesAvancados() {
        try {
            const caminho = await this.caminhoAdvancedLimitJson();
            const { dados } = await this.lerJsonComRetry(caminho);
            return dados || {};
        } catch {
            return {};
        }
    }

    /**
     * Salva limites no limit.json (atomicamente)
     */
    async salvarLimites(limites) {
        const caminho = await this.caminhoLimitJson();
        await this.escreverArquivoAtomico(caminho, JSON.stringify(limites, null, 2));
    }

    /**
     * Salva limites avançados (atomicamente)
     */
    async salvarLimitesAvancados(limites) {
        const caminho = await this.caminhoAdvancedLimitJson();
        await this.escreverArquivoAtomico(caminho, JSON.stringify(limites, null, 2));
    }

    /**
     * Verifica se pode salvar no arquivo respeitando limites
     */
    /**
     * Verifica limites avançados por profundidade
     */
    async verificarLimiteAvancado(arquivo, dadosNovos) {
        const limites = await this.lerLimitesAvancados();
        const nomeArquivo = this.normalizarNomeArquivo(arquivo);
        const config = limites[nomeArquivo];
        if (!config) return true;

        const caminho = path.join(await this.garantirPastaBanco(), nomeArquivo);
        const { dados: dadosAtual } = await this.lerJsonComRetry(caminho);
        
        // Simulate full data after add/update: dadosAtual + dadosNovos as root node
        const dadosFull = { ...dadosAtual, ...dadosNovos };
        const estruturaFull = this.contarEstruturaPorProfundidade(dadosFull);
        
        const msgErro = (tipo, limite, depth) => {
            const tiposPt = { keys: 'chaves', nodes: 'nós', subnodes: 'subnós' };
            const tiposEn = { keys: 'keys', nodes: 'nodes', subnodes: 'subnodes' };
            const tipos = this.idioma === 'pt' ? tiposPt : tiposEn;
            return this.idioma === 'pt'
                ? `Limite de ${limite} ${tipos[tipo]} no nível ${depth} atingido para ${nomeArquivo}`
                : `Limit of ${limite} ${tipos[tipo]} at depth ${depth} reached for ${nomeArquivo}`;
        };

        Object.keys(config).forEach(depthStr => {
            const depth = parseInt(depthStr);
            const levelConfig = config[depthStr];
            const levelAtual = estruturaFull.porProfundidade[depth] || { keys: 0, nodes: 0, subnodes: 0 };
            
            if (levelConfig.maxKeys && levelAtual.keys > levelConfig.maxKeys)
                throw new Error(msgErro('keys', levelConfig.maxKeys, depth));
            if (levelConfig.maxNodes && levelAtual.nodes > levelConfig.maxNodes)
                throw new Error(msgErro('nodes', levelConfig.maxNodes, depth));
            if (levelConfig.maxSubnodes && levelAtual.subnodes > levelConfig.maxSubnodes)
                throw new Error(msgErro('subnodes', levelConfig.maxSubnodes, depth));
        });

        return true;
    }

    async verificarLimite(arquivo, dadosNovos) {
        // Old flat limits first
        const limites = await this.lerLimites();
        const nomeArquivo = this.normalizarNomeArquivo(arquivo);
        
        const configLimite = limites[nomeArquivo];
        if (configLimite) {
            const caminho = path.join(await this.garantirPastaBanco(), nomeArquivo);
            const { dados: dadosAtual } = await this.lerJsonComRetry(caminho);
            
            const estruturaAtual = this.contarEstrutura(dadosAtual);
            const estruturaNovos = this.contarEstrutura(dadosNovos);
            
            const novoTotal = {
                nodes: estruturaAtual.nodes + estruturaNovos.nodes,
                subnodes: estruturaAtual.subnodes + estruturaNovos.subnodes,
                arrays: estruturaAtual.arrays + estruturaNovos.arrays
            };

            const msgErro = (tipo, limite) => {
                const tipos = {
                    nodes: this.idioma === 'pt' ? 'nós' : 'nodes',
                    subnodes: this.idioma === 'pt' ? 'subnós' : 'subnodes', 
                    arrays: this.idioma === 'pt' ? 'arrays' : 'arrays'
                };
                return this.idioma === 'pt' 
                    ? `Limite de ${limite} ${tipos[tipo]} atingido para ${nomeArquivo}`
                    : `Limit of ${limite} ${tipos[tipo]} reached for ${nomeArquivo}`;
            };

            if (configLimite.nodes && novoTotal.nodes > configLimite.nodes) 
                throw new Error(msgErro('nodes', configLimite.nodes));
            if (configLimite.subnodes && novoTotal.subnodes > configLimite.subnodes) 
                throw new Error(msgErro('subnodes', configLimite.subnodes));
            if (configLimite.arrays && novoTotal.arrays > configLimite.arrays) 
                throw new Error(msgErro('arrays', configLimite.arrays));
        }

        // Then advanced per-depth limits if present
        await this.verificarLimiteAvancado(arquivo, dadosNovos);
        
        return true;
    }

    /**
     * PT: Define limites para arquivo em limit.json
     * EN: Sets limits for file in limit.json (null remove limite)
     */
async limite(arquivo, nodeLimit = null, subnodeLimit = null, arrayLimit = null) {
        const caminho = await this.caminhoLimitJson();
        return await this.comLockArquivo(caminho, async () => {
            const limites = await this.lerLimites();
            const nome = this.normalizarNomeArquivo(arquivo);
            
            limites[nome] = {};
            if (nodeLimit !== null) limites[nome].nodes = parseInt(nodeLimit) || 0;
            if (subnodeLimit !== null) limites[nome].subnodes = parseInt(subnodeLimit) || 0;
            if (arrayLimit !== null) limites[nome].arrays = parseInt(arrayLimit) || 0;
            
            // Remove se todos null
            if (Object.keys(limites[nome]).length === 0) delete limites[nome];
            
            await this.salvarLimites(limites);
            this.logInterno(`Limites definidos para ${nome}: ${JSON.stringify(limites[nome] || 'sem limite')}`);
            return limites[nome] || null;
        });
    }

    async setLimit(arquivo, nodeLimit = null, subnodeLimit = null, arrayLimit = null) {
        return this.limite(arquivo, nodeLimit, subnodeLimit, arrayLimit);
    }

    /**
     * PT: Retorna limites e uso atual do arquivo
     * EN: Returns limits and current usage for file
     */
    async getLimite(arquivo) {
        if (this.apiKey) {
            const msg = this.idioma === 'pt' ? 'Limites locais desabilitados no modo remoto' : 'Local limits disabled in remote mode';
            this.logInterno(msg);
            return msg;
        }

        const limites = await this.lerLimites();
        const nome = this.normalizarNomeArquivo(arquivo);
        const config = limites[nome];
        
        if (!config) {
            return this.idioma === 'pt' ? 'Sem limites definidos' : 'No limits set';
        }

        const caminho = path.join(await this.garantirPastaBanco(), nome);
        const { dados } = await this.lerJsonComRetry(caminho);
        const atual = this.contarEstrutura(dados);
        
        return {
            limites: config,
            atual,
            restante: {
                nodes: config.nodes ? Math.max(0, config.nodes - atual.nodes) : null,
                subnodes: config.subnodes ? Math.max(0, config.subnodes - atual.subnodes) : null,
                arrays: config.arrays ? Math.max(0, config.arrays - atual.arrays) : null
            }
        };
    }

    async getLimit(arquivo) {
        return this.getLimite(arquivo);
    }

    /**
     * PT: Define limites avançados por nível de profundidade
     * EN: Sets advanced per-depth limits for file
     * @param {string} arquivo - Nome do arquivo
     * @param {object} limitesPorNivel - e.g. {0: {maxKeys:10, maxNodes:50}, 1: {maxKeys:5}}
     * @returns {object|null} Config saved or null
     */
    async limiteAvancado(arquivo, limitesPorNivel) {
        if (typeof limitesPorNivel !== 'object' || limitesPorNivel === null) {
            throw new TypeError('limitesPorNivel deve ser um objeto');
        }

        const caminho = await this.caminhoAdvancedLimitJson();
        return await this.comLockArquivo(caminho, async () => {
            const limites = await this.lerLimitesAvancados();
            const nome = this.normalizarNomeArquivo(arquivo);
            
            limites[nome] = limitesPorNivel;
            
            await this.salvarLimitesAvancados(limites);
            this.logInterno(`Limites avançados definidos para ${nome}: ${JSON.stringify(limites[nome])}`);
            return limites[nome];
        });
    }

    async advancedLimit(arquivo, limitesPorNivel) {
        return this.limiteAvancado(arquivo, limitesPorNivel);
    }

    /**
     * PT: Retorna limites avançados e uso atual por profundidade
     * EN: Returns advanced limits and current per-depth usage
     * @param {string} arquivo - Nome do arquivo
     * @returns {object} {limites, atual, restante}
     */
    async getLimiteAvancado(arquivo) {
        if (this.apiKey) {
            const msg = this.idioma === 'pt' ? 'Limites locais desabilitados no modo remoto' : 'Local limits disabled in remote mode';
            this.logInterno(msg);
            return msg;
        }

        const limites = await this.lerLimitesAvancados();
        const nome = this.normalizarNomeArquivo(arquivo);
        const config = limites[nome];
        
        if (!config) {
            return this.idioma === 'pt' ? 'Sem limites avançados definidos' : 'No advanced limits set';
        }

        const caminho = path.join(await this.garantirPastaBanco(), nome);
        const { dados } = await this.lerJsonComRetry(caminho);
        const atual = this.contarEstruturaPorProfundidade(dados);
        
        const restante = {};
        Object.keys(config).forEach(depthStr => {
            const depth = parseInt(depthStr);
            const levelConfig = config[depthStr];
            const levelAtual = atual.porProfundidade[depth] || { keys: 0, nodes: 0, subnodes: 0 };
            
            restante[depthStr] = {
                keys: levelConfig.maxKeys ? Math.max(0, levelConfig.maxKeys - levelAtual.keys) : null,
                nodes: levelConfig.maxNodes ? Math.max(0, levelConfig.maxNodes - levelAtual.nodes) : null,
                subnodes: levelConfig.maxSubnodes ? Math.max(0, levelConfig.maxSubnodes - levelAtual.subnodes) : null
            };
        });

        return {
            limites: config,
            atual,
            restante
        };
    }

    async getAdvancedLimit(arquivo) {
        return this.getLimiteAvancado(arquivo);
    }

    /**
     * PT: Gera ID único
     * EN: Generate unique ID
     * chars="auto" ou string chars, length="auto" (12-32) ou number
     */
    criarID(chars = "auto", length = "auto") {
        if (chars === "auto") {
            chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        }
        
        if (length === "auto") {
            length = 12 + Math.floor(Math.random() * 20); // 12-32
        }
        
        let id = '';
        for (let i = 0; i < length; i++) {
            id += chars[Math.floor(Math.random() * chars.length)];
        }
        return `${Date.now()}-${id}`;
    }

    createID(chars = "auto", length = "auto") {
        return this.criarID(chars, length);
    }


    // ==================== ARMAZENAMENTO ====================

    /**
     * Caminho base onde a lib armazena todos os arquivos gerados.
     */
    pastaBanco() {
        if (this.pastaBancoCustomizada) {
            return this.pastaBancoCustomizada;
        }

        return path.join(process.cwd(), 'BANCO Z');
    }

    /**
     * Garante que a pasta "BANCO Z" existe antes de ler/escrever arquivos.
     */
    async garantirPastaBanco() {
        const pasta = this.pastaBanco();
        await fs.mkdir(pasta, { recursive: true });
        return pasta;
    }

    /**
     * Pasta de configurações: BANCO Z/configs/bancoz
     */
    pastaConfigsBanco() {
        return path.join(this.pastaBanco(), 'configs', 'bancoz');
    }

    /**
     * Garante que BANCO Z/configs/bancoz existe.
     */
    async garantirPastaConfigsBanco() {
        const pasta = this.pastaConfigsBanco();
        await fs.mkdir(pasta, { recursive: true });
        return pasta;
    }

    esperar(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async lerJsonComRetry(caminhoArquivo, tentativas = 5) {
        const chaveCache = this.chaveCacheArquivo(caminhoArquivo);
        if (this.cacheAtivo && this.cacheArquivos.has(chaveCache)) {
            const item = this.cacheArquivos.get(chaveCache);
            if (!this.cacheExpirado(item)) {
                return {
                    conteudo: item.conteudo,
                    dados: this.clonarJsonParaCache(item.dados)
                };
            }

            this.cacheArquivos.delete(chaveCache);
        }

        for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
            try {
                const conteudo = await fs.readFile(caminhoArquivo, 'utf8');
                const dados = JSON.parse(conteudo);
                this.definirCacheArquivo(caminhoArquivo, conteudo, dados);
                return { conteudo, dados };
            } catch (erro) {
                if (erro && erro.code === 'ENOENT') {
                    this.definirCacheArquivo(caminhoArquivo, null, {});
                    return { conteudo: null, dados: {} };
                }

                const erroSintaxe =
                    erro instanceof SyntaxError ||
                    (erro && erro.name === 'SyntaxError') ||
                    (erro && typeof erro.message === 'string' && erro.message.includes('JSON'));

                if (!erroSintaxe || tentativa === tentativas) {
                    throw erro;
                }

                // Espera curta e tenta novamente (evita ler JSON no meio de uma escrita de outro processo)
                await this.esperar(10 * tentativa);
            }
        }

        return { conteudo: null, dados: {} };
    }

    async escreverArquivoAtomico(caminhoArquivo, conteudo) {
        const diretorio = path.dirname(caminhoArquivo);
        const base = path.basename(caminhoArquivo);
        const sufixo = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const caminhoTemp = path.join(diretorio, `.${base}.tmp-${sufixo}`);

        await fs.mkdir(diretorio, { recursive: true });
        await fs.writeFile(caminhoTemp, conteudo, 'utf8');

        try {
            await fs.rename(caminhoTemp, caminhoArquivo);
        } catch (erro) {
            // Windows pode falhar ao renomear sobre um arquivo existente
            if (erro && (erro.code === 'EEXIST' || erro.code === 'EPERM')) {
                await fs.unlink(caminhoArquivo).catch(() => {});
                await fs.rename(caminhoTemp, caminhoArquivo);
            } else {
                throw erro;
            }
        } finally {
            await fs.unlink(caminhoTemp).catch(() => {});
        }

        this.definirCacheArquivoPorConteudo(caminhoArquivo, conteudo);
    }

    async comLockArquivo(caminhoArquivo, fn) {
        await fs.mkdir(path.dirname(caminhoArquivo), { recursive: true });

        const caminhoLock = `${caminhoArquivo}.lock`;
        const inicio = Date.now();

        while (true) {
            try {
                const handle = await fs.open(caminhoLock, 'wx');

                try {
                    await handle
                        .writeFile(`${process.pid}\n${new Date().toISOString()}\n`, 'utf8')
                        .catch(() => {});
                    return await fn();
                } finally {
                    await handle.close().catch(() => {});
                    await fs.unlink(caminhoLock).catch(() => {});
                }
            } catch (erro) {
                if (!erro || erro.code !== 'EEXIST') {
                    throw erro;
                }

                const agora = Date.now();
                if (agora - inicio > this.lockTimeoutMs) {
                    throw new Error(
                        `Timeout aguardando lock do arquivo '${path.basename(caminhoArquivo)}'`
                    );
                }

                // Remove lock "abandonado" (processo morreu, etc.)
                try {
                    const stat = await fs.stat(caminhoLock);
                    if (agora - stat.mtimeMs > this.lockStaleMs) {
                        await fs.unlink(caminhoLock).catch(() => {});
                        continue;
                    }
                } catch {
                    // Lock pode ter sumido entre a checagem e o stat
                }

                await this.esperar(25 + Math.floor(Math.random() * 25));
            }
        }
    }

    clonarJson(valor) {
        if (typeof valor === 'undefined') return null;
        return JSON.parse(JSON.stringify(valor));
    }

    clonarJsonParaCache(valor) {
        if (typeof valor === 'undefined') return undefined;
        return JSON.parse(JSON.stringify(valor));
    }

    jsonTemDados(valor) {
        if (valor === null || typeof valor === 'undefined') return false;
        if (Array.isArray(valor)) return valor.length > 0;
        if (typeof valor === 'object') return Object.keys(valor).length > 0;
        return true;
    }

    chaveCacheArquivo(caminhoArquivo) {
        return path.resolve(caminhoArquivo);
    }

    definirCacheArquivo(caminhoArquivo, conteudo, dados) {
        if (!this.cacheAtivo) return;

        const chave = this.chaveCacheArquivo(caminhoArquivo);
        this.cacheArquivos.set(chave, {
            conteudo,
            dados: this.clonarJsonParaCache(dados),
            expiraEm: this.cacheTtlMs === null ? null : Date.now() + this.cacheTtlMs
        });
    }

    cacheExpirado(item) {
        return item.expiraEm !== null && Date.now() >= item.expiraEm;
    }

    definirCacheArquivoPorConteudo(caminhoArquivo, conteudo) {
        if (!this.cacheAtivo) return;

        try {
            this.definirCacheArquivo(caminhoArquivo, conteudo, JSON.parse(conteudo));
        } catch {
            this.cacheArquivos.delete(this.chaveCacheArquivo(caminhoArquivo));
        }
    }

    snapshotCacheArquivo(caminhoArquivo) {
        if (!this.cacheAtivo) return null;

        const chave = this.chaveCacheArquivo(caminhoArquivo);
        if (!this.cacheArquivos.has(chave)) {
            return { existe: false, chave };
        }

        const item = this.cacheArquivos.get(chave);
        return {
            existe: true,
            chave,
            valor: {
                conteudo: item.conteudo,
                dados: this.clonarJsonParaCache(item.dados),
                expiraEm: item.expiraEm
            }
        };
    }

    restaurarSnapshotCacheArquivo(snapshot) {
        if (!snapshot) return;

        if (snapshot.existe) {
            this.cacheArquivos.set(snapshot.chave, snapshot.valor);
        } else {
            this.cacheArquivos.delete(snapshot.chave);
        }
    }

    atualizarCacheArquivoAntesDoDisco(caminhoArquivo, dados) {
        if (!this.cacheAtivo) return;

        this.definirCacheArquivo(
            caminhoArquivo,
            JSON.stringify(dados, null, 2),
            dados
        );
    }

    formatarJsonParaTerminal(valor) {
        return JSON.stringify(valor, null, 2);
    }

    imprimirAtualizacaoNoTerminal({ arquivo, no, antes, depois }) {
        if (!this.logAtivo) return;

        const titulo =
            this.idioma === 'en'
                ? `[BANCO Z] Node updated: ${arquivo}/${no}`
                : `[BANCO Z] Nó atualizado: ${arquivo}/${no}`;
        const labelAntes = this.idioma === 'en' ? 'Before:' : 'Anterior:';
        const labelDepois = this.idioma === 'en' ? 'After:' : 'Atual:';

        console.log(titulo);
        console.log(labelAntes);
        console.log(this.formatarJsonParaTerminal(antes));
        console.log(labelDepois);
        console.log(this.formatarJsonParaTerminal(depois));
    }

    /**
     * Normaliza e valida o nome do arquivo (sempre dentro da pasta base do Bancoz).
     */
    normalizarNomeArquivo(arquivo) {
        if (typeof arquivo !== 'string') {
            throw new TypeError(`Parâmetro 'arquivo' deve ser uma string`);
        }

        const nome = arquivo.trim();
        if (nome.length === 0) {
            throw new Error(`Nome de arquivo inválido`);
        }

        if (path.isAbsolute(nome)) {
            throw new Error(`Nome de arquivo inválido: não use caminho absoluto em '${arquivo}'`);
        }

        const partes = nome.split(/[\\/]/);
        if (partes.some((parte) => parte.length === 0 || parte === '.' || parte === '..')) {
            throw new Error(`Nome de arquivo inválido: '${arquivo}'`);
        }

        const ultimoIndice = partes.length - 1;
        if (!partes[ultimoIndice].endsWith('.json')) {
            partes[ultimoIndice] = `${partes[ultimoIndice]}.json`;
        }

        return path.join(...partes);
    }

    // ==================== CONFIGURAÇÕES ====================

    /**
     * Ativa/desativa a fila de operações
     * @param {boolean} valor - true para ativar, false para desativar
     */
    fila(valor) {
        this.filaAtiva = valor;
        this.logInterno(`Fila de operações ${valor ? 'ativada' : 'desativada'}`);
    }

    /**
     * Ativa/desativa o modo de backup
     * @param {boolean} valor - true para ativar, false para desativar
     */
    bk(valor) {
        this.backupAtivo = valor;
        this.logInterno(`Modo backup ${valor ? 'ativado' : 'desativado'}`);
    }

    /**
     * Ativa/desativa o sistema de log
     * @param {boolean} valor - true para ativar, false para desativar
     */
    log(valor) {
        this.logAtivo = valor;
        const ativoMsg =
            this.idioma === 'pt'
                ? `Sistema de log ${valor ? 'ativado' : 'desativado'}`
                : `Log system ${valor ? 'activated' : 'deactivated'}`;
        console.log(`[BANCO Z LOG] ${ativoMsg}`);
    }

    /**
     * Define o idioma dos logs
     * @param {string} idioma - 'pt' para português, 'en' para inglês
     */
    lang(idioma) {
        this.idioma = idioma === 'en' ? 'en' : 'pt';
        this.logInterno(`Idioma definido para ${this.idioma === 'pt' ? 'português' : 'inglês'}`);
    }

    /**
     * PT: Define chave API para modo remoto (https://bancoz.squareweb.app)
     * EN: Sets API key for remote mode
     * @param {string|null} key - Chave API ou null para local-only
     * @returns {string|null} Chave definida
     */
    api_key(key) {
        this.apiKey = key || null;
        const modo = key ? 'remoto (API bancoz.squareweb.app)' : 'local (BANCO Z)';
        this.logInterno(`Modo ${modo}`);
        return key;
    }

    /**
     * Define a pasta base usada pelo Bancoz no modo local.
     * Se não for chamado, a biblioteca continua usando "BANCO Z" no diretório atual.
     * @param {string|null} caminhoDaPasta - Pasta base personalizada ou null para voltar ao padrão
     * @returns {string} Caminho absoluto da pasta base em uso
     */
    path(caminhoDaPasta = null) {
        if (caminhoDaPasta === null || typeof caminhoDaPasta === 'undefined') {
            this.pastaBancoCustomizada = null;
            this.cacheArquivos.clear();
            const pastaPadrao = this.pastaBanco();
            this.logInterno(`Pasta do Bancoz definida para ${pastaPadrao}`);
            return pastaPadrao;
        }

        if (typeof caminhoDaPasta !== 'string') {
            throw new TypeError(`Parâmetro 'caminhoDaPasta' deve ser uma string`);
        }

        const caminhoLimpo = caminhoDaPasta.trim();
        if (caminhoLimpo.length === 0) {
            throw new Error(`Caminho de pasta inválido`);
        }

        this.pastaBancoCustomizada = path.resolve(caminhoLimpo);
        this.cacheArquivos.clear();
        this.logInterno(`Pasta do Bancoz definida para ${this.pastaBancoCustomizada}`);
        return this.pastaBancoCustomizada;
    }

    /**
     * Ativa/desativa cache em memória por arquivo no modo local.
     * Quando ativo, a primeira leitura carrega o JSON do disco e as próximas usam RAM.
     * Escritas atualizam a RAM antes de sincronizar com o arquivo.
     * @param {boolean} valor - true para ativar, false para desativar
     * @param {number|null} minutos - tempo de vida em minutos; omitido mantém cache sem expiração
     * @returns {boolean} Estado atual do cache
     */
    cache(valor = true, minutos = null) {
        this.cacheAtivo = valor === true;
        const ttlNumerico = typeof minutos === 'number' && Number.isFinite(minutos) && minutos > 0;
        this.cacheTtlMs = this.cacheAtivo && ttlNumerico ? minutos * 60 * 1000 : null;

        if (!this.cacheAtivo) {
            this.cacheArquivos.clear();
        } else if (this.cacheTtlMs !== null) {
            const agora = Date.now();
            for (const item of this.cacheArquivos.values()) {
                item.expiraEm = agora + this.cacheTtlMs;
            }
        } else {
            for (const item of this.cacheArquivos.values()) {
                item.expiraEm = null;
            }
        }

        const tempo = this.cacheTtlMs === null ? 'sem expiração' : `${minutos} minuto(s)`;
        this.logInterno(
            `Cache em memória ${this.cacheAtivo ? `ativado (${tempo})` : 'desativado'}`
        );
        return this.cacheAtivo;
    }

    /**
     * Mostra/retorna o estado atual do cache em memória sem alterar seu conteúdo.
     * @param {boolean} exibirTerminal - true para imprimir no terminal
     * @param {string} modo - "files" lista arquivos; "data" mostra dados por arquivo
     * @returns {object} Snapshot atual do cache; sem terminal retorna apenas arquivos/metadados
     */
    getCache(exibirTerminal = true, modo = 'data') {
        const modoNormalizado = modo === 'files' ? 'files' : 'data';
        const agora = Date.now();
        const pastaBase = this.pastaBanco();

        const arquivos = Array.from(this.cacheArquivos.entries()).map(([caminhoArquivo, item]) => {
            const relativo = path.relative(pastaBase, caminhoArquivo);
            const dentroDaBase =
                relativo &&
                !relativo.startsWith('..') &&
                !path.isAbsolute(relativo);

            const arquivo = dentroDaBase ? relativo : caminhoArquivo;
            const expiraEm = item.expiraEm || null;
            const expirado = expiraEm !== null && agora >= expiraEm;
            const expiraEmSegundos =
                expiraEm === null ? null : Math.max(0, Math.ceil((expiraEm - agora) / 1000));

            return {
                arquivo,
                caminho: caminhoArquivo,
                expiraEm,
                expiraEmSegundos,
                expirado,
                dados: this.clonarJsonParaCache(item.dados)
            };
        });

        const snapshot = {
            ativo: this.cacheAtivo,
            ttlMs: this.cacheTtlMs,
            quantidade: arquivos.length,
            arquivos: arquivos.map(({ arquivo, caminho, expiraEm, expiraEmSegundos, expirado }) => ({
                arquivo,
                caminho,
                expiraEm,
                expiraEmSegundos,
                expirado
            })),
            dados: arquivos.reduce((acc, item) => {
                acc[item.arquivo] = item.dados;
                return acc;
            }, {})
        };

        if (!exibirTerminal) {
            return {
                ativo: snapshot.ativo,
                ttlMs: snapshot.ttlMs,
                quantidade: snapshot.quantidade,
                arquivos: snapshot.arquivos
            };
        }

        console.log('\n[BANCO Z CACHE]');
        console.log(`Status: ${snapshot.ativo ? 'ativo' : 'desativado'}`);
        console.log(`Arquivos em cache: ${snapshot.quantidade}`);

        if (this.cacheTtlMs === null) {
            console.log('Expiração: sem expiração');
        } else {
            console.log(`Expiração padrão: ${this.cacheTtlMs / 60000} minuto(s)`);
        }

        if (snapshot.quantidade === 0) {
            console.log('Cache vazio.\n');
            return snapshot;
        }

        if (modoNormalizado === 'files') {
            console.log('\nArquivos:');
            snapshot.arquivos.forEach((item, indice) => {
                const ttl = item.expiraEm === null
                    ? 'sem expiração'
                    : item.expirado
                        ? 'expirado'
                        : `expira em ${item.expiraEmSegundos}s`;
                console.log(`${indice + 1}. ${item.arquivo} (${ttl})`);
            });
            console.log('');
            return snapshot;
        }

        console.log('\nDados por arquivo:');
        arquivos.forEach((item, indice) => {
            const ttl = item.expiraEm === null
                ? 'sem expiração'
                : item.expirado
                    ? 'expirado'
                    : `expira em ${item.expiraEmSegundos}s`;

            console.log(`\n${indice + 1}. ${item.arquivo} (${ttl})`);
            console.log(this.formatarJsonParaTerminal(item.dados));
        });
        console.log('');

        return snapshot;
    }

    // ==================== OPERAÇÕES PRINCIPAIS ====================

    /**
     * PT: Pesquisa texto nos arquivos JSON da pasta do banco e retorna somente os caminhos encontrados.
     * EN: Searches text inside database JSON files and returns only the matched paths.
     * @param {string} termo - Palavra-chave ou frase para pesquisar
     * @param {string} alvo - "*" para todos os arquivos ou caminho de um arquivo dentro do banco
     * @returns {Promise<object>} Objeto { "arquivo.json": ["caminho.no.valor"] }
     */
    async pesquisar(termo, alvo = '*') {
        if (this.apiKey) {
            const msg = this.idioma === 'pt'
                ? 'Pesquisa local desabilitada no modo remoto'
                : 'Local search disabled in remote mode';
            this.logInterno(msg);
            return {};
        }

        if (typeof termo !== 'string') {
            throw new TypeError(
                this.idioma === 'pt'
                    ? `Parametro 'termo' deve ser uma string`
                    : `'termo' parameter must be a string`
            );
        }

        const termoLimpo = termo.trim();
        if (termoLimpo.length === 0) {
            throw new Error(
                this.idioma === 'pt'
                    ? 'Termo de pesquisa invalido'
                    : 'Invalid search term'
            );
        }

        if (typeof alvo !== 'string') {
            throw new TypeError(
                this.idioma === 'pt'
                    ? `Parametro 'alvo' deve ser uma string`
                    : `'alvo' parameter must be a string`
            );
        }

        const pasta = await this.garantirPastaBanco();
        const formatarCaminhoRelativo = (caminho) => caminho.split(path.sep).join('/');
        const normalizarTextoBusca = (valor) =>
            String(valor)
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();
        const termoBusca = normalizarTextoBusca(termoLimpo);

        const listarJsonRecursivo = async (diretorio, prefixo = '') => {
            const entradas = await fs.readdir(diretorio, { withFileTypes: true });
            const arquivos = [];

            for (const entrada of entradas) {
                if (entrada.name === 'configs' && prefixo === '') continue;

                const relativo = prefixo ? path.join(prefixo, entrada.name) : entrada.name;
                const caminhoEntrada = path.join(diretorio, entrada.name);

                if (entrada.isDirectory()) {
                    arquivos.push(...await listarJsonRecursivo(caminhoEntrada, relativo));
                    continue;
                }

                if (entrada.isFile() && entrada.name.toLowerCase().endsWith('.json')) {
                    arquivos.push(relativo);
                }
            }

            return arquivos;
        };

        const alvoLimpo = alvo.trim();
        const arquivos = alvoLimpo === '*'
            ? await listarJsonRecursivo(pasta)
            : [this.normalizarNomeArquivo(alvoLimpo)];

        const chavePath = (parte) => {
            if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(parte)) return parte;
            return JSON.stringify(parte);
        };

        const juntarPath = (base, parte) => {
            if (typeof parte === 'number') return `${base}[${parte}]`;
            const chave = chavePath(parte);
            return base === '$' ? `$.${chave}` : `${base}.${chave}`;
        };

        const valorCombina = (valor) =>
            normalizarTextoBusca(valor).includes(termoBusca);

        const pesquisarValor = (valor, caminhoAtual, encontrados) => {
            if (valor === null || typeof valor !== 'object') {
                if (valorCombina(valor)) encontrados.add(caminhoAtual);
                return;
            }

            if (Array.isArray(valor)) {
                valor.forEach((item, indice) => {
                    pesquisarValor(item, juntarPath(caminhoAtual, indice), encontrados);
                });
                return;
            }

            Object.entries(valor).forEach(([chave, item]) => {
                const caminhoChave = juntarPath(caminhoAtual, chave);
                if (valorCombina(chave)) encontrados.add(caminhoChave);
                pesquisarValor(item, caminhoChave, encontrados);
            });
        };

        const resultado = {};

        for (const arquivo of arquivos.sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
            const caminhoArquivo = path.join(pasta, arquivo);
            const relativo = path.relative(pasta, caminhoArquivo);
            const dentroDaBase =
                relativo &&
                !relativo.startsWith('..') &&
                !path.isAbsolute(relativo);

            if (!dentroDaBase) {
                throw new Error(
                    this.idioma === 'pt'
                        ? `Arquivo fora da pasta do banco: ${arquivo}`
                        : `File outside database folder: ${arquivo}`
                );
            }

            const { dados } = await this.lerJsonComRetry(caminhoArquivo);
            const encontrados = new Set();
            pesquisarValor(dados, '$', encontrados);

            if (encontrados.size > 0) {
                resultado[formatarCaminhoRelativo(relativo)] = Array.from(encontrados);
            }
        }

        return resultado;
    }

    /**
     * Cria dados no JSON
     * @param {string} arquivo - Nome do arquivo JSON
     * @param {string} no - Nome do nó/identificador
     * @param {any} dados - Dados a serem salvos
     */
    async criar(arquivo, no, dados) {
        return this.executarOperacao('criar', arquivo, no, dados);
    }

    /**
     * Atualiza dados no JSON
     * @param {string} arquivo - Nome do arquivo JSON
     * @param {string} no - Nome do nó/identificador
     * @param {any} dados - Dados a serem atualizados
     * @param {string|null} chave - Chave específica para atualizar (opcional)
     */
    async atualizar(arquivo, no, dados, chave = null) {
        return this.executarOperacao('atualizar', arquivo, no, dados, chave);
    }

    /**
     * Deleta dados do JSON
     * @param {string} arquivo - Nome do arquivo JSON
     * @param {string} no - Nome do nó/identificador
     * @param {string|string[]|object|null} chaves - Chave(s) específicas para deletar (opcional)
     */
    async deletar(arquivo, no, chaves = null) {
        return this.executarOperacao('deletar', arquivo, no, chaves);
    }

    /**
     * Lê dados do JSON
     * @param {string} arquivo - Nome do arquivo JSON
     * @param {string|null} [no] - Nome do nó/identificador (opcional)
     */
    async ler(arquivo, no = null) {
        return this.executarOperacao('ler', arquivo, no);
    }

    // ==================== ALIAS EM INGLÊS ====================

    async create(arquivo, no, dados) {
        return this.criar(arquivo, no, dados);
    }

    async update(arquivo, no, dados, chave = null) {
        return this.atualizar(arquivo, no, dados, chave);
    }

    async delete(arquivo, no, chaves = null) {
        return this.deletar(arquivo, no, chaves);
    }

    async read(arquivo, no = null) {
        return this.ler(arquivo, no);
    }

    async search(termo, alvo = '*') {
        return this.pesquisar(termo, alvo);
    }

    async queue(valor) {
        return this.fila(valor);
    }

    async backup(valor) {
        return this.bk(valor);
    }

    async logAtivo(valor) {
        return this.log(valor);
    }

    async language(idioma) {
        return this.lang(idioma);
    }

    /**
     * MODO REMOTO: Proxy CRUD para API https://bancoz.squareweb.app
     * Traduz operações locais para endpoints POST da API v1.
     * CORRIGIDO: substituído filename por filenameBase.
     */
    async processarOperacaoRemota({ tipo, arquivo, no, dados, chave }) {
        const BASE_URL = 'https://bancoz.squareweb.app';

        let endpoint, body;
        const filenameBase = this.normalizarNomeArquivo(arquivo).replace('.json', '');

        switch (tipo) {
            case 'criar':
            case 'create':
                endpoint = '/criar-arquivo';
                if (no === null || typeof no === 'undefined') {
                    const leituraExistente = await fetch(`${BASE_URL}/ler-arquivo`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ api_key: this.apiKey, filename: filenameBase })
                    });

                    if (leituraExistente.ok) {
                        const dataExistente = await leituraExistente.json();
                        const conteudoExistente = dataExistente.content ?? dataExistente;
                        if (this.jsonTemDados(conteudoExistente)) {
                            throw new Error(
                                `Arquivo ${filenameBase} já possui dados. Use atualizar() para alterar.`
                            );
                        }
                    }
                }

                body = {
                    api_key: this.apiKey,
                    filename: filenameBase,
                    content: no === null || typeof no === 'undefined' ? dados : { [no]: dados }
                };
                break;

            case 'atualizar':
            case 'update':
                endpoint = '/atualizar-arquivo';
                body = { api_key: this.apiKey, filename: filenameBase, content: { [no]: dados } };
                break;

            case 'deletar':
            case 'delete':
                endpoint = '/excluir-arquivo';
                body = { api_key: this.apiKey, filename: filenameBase };
                break;

            case 'ler':
            case 'read':
                endpoint = '/ler-arquivo';
                // Corrigido: envia sempre o nome do arquivo normalizado
                body = { api_key: this.apiKey, filename: filenameBase };
                break;

            default:
                throw new Error(`Tipo ${tipo} não suportado no modo remoto`);
        }

        this.logInterno(`API ${endpoint} → ${filenameBase}`);

        const res = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`API ${endpoint} ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const resultado = data.content ?? (tipo === 'deletar' ? true : data);

        this.logInterno(`${tipo} remoto OK: ${filenameBase}`);
        return resultado;
    }

    /**
     * Analisa os arquivos JSON da pasta "BANCO Z", mede leitura e opcionalmente
     * desenha gráficos simples de performance no terminal.
     * @param {boolean} exibirTerminal - true para imprimir gráficos e resumo no terminal
     * @returns {Promise<object>}
     */
    async analise(exibirTerminal = false) {
        const pasta = await this.garantirPastaBanco();

        const listarJsonRecursivo = async (diretorio, prefixo = '') => {
            const entradas = await fs.readdir(diretorio, { withFileTypes: true });
            const arquivos = [];

            for (const entrada of entradas) {
                if (entrada.name === 'configs' && prefixo === '') continue;

                const relativo = prefixo ? path.join(prefixo, entrada.name) : entrada.name;
                const caminhoEntrada = path.join(diretorio, entrada.name);

                if (entrada.isDirectory()) {
                    arquivos.push(...await listarJsonRecursivo(caminhoEntrada, relativo));
                    continue;
                }

                if (entrada.isFile() && entrada.name.toLowerCase().endsWith('.json')) {
                    arquivos.push(relativo);
                }
            }

            return arquivos;
        };

        const arquivosJson = (await listarJsonRecursivo(pasta))
            .sort((a, b) => a.localeCompare(b, 'pt-BR'));

        const formatarBytes = (bytes) => {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        };

        const desenharBarra = (valor, maximo, largura = 28, caractere = '█') => {
            if (maximo <= 0) return ''.padEnd(largura, ' ');
            const preenchido = Math.max(1, Math.round((valor / maximo) * largura));
            return caractere.repeat(Math.min(preenchido, largura)).padEnd(largura, ' ');
        };

        const resultados = [];

        for (const nome of arquivosJson) {
            const caminhoArquivo = path.join(pasta, nome);
            const stat = await fs.stat(caminhoArquivo);

            const inicioNs = process.hrtime.bigint();
            const conteudo = await fs.readFile(caminhoArquivo, 'utf8');
            const fimNs = process.hrtime.bigint();

            const duracaoMs = Number(fimNs - inicioNs) / 1000000;

            let jsonValido = true;
            let quantidadeNos = 0;

            try {
                const json = JSON.parse(conteudo);
                if (json && typeof json === 'object') {
                    quantidadeNos = Array.isArray(json) ? json.length : Object.keys(json).length;
                }
            } catch {
                jsonValido = false;
            }

            const bytesPorSegundo = duracaoMs > 0 ? stat.size / (duracaoMs / 1000) : stat.size;

            resultados.push({
                arquivo: nome,
                tamanhoBytes: stat.size,
                tamanhoFormatado: formatarBytes(stat.size),
                tempoLeituraMs: Number(duracaoMs.toFixed(3)),
                velocidadeBytesPorSegundo: Math.round(bytesPorSegundo),
                velocidadeFormatada: `${formatarBytes(bytesPorSegundo)}/s`,
                jsonValido,
                quantidadeNos,
            });
        }

        const totalBytes = resultados.reduce((acc, item) => acc + item.tamanhoBytes, 0);
        const totalTempoMs = resultados.reduce((acc, item) => acc + item.tempoLeituraMs, 0);
        const mediaTempoMs = resultados.length > 0 ? totalTempoMs / resultados.length : 0;
        const maiorTamanho = resultados.reduce((acc, item) => Math.max(acc, item.tamanhoBytes), 0);
        const maiorTempo = resultados.reduce((acc, item) => Math.max(acc, item.tempoLeituraMs), 0);

        const resumo = {
            pasta,
            quantidadeArquivos: resultados.length,
            tamanhoTotalBytes: totalBytes,
            tamanhoTotalFormatado: formatarBytes(totalBytes),
            tempoTotalLeituraMs: Number(totalTempoMs.toFixed(3)),
            tempoMedioLeituraMs: Number(mediaTempoMs.toFixed(3)),
            arquivos: resultados,
        };

        if (exibirTerminal) {
            console.log('\n[BANCO Z ANALISE]');
            console.log(`Pasta: ${pasta}`);
            console.log(`Arquivos JSON: ${resumo.quantidadeArquivos}`);
            console.log(`Tamanho total: ${resumo.tamanhoTotalFormatado}`);
            console.log(`Tempo total de leitura: ${resumo.tempoTotalLeituraMs} ms`);
            console.log(`Tempo medio por arquivo: ${resumo.tempoMedioLeituraMs} ms`);

            if (resultados.length === 0) {
                console.log('Nenhum arquivo JSON encontrado em BANCO Z.\n');
                return resumo;
            }

            console.log('\nArquivos e tamanhos:');
            resultados.forEach((item) => {
                const status = item.jsonValido ? 'JSON OK' : 'JSON INVALIDO';
                console.log(
                    `- ${item.arquivo} | ${item.tamanhoFormatado} | ${item.tempoLeituraMs} ms | ${item.velocidadeFormatada} | ${status}`
                );
            });

            console.log('\nGrafico de tamanho dos arquivos:');
            resultados.forEach((item) => {
                console.log(
                    `${item.arquivo.padEnd(24, ' ').slice(0, 24)} ${desenharBarra(
                        item.tamanhoBytes,
                        maiorTamanho,
                        28,
                        '#'
                    )} ${item.tamanhoFormatado}`
                );
            });

            console.log('\nGrafico de tempo de leitura:');
            resultados.forEach((item) => {
                console.log(
                    `${item.arquivo.padEnd(24, ' ').slice(0, 24)} ${desenharBarra(
                        item.tempoLeituraMs || 0.001,
                        maiorTempo || 0.001,
                        28,
                        '='
                    )} ${item.tempoLeituraMs} ms`
                );
            });

            console.log('');
        }

        return resumo;
    }

    /**
     * Exibe uma pergunta no terminal e retorna o conteúdo digitado
     * @param {string} pergunta
     * @returns {Promise<string>}
     */
    prompt(pergunta) {
        const texto = typeof pergunta === 'string' ? pergunta : '';

        return new Promise((resolve) => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            rl.question(texto, (resposta) => {
                rl.close();
                resolve(resposta);
            });
        });
    }

    // ==================== MÉTODOS INTERNOS ====================

    /**
     * Executa operações com controle de fila
     */
    async executarOperacao(tipo, arquivo, no, dados = null, chave = null) {
        const operacao = { tipo, arquivo, no, dados, chave };
        
        if (this.filaAtiva) {
            return new Promise((resolve, reject) => {
                this.filaOperacoes.push({ operacao, resolve, reject });
                this.logInterno(`Operação ${tipo} enfileirada para ${arquivo}/${no}`);
                this.processarFila();
            });
        } else {
            return this.processarOperacao(operacao);
        }
    }

    /**
     * Processa a fila de operações
     */
    async processarFila() {
        if (this.processandoFila || this.filaOperacoes.length === 0) return;
        
        this.processandoFila = true;
        
        while (this.filaOperacoes.length > 0) {
            const { operacao, resolve, reject } = this.filaOperacoes.shift();
            
            try {
                const resultado = await this.processarOperacao(operacao);
                resolve(resultado);
            } catch (erro) {
                reject(erro);
            }
        }
        
        this.processandoFila = false;
    }

    /**
     * Processa uma única operação
     */
    async processarOperacao({ tipo, arquivo, no, dados, chave }) {
        // === MODO HÍBRIDO: API remota se apiKey ativa ===
        if (this.apiKey) {
            this.logInterno(`Operação ${tipo} via API remota (key ativa)`);
            return await this.processarOperacaoRemota({ tipo, arquivo, no, dados, chave });
        }

        // === MODO LOCAL (padrão, 100% compatível) ===
        const pasta = await this.garantirPastaBanco();
        const nomeArquivo = this.normalizarNomeArquivo(arquivo);
        const caminhoArquivo = path.join(pasta, nomeArquivo);
        const caminhoBackup = `${caminhoArquivo}.backup`;

        const operacaoApenasLeitura = tipo === 'ler' || tipo === 'read';

        const executar = async () => {
            this.logInterno(`Iniciando operação: ${tipo} em ${arquivo}/${no}`);
            let backupCriadoNestaOperacao = false;

            try {
                const { conteudo, dados: dadosLidos } = await this.lerJsonComRetry(caminhoArquivo);
                let dadosArquivo = dadosLidos;

                if (
                    ['criar', 'create'].includes(tipo) &&
                    (no === null || typeof no === 'undefined') &&
                    conteudo !== null &&
                    this.jsonTemDados(dadosArquivo)
                ) {
                    throw new Error(`Arquivo ${arquivo} já possui dados. Use atualizar() para alterar.`);
                }

                // Backup deve ser sempre a versão anterior à alteração (conteúdo lido)
                if (!operacaoApenasLeitura && this.backupAtivo && conteudo !== null) {
                    await this.escreverArquivoAtomico(caminhoBackup, conteudo);
                    backupCriadoNestaOperacao = true;
                this.logInterno(`Backup criado: ${path.basename(caminhoBackup)} (local only)`);
                }

                // VERIFICAÇÃO DE LIMITES PARA CRIAR/ATUALIZAR (skip remote)
                if (!this.apiKey && ['criar', 'create', 'atualizar', 'update'].includes(tipo)) {
                    const dadosParaLimite =
                        ['criar', 'create'].includes(tipo) &&
                        (no === null || typeof no === 'undefined')
                            ? dados
                            : { [no]: dados };
                    await this.verificarLimite(arquivo, dadosParaLimite);
                }

                // Executar operação
                let resultado;
                let atualizacaoNoTerminal = null;
                switch (tipo) {
                    case 'criar':
                    case 'create':
                        if (no === null || typeof no === 'undefined') {
                            dadosArquivo = dados;
                        } else {
                            dadosArquivo[no] = dados;
                        }
                        resultado = dados;
                        this.logInterno(
                            no === null || typeof no === 'undefined'
                                ? `Dados criados em ${arquivo}`
                                : `Dados criados em ${arquivo}/${no}`
                        );
                        break;

                    case 'atualizar':
                    case 'update':
                        {
                            const isObjetoSimples = (valor) =>
                                valor !== null && typeof valor === 'object' && !Array.isArray(valor);

                            const mostrarNoTerminal = this.logAtivo;
                            const antesAtualizacao = mostrarNoTerminal
                                ? this.clonarJson(dadosArquivo[no])
                                : null;

                            const chaveEspecifica =
                                typeof chave === 'string' && chave.length > 0 ? chave : null;
                            const opcoes =
                                isObjetoSimples(chave) && chaveEspecifica === null ? chave : null;

                            if (chaveEspecifica) {
                                if (!dadosArquivo[no]) {
                                    dadosArquivo[no] = {};
                                }

                                // Atualizar apenas uma chave específica (modo antigo)
                                dadosArquivo[no][chaveEspecifica] = dados;
                                resultado = dadosArquivo[no];
                                this.logInterno(
                                    `Chave '${chaveEspecifica}' atualizada em ${arquivo}/${no}`
                                );
                                if (mostrarNoTerminal) {
                                    atualizacaoNoTerminal = {
                                        arquivo,
                                        no,
                                        antes: antesAtualizacao,
                                        depois: this.clonarJson(dadosArquivo[no]),
                                    };
                                }
                                break;
                            }

                            if (opcoes && opcoes.substituir === true) {
                                // Substituir todo o nó (mantém compatibilidade com o modo antigo)
                                dadosArquivo[no] = dados;
                                resultado = dados;
                                this.logInterno(`Nó completo atualizado em ${arquivo}/${no}`);
                                if (mostrarNoTerminal) {
                                    atualizacaoNoTerminal = {
                                        arquivo,
                                        no,
                                        antes: antesAtualizacao,
                                        depois: this.clonarJson(dadosArquivo[no]),
                                    };
                                }
                                break;
                            }

                            if (isObjetoSimples(dados)) {
                                // Atualização parcial via objeto: cria as chaves se não existirem
                                if (!dadosArquivo[no]) {
                                    dadosArquivo[no] = {};
                                }
                                if (!isObjetoSimples(dadosArquivo[no])) {
                                    throw new Error(`Nó '${no}' não é um objeto em ${arquivo}`);
                                }

                                const atualizacoes = dados;
                                const chavesAtualizacao = Object.keys(atualizacoes);

                                chavesAtualizacao.forEach((k) => {
                                    dadosArquivo[no][k] = atualizacoes[k];
                                });

                                resultado = dadosArquivo[no];
                                this.logInterno(`Nó '${no}' atualizado em ${arquivo}`);
                                if (mostrarNoTerminal) {
                                    atualizacaoNoTerminal = {
                                        arquivo,
                                        no,
                                        antes: antesAtualizacao,
                                        depois: this.clonarJson(dadosArquivo[no]),
                                    };
                                }
                                break;
                            }

                            // Substituir todo o nó (modo antigo)
                            dadosArquivo[no] = dados;
                            resultado = dados;
                            this.logInterno(`Nó completo atualizado em ${arquivo}/${no}`);
                            if (mostrarNoTerminal) {
                                atualizacaoNoTerminal = {
                                    arquivo,
                                    no,
                                    antes: antesAtualizacao,
                                    depois: this.clonarJson(dadosArquivo[no]),
                                };
                            }
                        }
                        break;

                    case 'deletar':
                    case 'delete':
                        {
                            const isObjetoSimples = (valor) =>
                                valor !== null && typeof valor === 'object' && !Array.isArray(valor);
                            const temChave = (obj, key) =>
                                Object.prototype.hasOwnProperty.call(obj, key);

                            const deletarChaves = dados;
                            const deletarNoInteiro =
                                deletarChaves === null || typeof deletarChaves === 'undefined';

                            if (deletarNoInteiro) {
                                // Deletar o nó inteiro (modo antigo)
                                if (dadosArquivo[no]) {
                                    delete dadosArquivo[no];
                                    resultado = true;
                                    this.logInterno(`Nó '${no}' deletado de ${arquivo}`);
                                } else {
                                    resultado = false;
                                    this.logInterno(`Nó '${no}' não encontrado em ${arquivo}`);
                                }
                                break;
                            }

                            if (!dadosArquivo[no]) {
                                resultado = false;
                                this.logInterno(`Nó '${no}' não encontrado em ${arquivo}`);
                                break;
                            }

                            if (!isObjetoSimples(dadosArquivo[no])) {
                                throw new Error(`Nó '${no}' não é um objeto em ${arquivo}`);
                            }

                            let chavesParaDeletar = [];
                            if (typeof deletarChaves === 'string') {
                                chavesParaDeletar = [deletarChaves];
                            } else if (Array.isArray(deletarChaves)) {
                                chavesParaDeletar = deletarChaves;
                            } else if (isObjetoSimples(deletarChaves)) {
                                chavesParaDeletar = Object.keys(deletarChaves);
                            } else {
                                throw new Error(
                                    `Parâmetro de chaves inválido para deletar em ${arquivo}/${no}`
                                );
                            }

                            const chavesInexistentes = chavesParaDeletar.filter(
                                (k) => !temChave(dadosArquivo[no], k)
                            );

                            if (chavesInexistentes.length > 0) {
                                throw new Error(
                                    `Chave(s) inexistente(s) no nó '${no}': ${chavesInexistentes.join(
                                        ', '
                                    )}`
                                );
                            }

                            chavesParaDeletar.forEach((k) => {
                                delete dadosArquivo[no][k];
                            });

                            resultado = dadosArquivo[no];
                            this.logInterno(`Chave(s) deletada(s) de ${arquivo}/${no}`);
                        }
                        break;

                    case 'ler':
                    case 'read':
                        if (no === null || no === undefined) {
                            resultado = dadosArquivo;
                            this.logInterno(`Leitura completa de ${arquivo}`);
                        } else {
                            resultado = dadosArquivo[no] || null;
                            this.logInterno(
                                `Leitura de ${arquivo}/${no} ${
                                    resultado ? 'bem-sucedida' : 'não encontrado'
                                }`
                            );
                        }
                        return resultado;
                }

                // Atualiza RAM primeiro e depois sincroniza no disco de forma atômica.
                const snapshotCacheAntesDaEscrita = this.snapshotCacheArquivo(caminhoArquivo);
                const conteudoAtualizado = JSON.stringify(dadosArquivo, null, 2);
                this.atualizarCacheArquivoAntesDoDisco(caminhoArquivo, dadosArquivo);

                try {
                    await this.escreverArquivoAtomico(caminhoArquivo, conteudoAtualizado);
                } catch (erroEscrita) {
                    this.restaurarSnapshotCacheArquivo(snapshotCacheAntesDaEscrita);
                    throw erroEscrita;
                }
                this.logInterno(`Arquivo ${arquivo} salvo com sucesso`);
                if (atualizacaoNoTerminal) {
                    this.imprimirAtualizacaoNoTerminal(atualizacaoNoTerminal);
                }

                return resultado;
            } catch (erro) {
                this.logInterno(`ERRO: ${erro.message}`);

                // Tentar restaurar do backup
                if (
                    !operacaoApenasLeitura &&
                    this.backupAtivo &&
                    backupCriadoNestaOperacao &&
                    existsSync(caminhoBackup)
                ) {
                    try {
                        const conteudoBackup = await fs.readFile(caminhoBackup, 'utf8');
                        await this.escreverArquivoAtomico(caminhoArquivo, conteudoBackup);
                        this.logInterno(`Backup restaurado após erro`);
                    } catch (erroBackup) {
                        this.logInterno(
                            `ERRO CRÍTICO: Falha ao restaurar backup - ${erroBackup.message}`
                        );
                    }
                }

                throw erro;
            }
        };

        if (operacaoApenasLeitura) {
            return executar();
        }

        return this.comLockArquivo(caminhoArquivo, executar);
    }

    /**
     * Função de log interno
     */
    logInterno(mensagem) {
        if (!this.logAtivo) return;
        
        let msgTraduzida = mensagem;
        
        // Traduções básicas para logs
        if (this.idioma === 'en') {
            const traducoes = {
                'Fila de operações': 'Operation queue',
                'ativada': 'activated',
                'desativada': 'deactivated',
                'Modo backup': 'Backup mode',
                'Sistema de log': 'Log system',
                'Idioma definido para': 'Language set to',
                'português': 'portuguese',
                'inglês': 'english',
                'Operação': 'Operation',
                'enfileirada para': 'queued for',
                'Iniciando operação': 'Starting operation',
                'Backup criado': 'Backup created',
                'Dados criados em': 'Data created in',
                'Chave': 'Key',
                'atualizada em': 'updated in',
                'Nó completo atualizado em': 'Complete node updated in',
                'Nó deletado de': 'Node deleted from',
                'Nó não encontrado em': 'Node not found in',
                'Leitura de': 'Reading from',
                'bem-sucedida': 'successful',
                'não encontrado': 'not found',
                'Arquivo salvo com sucesso': 'File saved successfully',
                'Backup removido após operação bem-sucedida': 'Backup removed after successful operation',
                'ERRO': 'ERROR',
                'Backup restaurado após erro': 'Backup restored after error',
                'ERRO CRÍTICO': 'CRITICAL ERROR'
            };
            
            // Traduzir palavras conhecidas
            Object.keys(traducoes).forEach((pt) => {
                if (msgTraduzida.includes(pt)) {
                    msgTraduzida = msgTraduzida.replace(new RegExp(pt, 'g'), traducoes[pt]);
                }
            });
        }

        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [BANCO Z LOG] ${msgTraduzida}`);
    }
}

// Exportar instância única
const bancoz = new Bancoz();
export default bancoz;
