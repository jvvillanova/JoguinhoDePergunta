# Palco do Saber

O Palco do Saber é um jogo de perguntas e respostas inspirado em programas de conhecimento e competição. A proposta é colocar o jogador diante de uma sequência de perguntas, com alternativas, ajudas e uma escada de premiação fictícia.

A experiência reúne apresentação de perguntas, trilha sonora, efeitos, suspense nas revelações, estatísticas e diferentes formas de jogar.

## O que o jogo oferece

- Modo Clássico, com 17 níveis e pontos de segurança.
- Modo Infinito.
- Modo Rápido.
- Modo Sobrevivência, com vidas.
- Modo por Categorias.
- Modo Treinamento, em que errar não encerra a partida.
- Desafio Diário, com perguntas iguais para todos naquele dia e uma tentativa.
- Ajudas durante as partidas.
- Histórico, estatísticas e ranking.
- Painel administrativo para gerenciar configurações e perguntas.
- Apresentador com legendas e narração, quando o navegador ou dispositivo oferece suporte.
- Trilha sonora e efeitos sonoros produzidos pelo próprio jogo.

O nome, a identidade visual, o cenário, as músicas e as vozes utilizados no projeto são originais. O jogo não utiliza marcas, gravações ou a voz de Silvio Santos.

## Tecnologias

- Next.js 16
- React 19
- TypeScript
- PostgreSQL
- Drizzle ORM
- Web Audio API
- Web Speech API

## Como executar localmente

### Requisitos

- Node.js
- npm
- PostgreSQL

### Instalação

Clone o repositório e entre na pasta do projeto:

```bash
git clone <URL_DO_REPOSITORIO>
cd <PASTA_DO_PROJETO>
npm install
```

Crie um arquivo `.env` na raiz e configure a conexão com o PostgreSQL:

```env
DATABASE_URL=postgresql://usuario:senha@localhost:5432/palco_do_saber
```

Aplique o esquema do banco:

```bash
npx drizzle-kit push
```

Inicie o ambiente de desenvolvimento:

```bash
npm run dev
```

A aplicação ficará disponível, por padrão, em `http://localhost:3000`.

Para executar em produção localmente:

```bash
npm run build
npm run start
```

O banco de perguntas inicial é carregado automaticamente na primeira consulta, caso ainda não tenha sido inicializado.

## Banco de perguntas

A versão atual conta com **219 perguntas ativas**, distribuídas em 30 categorias e 6 níveis de dificuldade.

Cada pergunta possui alternativas, resposta, justificativa e fonte. A base passa por verificações automáticas de estrutura, duplicidade e consistência.

A meta de 5.000 perguntas ainda não foi alcançada. A ampliação do banco pode ser feita por novos blocos de perguntas ou pela importação de conteúdo pelo painel, com validação antes de entrar no jogo.

## Modos de jogo

### Clássico
São 17 níveis, com pontos de segurança e uma escada de premiação fictícia.

### Infinito
Continue respondendo enquanto conseguir avançar.

### Rápido
Uma experiência mais curta, voltada para partidas rápidas.

### Sobrevivência
O jogador tem um número limitado de vidas.

### Categorias
Partidas focadas em temas específicos.

### Treinamento
Permite aprender e continuar mesmo após uma resposta errada.

### Desafio Diário
Uma partida diária com perguntas definidas para aquele dia. Cada jogador tem uma tentativa.

## Ajudas

- **Cartas:** indicação com diferentes níveis de intensidade.
- **Eliminar 2:** remove duas alternativas incorretas.
- **Plateia:** apresenta uma votação simulada, identificada como fictícia.
- **Apresentador:** oferece uma dica da pergunta, quando disponível, ou uma dica genérica.

As ajudas possuem limites configuráveis e podem ser utilizadas uma vez por pergunta.

## Áudio e apresentação

A trilha sonora é criada proceduralmente pelo jogo, e os efeitos sonoros são sintetizados. Música, voz e efeitos possuem controles de volume separados.

A narração utiliza as vozes disponíveis no navegador ou no dispositivo. Quando não há uma voz compatível, o jogo continua com as legendas. Também é possível jogar no modo silencioso.

As falas do apresentador podem ser ajustadas pelo painel administrativo.

## Conta e administração

O jogo possui cadastro, autenticação e perfis de jogador e administrador. Não existe uma conta administrativa padrão incluída no código.

Para criar um administrador:

1. Cadastre uma conta normalmente pela tela inicial.
2. Acesse o banco PostgreSQL.
3. Altere o perfil da conta desejada:

```sql
UPDATE users
SET role = 'admin'
WHERE username = 'seu_usuario';
```

Substitua `seu_usuario` pelo nome cadastrado.

## Configurações

As configurações gerais do jogo são armazenadas no banco de dados e podem ser ajustadas pelo painel administrativo, incluindo regras de premiação, limites de ajudas, falas e opções de partida.

## Testes

O projeto passou pelas seguintes verificações durante o desenvolvimento:

| Verificação | Resultado |
|---|---|
| Geração de tipos do Next.js | Aprovada |
| TypeScript | Aprovado |
| Testes do motor de jogo | 30 testes aprovados |
| Build de produção | Aprovado |
| Inicialização com banco e endpoint de saúde | Aprovada |
| Fluxo HTTP de cadastro e partida | Aprovado |

Os testes cobrem regras de premiação, estados da partida, seleção e confirmação de alternativas, revelação de respostas, desistência, ajudas, modos de jogo, desafio diário e validação do banco de perguntas.

Ainda há etapas que precisam de testes em navegadores e dispositivos reais, especialmente áudio, narração, interface móvel e comportamento sob carga.

## Limitações atuais

- O banco possui 219 perguntas; a meta de 5.000 ainda está em andamento.
- As perguntas ainda precisam de revisão humana independente, com consulta às fontes originais.
- O modo multiplayer não está implementado.
- A opção de reiniciar o progresso mediante confirmação ainda não está implementada.
- Não existe uma tela dedicada para gerenciamento de categorias.
- O cronômetro utiliza o relógio do cliente, com validação do prazo no servidor ao confirmar.
- A criação de administradores é feita manualmente no banco.
- A versão atual não possui instalação como PWA.
- A narração depende das vozes disponíveis no dispositivo.
- Limites de requisições e testes automatizados de interface ainda não foram implementados.

## Licença

Este projeto é de uso próprio. Os elementos originais desenvolvidos para o Palco do Saber não devem ser reproduzidos ou distribuídos sem autorização.
