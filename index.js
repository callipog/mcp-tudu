#!/usr/bin/env node
/**
 * Servidor MCP do TuDu.
 *
 * Fica entre o assistente (Claude Desktop, Claude Code, Gemini CLI) e a ponte
 * HTTP local do app. Não conhece o banco: só traduz chamadas de ferramenta em
 * requisições para 127.0.0.1, autenticadas com o token que o app gerou.
 *
 * Descoberta de credencial, nesta ordem:
 *   1. TUDU_BRIDGE_TOKEN / TUDU_BRIDGE_PORT no ambiente
 *   2. bridge.json na pasta de dados do TuDu
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* --------------------------------------------------------------- credencial */

function userDataDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'TuDu');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'TuDu');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'TuDu');
}

function credentials() {
  if (process.env.TUDU_BRIDGE_TOKEN) {
    return { token: process.env.TUDU_BRIDGE_TOKEN, port: Number(process.env.TUDU_BRIDGE_PORT) || 8787 };
  }
  const file = path.join(userDataDir(), 'bridge.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (saved.token) return { token: saved.token, port: Number(saved.port) || 8787 };
  } catch { /* cai no erro amigável abaixo */ }
  return null;
}

/* ------------------------------------------------------------------ chamadas */

// Timeouts distintos: a escrita espera a confirmação do usuário na tela (até
// ~2,5 min); a leitura é respondida na hora, então uma espera longa só serviria
// para uma ponte travada/hostil prender o agente. Falha rápido na leitura.
const WRITE_TIMEOUT_MS = 150000;
const READ_TIMEOUT_MS = 15000;

async function call(method, route, body) {
  const cred = credentials();
  if (!cred) {
    throw new Error(
      'Não achei a credencial do TuDu. Abra o app → Configurações → Agentes de IA (MCP) e ligue "Aceitar conexões de agentes".'
    );
  }

  let res;
  try {
    res = await fetch(`http://127.0.0.1:${cred.port}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${cred.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new Error('O TuDu não respondeu a tempo — a proposta pode estar aguardando confirmação na tela do app.');
    }
    throw new Error('O TuDu não está rodando, ou a ponte está desligada nas Configurações.');
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    if (res.status === 401) throw new Error('Token recusado. Reative a ponte nas Configurações do TuDu para gerar outro.');
    if (res.status === 409) throw new Error('Você recusou a proposta no TuDu. Nada foi criado.');
    throw new Error(data?.error || `A ponte respondeu ${res.status}.`);
  }
  return data;
}

/* ---------------------------------------------------------------- esquemas */

// As descrições abaixo são o que o modelo lê para preencher os campos.
// Vale investir nelas: é aqui que se ganha ou se perde a qualidade do roadmap.
const taskSchema = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string', description: 'Ação concreta e verificável. Evite tarefas guarda-chuva.' },
    description: { type: 'string', description: 'Contexto, critério de pronto, links.' },
    epic: { type: 'string', description: 'A "key" ou o nome de um épico declarado neste mesmo payload, ou de um já existente no projeto.' },
    urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    status: { type: 'string', description: 'Etapa do board (id ou rótulo, ex.: "A Fazer"). Sem isso, cai na primeira etapa.' },
    startDate: { type: 'string', description: 'AAAA-MM-DD.' },
    dueDate: { type: 'string', description: 'AAAA-MM-DD. Precisa ser depois do início e caber no prazo do projeto.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Tags inexistentes são criadas.' },
    subtasks: { type: 'array', items: { type: 'string' }, description: 'Checklist da tarefa.' },
  },
};

const TOOLS = [
  {
    name: 'tudu_list_projects',
    description:
      'Lista os projetos do TuDu com etapas do board, épicos e contagem de tarefas. Chame ANTES de criar qualquer coisa: é assim que se descobre se o projeto já existe e quais etapas ele usa, evitando duplicar.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tudu_get_project',
    description:
      'Detalha um projeto: etapas, épicos e tarefas ativas. Use para não recriar algo que já está lá e para acertar os nomes de etapa e épico.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: { type: 'string', description: 'Id vindo de tudu_list_projects.' } },
    },
  },
  {
    name: 'tudu_create_roadmap',
    description:
      'Cria um roadmap no TuDu: projeto (novo ou existente), épicos como fases e tarefas. O usuário revisa e confirma dentro do app antes de qualquer gravação — a chamada só retorna depois disso. Boas práticas: épicos representam fases do trabalho, não baldes temáticos; tarefas devem caber em poucos dias; datas precisam respeitar o início e o fim do projeto.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'object',
          description: 'Destino. Passe "id" para mirar um projeto existente; ou "name", que reaproveita pelo nome ou cria.',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            startDate: { type: 'string', description: 'AAAA-MM-DD.' },
            endDate: { type: 'string', description: 'AAAA-MM-DD.' },
          },
        },
        epics: {
          type: 'array',
          description: 'Fases do projeto, na ordem em que acontecem.',
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              key: { type: 'string', description: 'Apelido curto para as tarefas referenciarem (ex.: "descoberta").' },
              name: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
        tasks: { type: 'array', items: taskSchema },
      },
    },
  },
  {
    name: 'tudu_add_tasks',
    description:
      'Acrescenta tarefas a um projeto que já existe, sem mexer na estrutura dele. Também passa pela confirmação do usuário.',
    inputSchema: {
      type: 'object',
      required: ['tasks'],
      properties: {
        projectId: { type: 'string', description: 'Preferível. Id vindo de tudu_list_projects.' },
        projectName: { type: 'string', description: 'Alternativa ao id: nome exato do projeto.' },
        tasks: { type: 'array', items: taskSchema },
      },
    },
  },
];

/* ------------------------------------------------------------------ servidor */

const server = new Server(
  { name: 'tudu-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result;
    switch (name) {
      case 'tudu_list_projects':
        result = await call('GET', '/projects');
        break;
      case 'tudu_get_project':
        result = await call('GET', `/projects/${encodeURIComponent(args.projectId)}`);
        break;
      case 'tudu_create_roadmap':
        result = await call('POST', '/roadmap', {
          project: args.project,
          epics: args.epics,
          tasks: args.tasks,
        });
        break;
      case 'tudu_add_tasks':
        result = await call('POST', '/tasks', {
          project: args.projectId ? { id: args.projectId } : { name: args.projectName },
          tasks: args.tasks,
        });
        break;
      default:
        throw new Error(`Ferramenta desconhecida: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    };
  }
});

// Sem `await` de topo: o empacotador converte para CommonJS, que não o suporta.
server.connect(new StdioServerTransport()).catch((err) => {
  console.error('[mcp-tudu] falha ao iniciar:', err);
  process.exit(1);
});
