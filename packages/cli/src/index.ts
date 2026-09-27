/**
 * `@astroid/cli` — the programmatic core of the `astroid` command-line tool.
 *
 * This module exports {@link buildProgram}, which assembles the full Commander
 * program, plus the small config-store and client-factory helpers it is built
 * on. The executable entry point ({@link file://./bin.ts}) simply calls
 * `buildProgram().parseAsync(process.argv)`.
 *
 * Credentials are read from (in order) explicit flags, environment variables
 * (`ASTROID_API_KEY`, `ASTROID_ACCESS_TOKEN`, `ASTROID_BASE_URL`), then the
 * on-disk config at `~/.astroid/config.json`. Secrets are written with `0600`
 * permissions and are never printed — `config list` masks them.
 *
 * @packageDocumentation
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { Astroid } from '@astroid/client';
import { isAstroidError } from '@astroid/errors';
import type { AstroidClientConfig } from '@astroid/core';
import type { AgentRole, AgentStatus } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/*                                config store                                */
/* -------------------------------------------------------------------------- */

/** The persisted CLI configuration. Secrets live here at `0600`. */
export interface CliConfig {
  baseUrl?: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
}

/** Keys the user is allowed to `config set` / `config get`. */
const CONFIG_KEYS = ['baseUrl', 'apiKey', 'accessToken', 'refreshToken'] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];

/** Keys whose values must be masked when displayed. */
const SECRET_KEYS = new Set<ConfigKey>(['apiKey', 'accessToken', 'refreshToken']);

/** Absolute path to the CLI config file (honours `ASTROID_CONFIG_HOME`). */
export function configPath(): string {
  const base = process.env.ASTROID_CONFIG_HOME ?? join(homedir(), '.astroid');
  return join(base, 'config.json');
}

/** Load the on-disk config, returning `{}` when the file is absent or invalid. */
export function loadConfig(): CliConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as CliConfig) : {};
  } catch {
    return {};
  }
}

/** Persist the config, creating `~/.astroid` and locking the file to `0600`. */
export function saveConfig(config: CliConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/** Replace a secret's value with a short masked hint (never the raw value). */
function maskSecret(value: string): string {
  if (value.length <= 4) return '****';
  return `${value.slice(0, 3)}…${value.slice(-2)} (${value.length} chars)`;
}

/* -------------------------------------------------------------------------- */
/*                               client factory                               */
/* -------------------------------------------------------------------------- */

/** How credentials were resolved, for `doctor` reporting. */
export interface ResolvedCredentials {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  accessToken: string | undefined;
  /** Where the winning credential came from. */
  source: 'flag' | 'env' | 'file' | 'none';
}

/** Global flags shared by every command that talks to the API. */
interface GlobalFlags {
  apiKey?: string;
  baseUrl?: string;
  json?: boolean;
}

/** Merge flags, environment, and file config into a single credential view. */
export function resolveCredentials(flags: GlobalFlags): ResolvedCredentials {
  const file = loadConfig();
  const apiKey = flags.apiKey ?? process.env.ASTROID_API_KEY ?? file.apiKey;
  const accessToken = process.env.ASTROID_ACCESS_TOKEN ?? file.accessToken;
  const baseUrl = flags.baseUrl ?? process.env.ASTROID_BASE_URL ?? file.baseUrl;

  let source: ResolvedCredentials['source'] = 'none';
  if (flags.apiKey) source = 'flag';
  else if (process.env.ASTROID_API_KEY ?? process.env.ASTROID_ACCESS_TOKEN) source = 'env';
  else if (file.apiKey ?? file.accessToken) source = 'file';

  return { baseUrl, apiKey, accessToken, source };
}

/**
 * Build an authenticated {@link Astroid} client from the resolved credentials,
 * or exit with a helpful message when none are present.
 */
export function createClient(flags: GlobalFlags): Astroid {
  const creds = resolveCredentials(flags);
  if (!creds.apiKey && !creds.accessToken) {
    fail('Not authenticated. Run `astroid login`, set ASTROID_API_KEY, or pass --api-key.');
  }
  const config: AstroidClientConfig = {};
  if (creds.apiKey) config.apiKey = creds.apiKey;
  if (creds.accessToken) config.accessToken = creds.accessToken;
  if (creds.baseUrl) config.baseUrl = creds.baseUrl;
  return new Astroid(config);
}

/* -------------------------------------------------------------------------- */
/*                                   output                                   */
/* -------------------------------------------------------------------------- */

/** Print a value, honouring the top-level `--json` flag when set. */
function print(command: Command, value: unknown): void {
  const json = Boolean(command.optsWithGlobals().json);
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else if (typeof value === 'string') {
    console.log(value);
  } else {
    console.dir(value, { depth: null, colors: false });
  }
}

/** Print an error and exit non-zero. Never rethrows (keeps stack traces quiet). */
function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** Run an API-backed action, translating Astroid errors into clean exits. */
async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    if (isAstroidError(err)) {
      const requestId = err.requestId ? ` (request ${err.requestId})` : '';
      fail(`${err.code}: ${err.message}${requestId}`);
    }
    fail(err instanceof Error ? err.message : String(err));
  }
}

