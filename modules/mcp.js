/**
 * SENJU MCP Client
 * ----------------
 * Connects to the MCP servers listed in mcp.json (same format as Claude Desktop)
 * and hands their tools to the AI brain, so SENJU can use filesystem, GitHub,
 * browser, … servers alongside her own built-in tools.
 *
 *   {
 *     "mcpServers": {
 *       "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/me"] },
 *       "remote":     { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } },
 *       "off-for-now": { "command": "…", "disabled": true }
 *     }
 *   }
 */

const fs = require('fs');
const path = require('path');

const CONNECT_TIMEOUT_MS = 30000;
const CALL_TIMEOUT_MS = 120000;
const MAX_RESULT_CHARS = 8000;

const EXAMPLE_CONFIG = {
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', require('os').homedir()],
      disabled: true,
    },
  },
};

// The SDK's safe default env misses a few vars that npx/.cmd servers need on Windows
function windowsExtraEnv() {
  if (process.platform !== 'win32') return {};
  const out = {};
  for (const k of ['ComSpec', 'PATHEXT', 'ProgramData', 'ProgramFiles(x86)', 'windir', 'NUMBER_OF_PROCESSORS']) {
    if (process.env[k] !== undefined) out[k] = process.env[k];
  }
  return out;
}

// OpenAI-style tool names: ^[a-zA-Z0-9_-]{1,64}$
function cleanName(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

/** Flatten an MCP tool result into text the model can read. */
function resultToText(result) {
  if (!result) return '';
  if (result.structuredContent && !(result.content && result.content.length)) {
    return JSON.stringify(result.structuredContent);
  }
  const parts = (result.content || []).map((c) => {
    if (c.type === 'text') return c.text;
    if (c.type === 'resource') return c.resource && (c.resource.text || `[resource ${c.resource.uri}]`);
    if (c.type === 'resource_link') return `[link ${c.uri}]`;
    if (c.type === 'image') return '[image]';
    if (c.type === 'audio') return '[audio]';
    return JSON.stringify(c);
  });
  return parts.filter(Boolean).join('\n');
}

class McpManager {
  constructor({ configPath, log = console.log }) {
    this.configPath = configPath;
    this.log = log;
    this.servers = new Map();  // name → { client, transport, tools, state, error }
    this.toolIndex = new Map(); // exposed tool name → { server, tool }
    this.starting = null;
  }

  // ── config ───────────────────────────────────────────────
  readConfigText() {
    try {
      return fs.readFileSync(this.configPath, 'utf8');
    } catch (_) {
      const text = JSON.stringify(EXAMPLE_CONFIG, null, 2) + '\n';
      try {
        fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
        fs.writeFileSync(this.configPath, text);
      } catch (e) { this.log(`[MCP] Couldn't create ${this.configPath}: ${e.message}`); }
      return text;
    }
  }

  readConfig() {
    const cfg = JSON.parse(this.readConfigText());
    return cfg && typeof cfg.mcpServers === 'object' && cfg.mcpServers ? cfg : { mcpServers: {} };
  }

  /** Validate + save new config text, then reconnect everything. */
  async saveConfigText(text) {
    const cfg = JSON.parse(text); // throws on bad JSON — caller shows the message
    if (!cfg || typeof cfg.mcpServers !== 'object' || Array.isArray(cfg.mcpServers)) {
      throw new Error('Config must look like { "mcpServers": { "name": { "command": "…" } } }');
    }
    for (const [name, s] of Object.entries(cfg.mcpServers)) {
      if (!s || (!s.command && !s.url)) throw new Error(`Server "${name}" needs a "command" or a "url"`);
    }
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2) + '\n');
    await this.restart();
  }

  // ── lifecycle ────────────────────────────────────────────
  start() {
    if (!this.starting) this.starting = this._startAll().finally(() => { this.starting = null; });
    return this.starting;
  }

  async _startAll() {
    let cfg;
    try {
      cfg = this.readConfig();
    } catch (e) {
      this.log(`[MCP] mcp.json is not valid JSON: ${e.message}`);
      return;
    }
    const entries = Object.entries(cfg.mcpServers);
    await Promise.all(entries.map(([name, sc]) => this._connect(name, sc)));
    this._rebuildIndex();
    const ok = [...this.servers.values()].filter((s) => s.state === 'connected');
    if (entries.length) this.log(`[MCP] ${ok.length}/${entries.length} servers connected, ${this.toolIndex.size} tools available.`);
  }

  async _connect(name, sc) {
    const entry = { name, tools: [], state: 'connecting', error: null, client: null, transport: null };
    this.servers.set(name, entry);
    if (sc.disabled) { entry.state = 'disabled'; return; }

    try {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const client = new Client({ name: 'senju', version: '1.0.0' });
      let transport;
      if (sc.url) {
        const headers = sc.headers || {};
        const url = new URL(sc.url);
        if (sc.type === 'sse' || sc.transport === 'sse') {
          const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
          transport = new SSEClientTransport(url, { requestInit: { headers } });
        } else {
          const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
          transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
        }
      } else {
        const { StdioClientTransport, getDefaultEnvironment } = require('@modelcontextprotocol/sdk/client/stdio.js');
        transport = new StdioClientTransport({
          command: sc.command,
          args: Array.isArray(sc.args) ? sc.args.map(String) : [],
          env: { ...getDefaultEnvironment(), ...windowsExtraEnv(), ...(sc.env || {}) },
          cwd: sc.cwd,
          stderr: 'pipe',
        });
        // Server logs → our console, never the user's chat
        if (transport.stderr) transport.stderr.on('data', (d) => this.log(`[MCP ${name}] ${String(d).trim().slice(0, 500)}`));
      }

      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `Connecting to "${name}"`);
      const tools = [];
      let cursor;
      do {
        const page = await withTimeout(client.listTools(cursor ? { cursor } : undefined), CONNECT_TIMEOUT_MS, `Listing tools of "${name}"`);
        tools.push(...(page.tools || []));
        cursor = page.nextCursor;
      } while (cursor);

      client.onclose = () => {
        if (entry.state === 'connected') {
          entry.state = 'error';
          entry.error = 'Server closed the connection';
          this._rebuildIndex();
          this.log(`[MCP] "${name}" disconnected.`);
        }
      };
      Object.assign(entry, { client, transport, tools, state: 'connected' });
      this.log(`[MCP] "${name}" connected (${tools.length} tools).`);
    } catch (e) {
      entry.state = 'error';
      entry.error = e.message;
      this.log(`[MCP] "${name}" failed: ${e.message}`);
      try { if (entry.transport) await entry.transport.close(); } catch (_) { /* ignore */ }
    }
  }

  _rebuildIndex() {
    this.toolIndex.clear();
    for (const s of this.servers.values()) {
      if (s.state !== 'connected') continue;
      for (const tool of s.tools) {
        let exposed = `mcp_${cleanName(s.name)}__${cleanName(tool.name)}`.slice(0, 64);
        for (let i = 2; this.toolIndex.has(exposed); i++) exposed = `${exposed.slice(0, 60)}_${i}`;
        this.toolIndex.set(exposed, { server: s, tool });
      }
    }
  }

  async closeAll() {
    const closing = [...this.servers.values()].map(async (s) => {
      s.state = 'closed';
      try { if (s.client) await withTimeout(s.client.close(), 3000, 'close'); } catch (_) { /* ignore */ }
    });
    await Promise.all(closing);
    this.servers.clear();
    this.toolIndex.clear();
  }

  async restart() {
    if (this.starting) await this.starting.catch(() => {});
    await this.closeAll();
    await this.start();
  }

  // ── used by the brain ────────────────────────────────────
  has(name) {
    return this.toolIndex.has(name);
  }

  /** Tool definitions in OpenAI-compatible function-calling format (what NVIDIA expects). */
  getToolDefinitions() {
    return [...this.toolIndex.entries()].map(([exposed, { server, tool }]) => ({
      type: 'function',
      function: {
        name: exposed,
        description: `[MCP: ${server.name}] ${tool.description || tool.title || tool.name}`.slice(0, 1024),
        parameters: tool.inputSchema && tool.inputSchema.type === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {} },
      },
    }));
  }

  async call(exposed, args) {
    const hit = this.toolIndex.get(exposed);
    if (!hit) throw new Error(`Unknown MCP tool ${exposed}`);
    const { server, tool } = hit;
    const result = await withTimeout(
      server.client.callTool({ name: tool.name, arguments: args || {} }),
      CALL_TIMEOUT_MS,
      `${server.name}/${tool.name}`
    );
    const text = resultToText(result).slice(0, MAX_RESULT_CHARS);
    if (result && result.isError) throw new Error(text || 'Tool reported an error');
    return text || '(done, no output)';
  }

  status() {
    return [...this.servers.values()].map((s) => ({
      name: s.name,
      state: s.state,
      error: s.error,
      tools: s.tools.map((t) => t.name),
    }));
  }
}

module.exports = { McpManager };
