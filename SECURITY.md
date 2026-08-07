# Segurança — mcp-tudu

Este documento descreve o modelo de ameaças, os controles, os resultados do
teste de invasão e os limites conhecidos do servidor MCP do TuDu. Serve tanto
para revisão interna quanto para auditoria de terceiros.

## Arquitetura e superfície

```
Assistente de IA (Claude Desktop / Claude Code / Gemini CLI)
        │  MCP sobre stdio (processo local)
        ▼
   mcp-tudu (este repo)  ──HTTP 127.0.0.1 + Bearer token──►  Ponte do TuDu
                                                              (electron/bridge.cjs)
                                                                     │  IPC
                                                                     ▼
                                                        Revisão do usuário → IndexedDB
```

O sistema tem **dois componentes** de segurança:

| Componente | Repositório | Papel |
|---|---|---|
| `mcp-tudu` | este | traduz chamadas MCP em requisições HTTP; não decide nada |
| Ponte | `callipog/TuDu` → `electron/bridge.cjs` | autentica, autoriza e encaminha ao app |

A **autoridade de segurança é a ponte**. O `mcp-tudu` é um encaminhador: não
guarda estado, não valida permissão, não toca no banco.

## Fronteiras de confiança

1. **Assistente → mcp-tudu** (stdio): o conteúdo dos argumentos de ferramenta é
   controlado pelo modelo, portanto **não confiável**.
2. **mcp-tudu → ponte** (HTTP loopback): autenticado por token. A ponte trata
   toda entrada como não confiável.
3. **Ponte → renderer** (IPC) → **usuário**: toda escrita passa por uma revisão
   na tela antes de tocar o banco (salvo se o usuário desligar isso).

## Ativos protegidos

- **O token da ponte** (`bridge.json`): quem o tem fala com a ponte como você.
- **Os dados de tarefas/projetos**: podem conter informação sensível de trabalho.
- **A integridade das escritas**: um roadmap gravado não deve ser adulterável em trânsito.

## Controles em vigor

| Controle | Onde | Contra o quê |
|---|---|---|
| Escuta só em `127.0.0.1` | ponte | exposição na rede |
| `Authorization: Bearer <token>` obrigatório | ponte | acesso não autorizado |
| Comparação de token em tempo constante (`timingSafeEqual`) | ponte | oráculo de timing |
| **Token rotacionado a cada início** | ponte | reuso de token roubado |
| Rejeita `Origin`/`Referer` | ponte | CSRF de uma aba do navegador |
| **Valida `Host` (só loopback)** | ponte | DNS rebinding |
| ACL do arquivo restrita ao dono (`icacls` no Windows) | ponte | leitura por outros usuários |
| Limite de 1 MB por payload; teto de 50 épicos / 200 tarefas | ponte | exaustão de recursos |
| Toda escrita exige confirmação do usuário na tela | renderer | gravação silenciosa |
| `encodeURIComponent` em parâmetros de rota | mcp-tudu | path traversal / CRLF |
| Campos reconstruídos com `clamp()`, sem spread do input | renderer | prototype pollution / injeção |
| Timeout curto (15s) em leitura | mcp-tudu | ponte travada prendendo o agente |

## Teste de invasão — resultados

Bateria executada: SCA (dependências), SAST (estático), secret scanning, DAST
(dinâmico) e exploração ativa (pentest). Data: 2026-08-07.

### Corrigido

| Achado | Severidade | Correção |
|---|---|---|
| DNS rebinding — `Host` não validado | Média-baixa | valida Host de loopback |
| CSRF olhava só `Origin`, não `Referer` | Baixa | rejeita ambos |
| Token persistia entre reinícios (amplia roubo por port-squatting/MITM) | Média-baixa | rotação a cada início |
| Documentação afirmava `0600`, ignorado no Windows | Baixa (doc falsa) | ACL via `icacls` + doc corrigida |
| Leitura esperava até 150s numa ponte travada | Baixa | timeout de 15s em GET |

### Verificado seguro

- Autenticação: 6 variantes de bypass do Bearer, todas rejeitadas (401).
- Timing do token: 0 ns de diferença na comparação isolada — sem oráculo.
- Path traversal / CRLF via `projectId`: neutralizado por `encodeURIComponent`.
- Prototype pollution: o compilador não faz merge do input; `__proto__` é inerte.
- Sem segredos no código ou no histórico do git.
- Sem `eval`, `child_process`, `require` dinâmico ou SSRF no `mcp-tudu`.
- `npm audit`: 0 vulnerabilidades conhecidas.

## Limites conhecidos (risco aceito)

1. **Modelo de segredo em arquivo.** Um processo rodando **como o usuário** pode
   ler `bridge.json` e, portanto, o token. Nesse ponto o atacante já teria acesso
   equivalente ao próprio banco. A rotação de token **limita a janela** de um
   token roubado, mas não elimina a causa. A eliminação exigiria trocar o TCP
   loopback por um **named pipe com ACL do SO** — mudança arquitetural planejada,
   ainda não implementada.

2. **O conteúdo lido chega cru ao modelo.** Títulos e descrições de tarefas não
   são sanitizados antes de irem ao contexto do assistente. Como é o usuário quem
   cria as tarefas, o círculo é fechado; mas tarefas vindas de fonte não confiável
   poderiam tentar envenenar o contexto (prompt injection) numa leitura seguinte.

3. **Dados saem da máquina.** Toda leitura devolve nomes de projetos, tarefas,
   descrições e prazos ao assistente — ou seja, aos servidores do provedor de IA.
   Isso é **inerente ao propósito** da ferramenta; avalie conforme a política de
   dados da sua organização antes de usar em contexto corporativo.

4. **Executável não assinado.** O `mcp-tudu.exe` não tem assinatura de código;
   o SmartScreen pode alertar. Assinar exigiria um certificado pago.

## Escopo desta avaliação

- Testado em **Windows x64** (alvo do executável).
- **Não** houve teste do executável empacotado em si (adulteração de binário,
  DLL hijacking), nem fuzzing prolongado, nem revisão de macOS/Linux.
- A avaliação cobre `mcp-tudu` e a ponte (`electron/bridge.cjs`). O restante do
  app TuDu tem seu próprio ciclo de revisão.

## Reportar uma vulnerabilidade

Abra uma issue privada em `github.com/callipog/mcp-tudu` ou escreva para
guilhermecallipo@gmail.com. Descreva o passo a passo de reprodução e o impacto.
