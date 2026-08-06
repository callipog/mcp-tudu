Executável único para Windows — não precisa de Node nem de `npm install`.

Baixe o `mcp-tudu.exe` e aponte a configuração do seu assistente para o caminho dele:

```json
{
  "mcpServers": {
    "tudu": {
      "command": "C:\\caminho\\para\\mcp-tudu.exe"
    }
  }
}
```

Requer o **TuDu 1.5.0 ou superior**, com a ponte ligada em
Configurações → Agentes de IA (MCP).

O executável não é assinado, então o Windows pode mostrar um aviso do SmartScreen
na primeira execução.