/* -------------------------------------------------------------------------- */
/*                               command groups                               */
/* -------------------------------------------------------------------------- */

function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('Read and write CLI configuration.');

  config
    .command('path')
    .description('Print the config file location.')
    .action(() => console.log(configPath()));

  config
    .command('list')
    .description('Show the stored config (secrets masked).')
    .action(() => {
      const stored = loadConfig();
      const view: Record<string, string> = {};
      for (const key of CONFIG_KEYS) {
        const value = stored[key];
        if (value === undefined) continue;
        view[key] = SECRET_KEYS.has(key) ? maskSecret(value) : value;
      }
      console.dir(view, { depth: null, colors: false });
    });

  config
    .command('get <key>')
    .description('Print one config value (secrets masked).')
    .action((key: string) => {
      if (!CONFIG_KEYS.includes(key as ConfigKey)) {
        fail(`Unknown key "${key}". Valid keys: ${CONFIG_KEYS.join(', ')}.`);
      }
      const value = loadConfig()[key as ConfigKey];
      if (value === undefined) {
        fail(`"${key}" is not set.`);
      }
      console.log(SECRET_KEYS.has(key as ConfigKey) ? maskSecret(value) : value);
    });

  config
    .command('set <key> <value>')
    .description('Store a config value.')
    .action((key: string, value: string) => {
      if (!CONFIG_KEYS.includes(key as ConfigKey)) {
        fail(`Unknown key "${key}". Valid keys: ${CONFIG_KEYS.join(', ')}.`);
      }
      const stored = loadConfig();
      stored[key as ConfigKey] = value;
      saveConfig(stored);
      console.log(`✓ Saved ${key} to ${configPath()}`);
    });

  config
    .command('clear')
    .description('Delete the stored config file contents.')
    .action(() => {
      saveConfig({});
      console.log('✓ Cleared stored config.');
    });
}

function registerLoginCommands(program: Command): void {
  program
    .command('login')
    .description('Log in with email + password and store the session tokens.')
    .requiredOption('-e, --email <email>', 'Account email')
    .requiredOption('-p, --password <password>', 'Account password')
    .action(async (opts: { email: string; password: string }, command: Command) => {
      await run(async () => {
        const flags = command.optsWithGlobals() as GlobalFlags;
        const config: AstroidClientConfig = { apiKey: 'pending' };
        // Login needs no prior credential; build a bare client on the base URL.
        const creds = resolveCredentials(flags);
        if (creds.baseUrl) config.baseUrl = creds.baseUrl;
        // A placeholder apiKey satisfies resolveConfig; it is replaced by the
        // access token the login response sets on the client.
        const astroid = new Astroid(config);
        const result = await astroid.auth.login({
          email: opts.email,
          password: opts.password,
        });
        const stored = loadConfig();
        stored.accessToken = result.accessToken;
        stored.refreshToken = result.refreshToken;
        if (creds.baseUrl) stored.baseUrl = creds.baseUrl;
        delete stored.apiKey; // prefer the fresh session token
        saveConfig(stored);
        const who = result.session?.user.email ?? opts.email;
        console.log(`✓ Logged in as ${who}. Tokens saved to ${configPath()}`);
      });
    });

  program
    .command('logout')
    .description('Revoke the current session and clear stored tokens.')
    .action(async (_opts: unknown, command: Command) => {
      await run(async () => {
        const stored = loadConfig();
        if (stored.accessToken) {
          try {
            const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
            await astroid.auth.logout();
          } catch {
            // Even if the server call fails, clear local tokens below.
          }
        }
        delete stored.accessToken;
        delete stored.refreshToken;
        saveConfig(stored);
        console.log('✓ Logged out and cleared local tokens.');
      });
    });

  program
    .command('whoami')
    .description('Show the currently authenticated user and organization.')
    .action(async (_opts: unknown, command: Command) => {
      await run(async () => {
        const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
        const session = await astroid.auth.me();
        print(command, {
          user: { id: session.user.id, email: session.user.email, name: session.user.name },
          organization: { id: session.organization.id, name: session.organization.name },
        });
      });
    });
}

