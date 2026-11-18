# Palco do Saber — game show de conhecimentos

Aplicativo web de perguntas e respostas com experiência de programa de auditório: apresentador virtual com legendas, trilha sonora procedural, efeitos sintetizados, suspense antes da revelação, ajudas, escada de premiação (fictícia), modos de jogo, estatísticas, ranking e painel administrativo.

Nome, marca, cenário, músicas e vozes são originais. O projeto não usa marcas, gravações, nem a voz de Silvio Santos.

## Arquitetura

| Camada | Onde fica | Responsabilidade |
|---|---|---|
| Interface | `src/app/page.tsx`, `src/app/jogar`, `src/app/admin`, `src/components/game/GameShow.tsx` | Renderiza o estado recebido do servidor; não decide regras |
| Motor de jogo (puro) | `src/lib/game/engine.ts` | Máquina de estados, premiação, pontos de segurança, ajudas, seleção de perguntas |
| Orquestração | `src/lib/game/service.ts` | Transações com `SELECT ... FOR UPDATE`, controle de versão, registro de respostas |
| Banco de perguntas | `src/lib/bank/*`, `src/data/bank/*`, tabela `questions` | Importação validada, deduplicação, semeadura automática |
| Qualidade | `src/lib/bank/quality.ts` | Regras de validação (alternativas, resposta única, justificativa, fonte, ambiguidade) |
| Configuração | `src/lib/config.ts`, tabela `settings` | Premiação, segurança, limites de ajuda, falas, tempo, modos |
| Autenticação | `src/lib/auth.ts`, tabelas `users`/`sessions` | Scrypt, sessão em cookie httpOnly, papéis `player`/`admin` |
| Estatísticas | `src/lib/stats.ts` | Desempenho, categorias, evolução, histórico, ranking |
| IA (opcional) | `src/lib/ai.ts` | Geração e revisão com API compatível com OpenAI; saída sempre validada |
| Áudio | `src/lib/audio/studio.ts` | Música procedural, efeitos, barramentos e narração (Web Speech API) |

Regras essenciais (acerto, erro, desistência, ajudas, limites) são aplicadas no servidor. O cliente nunca recebe a alternativa correta antes da revelação (verificado no teste de fluxo).

### Máquina de estados

`awaiting_choice` → (select/troca) → `locked` (confirmação, irreversível) → `revealed` (revelação idempotente, registra resposta uma única vez) → `awaiting_choice` (próxima pergunta, apenas após revelação) ou `finished` (vitória, derrota, desistência).

Proteções: versão otimista por partida (`version`), bloqueio de linha em transação, trava síncrona no cliente contra cliques repetidos, recuperação da partida ao atualizar a página (a fase `locked` é revelada novamente de forma idempotente).

## Instalação e execução

1. Configure `DATABASE_URL` no `.env` (PostgreSQL local).
2. Aplique o esquema: `npx drizzle-kit push`.
3. Desenvolvimento: `npm run dev`. Produção: `npm run build && npm run start`.
4. O banco oficial é semeado automaticamente na primeira consulta (`ensureBankSeeded`).

### Criar um administrador

Não há conta padrão com senha no código. Cadastre-se pela tela inicial e promova a conta:

```sql
UPDATE users SET role = 'admin' WHERE username = 'seu_usuario';
```

### Variáveis de ambiente opcionais

| Variável | Uso |
|---|---|
| `AI_API_KEY` ou `OPENAI_API_KEY` | Habilita geração/revisão por IA (sem chave, o recurso fica desativado) |
| `AI_BASE_URL` | Endpoint compatível com Chat Completions (padrão: OpenAI) |
| `AI_MODEL` | Modelo (padrão: `gpt-4o-mini`) |
| `COOKIE_SECURE` | `false` apenas para testes em HTTP local |

## Banco de perguntas

- **Quantidade atual validada automaticamente: 219 perguntas ativas** (blocos em `src/data/bank/bloco-01..05.ts`), com 30 categorias de conteúdo, 6 níveis de dificuldade, justificativa e fonte em cada item.
- **Meta de 5.000 perguntas NÃO foi atingida.** A base atual foi redigida pela equipe a partir de conhecimento geral consolidado e passou pelas validações automáticas (formato, resposta única, duplicidade, justificativa, fonte). **Não houve revisão humana independente por fontes primárias.** Essa etapa é necessária antes de qualquer declaração de precisão.
- Expansão: criar novos blocos e registrá-los em `src/data/bank/index.ts`, importar texto pelo painel (com validação prévia), ou gerar com IA (entram inativas e aguardam aprovação humana).
- Direitos: não houve acesso ao acervo do Show do Milhão nem a qualquer base de terceiros. Não há extração de bancos protegidos. A licença de cada item é "Original do projeto".

