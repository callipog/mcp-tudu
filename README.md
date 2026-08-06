# mcp-tudu

Servidor MCP do [TuDu](https://github.com/callipog/TuDu). Deixa assistentes de IA
criarem projetos, épicos e tarefas no app por conversa.

```
Claude Desktop · Claude Code · Gemini CLI
        │  MCP (stdio)
        ▼
     mcp-tudu  ──HTTP 127.0.0.1 + token──►  TuDu (Electron)
                                               │
                                        revisão na tela
                                               ▼
                                          IndexedDB
```

## O que funciona

| Cliente | Funciona? |
|---|---|
| Claude Desktop | sim |
| Claude Code | sim |
| Gemini CLI | sim |
| **App/web do Gemini** | **não** |
| **Claude web** | **não** |

Os dois últimos rodam na nuvem e não alcançam um servidor na sua máquina — é
limitação da arquitetura deles. Para esses, peça o JSON do roadmap e importe no app.

## Requisitos

- TuDu **1.5.0 ou superior**, instalado e aberto
- Windows (para o executável). Em outros sistemas, use a instalação por código.

## Instalação — executável (recomendado)

Baixe o **`mcp-tudu.exe`** da [última release](https://github.com/callipog/mcp-tudu/releases/latest)
e guarde onde preferir. Não precisa de Node, nem de `npm install`.

> Por ser um executável sem assinatura digital, o Windows pode mostrar um aviso
> do SmartScreen na primeira execução. É esperado: assinar exigiria um
> certificado pago.

No TuDu: **Configurações → Agentes de IA (MCP) → Aceitar conexões de agentes**.
Isso sobe a ponte em `127.0.0.1:8787` e grava o token em `bridge.json`, na pasta
de dados do app. O `mcp-tudu` lê esse arquivo sozinho — você não copia token nenhum.

### Claude Desktop

Em `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tudu": {
      "command": "C:\\caminho\\para\\mcp-tudu.exe"
    }
  }
}
```

### Claude Code

```bash
claude mcp add tudu -- C:\caminho\para\mcp-tudu.exe
```

### Gemini CLI

Em `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "tudu": {
      "command": "C:\\caminho\\para\\mcp-tudu.exe"
    }
  }
}
```

## Instalação — pelo código

Para desenvolver, ou fora do Windows:

```bash
git clone https://github.com/callipog/mcp-tudu.git
cd mcp-tudu
npm install
```

E aponte a configuração para `node` com o `index.js` como argumento, no lugar
do executável.

## Gerando o executável

O [workflow de release](.github/workflows/release.yml) faz isso sozinho ao
empurrar uma tag:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

Localmente, se quiser: `npm run build:exe` (sai em `build/mcp-tudu.exe`). O
`esbuild` junta tudo num arquivo CommonJS e o `pkg` embute o runtime do Node.

## Ferramentas

| Ferramenta | Para quê |
|---|---|
| `tudu_list_projects` | Lista projetos, etapas, épicos e contagem de tarefas |
| `tudu_get_project` | Detalha um projeto (etapas, épicos, tarefas ativas) |
| `tudu_create_roadmap` | Cria projeto + épicos + tarefas |
| `tudu_add_tasks` | Acrescenta tarefas a um projeto existente |

O assistente deve chamar `tudu_list_projects` antes de criar: é assim que ele
descobre que o projeto já existe e quais etapas ele usa, em vez de duplicar.

## Como usar

> "Monte um roadmap no TuDu para o Portal do Cliente, de setembro a dezembro,
> com fases de descoberta, construção e homologação."

O TuDu abre uma revisão mostrando o que será criado. Você confirma ou recusa —
e o assistente recebe o resultado.

Tags que o assistente inventar nascem **presas ao projeto**, não no espaço
global: o vocabulário de um roadmap é daquele contexto.

## Segurança

- A ponte escuta **apenas** em `127.0.0.1`. Nunca fica exposta na rede.
- Todo request exige `Authorization: Bearer <token>`; o token tem 32 bytes
  aleatórios e mora em `bridge.json` (permissão 0600).
- Requests com cabeçalho `Origin` são recusados — nenhum cliente legítimo é um
  navegador, e isso bloqueia uma aba maliciosa tentando falar com a porta.
- Payload limitado a 1 MB; no máximo 50 épicos e 200 tarefas por chamada.
- **Nada é gravado sem confirmação na tela**, a menos que você ligue
  "Aplicar sem confirmar" nas Configurações do TuDu.
- A ponte vem **desligada** por padrão.

## Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `TUDU_BRIDGE_TOKEN` | Sobrepõe o token do `bridge.json` |
| `TUDU_BRIDGE_PORT` | Sobrepõe a porta (padrão `8787`) |

## Quando não funcionar

| Mensagem | O que é |
|---|---|
| "O TuDu não está rodando…" | App fechado ou ponte desligada nas Configurações |
| "Não achei a credencial…" | A ponte nunca foi ligada — ligue uma vez para gerar o token |
| "Token recusado" | Desligue e religue a ponte para gerar outro |
| "Você recusou a proposta" | Você clicou em Recusar na revisão |
| "…não respondeu a tempo" | A revisão ficou 2 minutos sem resposta na tela |

## Licença

MIT