function registerAgentCommands(program: Command): void {
  const agents = program.command('agents').description('Manage AI agents.');

  agents
    .command('list')
    .description('List agents.')
    .option('--status <status>', 'Filter by status')
    .option('--role <role>', 'Filter by role')
    .action(async (opts: { status?: string; role?: string }, command: Command) => {
      await run(async () => {
        const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
        const page = await astroid.agents.list({
          ...(opts.status ? { status: opts.status as AgentStatus } : {}),
          ...(opts.role ? { role: opts.role as AgentRole } : {}),
        });
        print(command, page);
      });
    });

  agents
    .command('get <id>')
    .description('Fetch a single agent.')
    .action(async (id: string, _opts: unknown, command: Command) => {
      await run(async () => {
        const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
        print(command, await astroid.agents.get(id));
      });
    });

  agents
    .command('create')
    .description('Register a new agent.')
    .requiredOption('-n, --name <name>', 'Agent name')
    .option('-d, --description <text>', 'Description')
    .option('--role <role>', 'Agent role')
    .option('-c, --capabilities <list>', 'Comma-separated capability list (e.g. "trade,transfer")')
    .option('-b, --budget <currency:amount>', 'Initial budget (e.g. "USDC:100")')
    .action(
      async (
        opts: {
          name: string;
          description?: string;
          role?: string;
          capabilities?: string;
          budget?: string;
        },
        command: Command,
      ) => {
        await run(async () => {
          const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
          const capabilities = opts.capabilities
            ? opts.capabilities
                .split(',')
                .map((c) => c.trim())
                .filter((c) => c.length > 0)
            : [];
          if (capabilities.length === 0) {
            fail('--capabilities is required (comma-separated, e.g. "trade,transfer").');
          }
          const [currency, amount] = (opts.budget ?? '').split(':');
          if (!currency || !amount) {
            fail('--budget is required as <currency:amount>, e.g. "USDC:100".');
          }
          const agent = await astroid.agents.create({
            name: opts.name,
            capabilities,
            initialBudget: { currency, amount },
            ...(opts.description ? { description: opts.description } : {}),
            ...(opts.role ? { role: opts.role as AgentRole } : {}),
          });
          print(command, agent);
        });
      },
    );
}

function registerWalletCommands(program: Command): void {
  const wallets = program.command('wallets').description('Manage wallets.');

  wallets
    .command('list')
    .description('List wallets.')
    .option('--status <status>', 'Filter by status')
    .option('--agent <agentId>', 'Filter by agent')
    .action(async (opts: { status?: string; agent?: string }, command: Command) => {
      await run(async () => {
        const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
        const page = await astroid.wallets.list({
          ...(opts.status ? { status: opts.status as never } : {}),
          ...(opts.agent ? { agentId: opts.agent } : {}),
        });
        print(command, page);
      });
    });

  wallets
    .command('get <id>')
    .description('Fetch a single wallet.')
    .action(async (id: string, _opts: unknown, command: Command) => {
      await run(async () => {
        const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
        print(command, await astroid.wallets.get(id));
      });
    });

  wallets
    .command('balance <id>')
    .description('Read live on-chain balances for a wallet.')
    .action(async (id: string, _opts: unknown, command: Command) => {
      await run(async () => {
        const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
        print(command, await astroid.wallets.balance(id));
      });
    });

  wallets
    .command('create')
    .description('Provision a new managed wallet.')
    .option('-l, --label <label>', 'Wallet label')
    .option('--agent <agentId>', 'Bind to an agent')
    .action(async (opts: { label?: string; agent?: string }, command: Command) => {
      await run(async () => {
        const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
        const wallet = await astroid.wallets.create({
          ...(opts.label ? { label: opts.label } : {}),
          ...(opts.agent ? { agentId: opts.agent } : {}),
        });
        print(command, wallet);
      });
    });
}