## Modos de jogo

Clássico (17 níveis, pontos de segurança), Infinito, Rápido, Sobrevivência (vidas), Categorias, Treinamento (erro não encerra) e Desafio diário (mesmas perguntas no dia, uma tentativa por dia, determinístico).

**Multiplayer não foi implementado.** A arquitetura de partidas versionadas e com ações atômicas serve de base, mas faltam salas, sincronização em tempo real e controle de tempo compartilhado.

## Ajudas

- Cartas: quatro cartas; a indicação tem intensidade variável (forte, média ou fraca).
- Eliminar 2: remove duas alternativas erradas, mantendo a correta.
- Plateia: votação **simulada**, sempre rotulada como não sendo pesquisa real.
- Apresentador: dica da pergunta (campo `hint`) ou dica genérica; nunca revela a alternativa.

Limites por partida configuráveis; cada ajuda uma vez por pergunta.

## Áudio e narração

- Trilha procedural (Web Audio API) cuja intensidade e andamento crescem com o nível. Nenhuma faixa comercial ou de terceiros.
- Efeitos sintetizados: abertura, seleção, travamento, suspense, acerto, erro, premiação, ajuda, vitória e derrota.
- Barramentos separados (música, voz, efeitos) com volumes individuais; a música é reduzida durante a narração.
- Narração pela Web Speech API usando as vozes do próprio sistema/navegador (pt-BR quando disponível). **Sem voz disponível, o jogo segue com legendas.** Modo silencioso e legendas independentes da narração.
- Falas configuráveis no painel, incluindo a frase especial "Valendo um milhão de taliaruras duras!" (editável).

## Testes executados

| Verificação | Resultado |
|---|---|
| `npx next typegen` | Aprovado |
| `tsc --noEmit` | Aprovado, sem erros |
| `node --env-file=.env --import tsx --test tests/engine.test.ts` | **30/30 aprovados** |
| `npm run build` | Aprovado |
| `build_and_start` (banco, build, start, `/api/health`) | Aprovado |
| Teste de fluxo real via HTTP (produção local) | Cadastro, banco semeado com 219 perguntas, partida iniciada, sem vazamento da resposta correta no estado, troca de alternativa antes de confirmar, bloqueio após confirmação, **5 revelações simultâneas: 1 processada (200) e 4 rejeitadas (409), 1 registro em `answer_log`**, versão obsoleta rejeitada (409), desistência, encerramento e acesso administrativo |

Cobertura dos testes unitários: premiação e segurança, máquina de estados, troca e bloqueio de alternativa, revelação idempotente, desistência, ajudas (50/50, plateia simulada, cartas, limites, uma vez por pergunta), vitória, treinamento, sobrevivência, rápido, tempo esgotado, visão pública sem resposta, seleção sem repetição, desafio diário determinístico, validação de qualidade e integridade de todas as perguntas do banco.

**Problema encontrado e corrigido:** a tentativa de alterar uma resposta já confirmada retornava HTTP 500. Foi mapeada para 409 (`GameRuleError`). A correção passou por tipagem, testes e build e a aplicação foi reiniciada, mas **essa requisição específica não foi repetida no fluxo HTTP após a correção**.

**Não testado:** interface em navegador real (inclusive dispositivos móveis), narração e áudio em navegadores diferentes, geração por IA (nenhuma chave configurada), limites de carga.

## Limitações conhecidas e pendências

- Banco com 219 de 5.000 perguntas; revisão humana por fontes primárias pendente.
- Multiplayer não implementado.
- "Reiniciar progresso mediante confirmação" não implementado.
- Gestão de categorias é feita pela digitação de uma nova categoria na pergunta (sem tela dedicada).
- Explicação por IA para o modo aprendizagem não implementada; o jogo mostra a justificativa e a fonte curadas.
- Cronômetro usa o relógio do cliente; o servidor valida o prazo somente ao confirmar.
- Criação de administradores é manual (SQL), por decisão de segurança.
- Sem PWA instalável nesta versão.
- Narração depende das vozes instaladas no dispositivo.
- Estado de partida e sessão não têm limitação de taxa (rate limiting) implementada.
- Testes de interface automatizados (ex.: Playwright) não foram incluídos.