function registerPolicyCommands(program: Command): void {
  const policies = program.command('policies').description('Inspect spending policies.');

  policies
    .command('list')
    .description('List policies.')
    .option('--enabled', 'Only enabled policies')
    .action(async (opts: { enabled?: boolean }, command: Command) => {
      await run(async () => {
        const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
        const page = await astroid.policies.list(opts.enabled ? { enabled: true } : {});
        print(command, page);
      });
    });

  policies
    .command('get <id>')
    .description('Fetch a single policy.')
    .action(async (id: string, _opts: unknown, command: Command) => {
      await run(async () => {
        const astroid = createClient(command.optsWithGlobals() as GlobalFlags);
        print(command, await astroid.policies.get(id));
      });
    });
}

function registerUtilityCommands(program: Command): void {
  program
    .command('init')
    .description('Scaffold a local config file interactively-free (writes defaults).')
    .option('--base-url <url>', 'API base URL to store')
    .action((opts: { baseUrl?: string }) => {
      const stored = loadConfig();
      if (opts.baseUrl) stored.baseUrl = opts.baseUrl;
      saveConfig(stored);
      console.log(`✓ Wrote ${configPath()}`);
      console.log('Next: `astroid login --email you@org.com --password ***`');
    });

  program
    .command('doctor')
    .description('Diagnose configuration and API connectivity.')
    .action(async (_opts: unknown, command: Command) => {
      const flags = command.optsWithGlobals() as GlobalFlags;
      const creds = resolveCredentials(flags);
      const lines: string[] = [];
      lines.push(
        `config file : ${configPath()} ${existsSync(configPath()) ? '(present)' : '(absent)'}`,
      );
      lines.push(`base URL    : ${creds.baseUrl ?? 'https://api.astroid.finance (default)'}`);
      lines.push(
        `credential  : ${creds.apiKey ? 'api key' : creds.accessToken ? 'access token' : 'none'} (source: ${creds.source})`,
      );
      lines.push(`SDK version : ${Astroid.version}`);

      if (!creds.apiKey && !creds.accessToken) {
        console.log(lines.join('\n'));
        fail('No credentials found — run `astroid login` or set ASTROID_API_KEY.');
      }

      await run(async () => {
        const astroid = createClient(flags);
        const session = await astroid.auth.me();
        lines.push(`auth check  : ok — ${session.user.email} @ ${session.organization.name}`);
        console.log(lines.join('\n'));
        console.log('✓ All checks passed.');
      });
    });
}

/* -------------------------------------------------------------------------- */
/*                                  program                                   */
/* -------------------------------------------------------------------------- */

/** SDK/CLI version, surfaced by `--version` and `doctor`. */
export const CLI_VERSION = Astroid.version;

/**
 * Assemble the complete `astroid` Commander program. Call `.parseAsync(argv)`
 * on the result. Exposed for embedding and testing.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('astroid')
    .description('Astroid — the Financial Operating System for autonomous AI agents on Stellar.')
    .version(CLI_VERSION, '-v, --version', 'Print the CLI version.')
    .option('--api-key <key>', 'API key (overrides env and config).')
    .option('--base-url <url>', 'API base URL (overrides env and config).')
    .option('--json', 'Emit machine-readable JSON.')
    .showHelpAfterError();

  registerLoginCommands(program);
  registerConfigCommands(program);
  registerAgentCommands(program);
  registerWalletCommands(program);
  registerPolicyCommands(program);
  registerUtilityCommands(program);

  return program;
}

export default buildProgram;
