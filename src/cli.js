// CLI front end: argument parsing, the run/tokens/ast/repl/help/version
// commands, and the stable token dump format. cliMain returns an exit code
// and never calls process.exit itself.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tokenize } from './lexer.js';
import { parse } from './parser.js';
import { Interpreter } from './interpreter.js';
import { astDump } from './ast.js';
import { EmberError, internalError } from './errors.js';
import { resolveTheme } from './diag/theme.js';
import { renderError } from './diag/render.js';
import { startRepl } from './repl.js';

const requirePkg = createRequire(import.meta.url);
const VERSION = requirePkg('../package.json').version;

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_SYNTAX = 65;
const EXIT_RUNTIME = 70;

const COMMANDS = new Set(['run', 'tokens', 'ast', 'repl', 'help', 'version']);
const FILE_COMMANDS = new Set(['run', 'tokens', 'ast']);

// One line of the token dump: TYPE padded to 9 chars, backticked value,
// then `@ L.C-L.C`. String values are JSON quoted inside the backticks.
export function formatToken(tok) {
  const type = String(tok.type).padEnd(9, ' ');
  const v = tok.value === undefined ? null : tok.value;
  const shown = tok.type === 'STRING' ? JSON.stringify(v) : String(v);
  const endCol = tok.endCol ?? tok.col;
  return type + '`' + shown + '` @ ' + tok.line + '.' + tok.col + '-' + tok.line + '.' + endCol;
}

function usageError(message) {
  process.stderr.write('error: ' + message + '\n');
  return EXIT_USAGE;
}

function helpText() {
  const row = (key, desc) => ('  ' + key).padEnd(27) + desc;
  return [
    'Ember ' + VERSION,
    '',
    'usage:',
    '  ember [command] [flags]',
    '',
    'commands:',
    row('run FILE [-- args...]', 'run a program; words after -- arrive as `argv`'),
    row('tokens FILE', 'print the token stream of a program'),
    row('ast FILE', 'print the syntax tree of a program'),
    row('repl', 'start an interactive session (default)'),
    row('help', 'show this text'),
    row('version', 'print the version'),
    '',
    'flags:',
    row('--no-color', 'disable colour output'),
    row('--theme=dark|light', 'select a colour theme'),
    row('--trace-calls', 'trace calls and returns while running'),
    row('--tokens', 'with run, print tokens instead of executing'),
    row('--ast', 'with run, print the tree instead of executing'),
    row('--version, -V', 'print the version'),
    row('--help, -h', 'show this text'),
    '',
    'exit codes:',
    row('0', 'success'),
    row('2', 'usage error or unreadable file'),
    row('65', 'syntax error'),
    row('70', 'runtime or internal error'),
    ''
  ].join('\n');
}

function readSource(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function asEmberError(e) {
  if (e instanceof EmberError) return e;
  return internalError(String((e && e.message) || e));
}

function failWith(err, source, colorInfo, file = null) {
  process.stderr.write(renderError(err, source, colorInfo, file));
  return err.kind === 'syntax' ? EXIT_SYNTAX : EXIT_RUNTIME;
}

function dumpTokens(src, file, colorInfo) {
  try {
    process.stdout.write(tokenize(src, file).map(formatToken).join('\n') + '\n');
    return EXIT_OK;
  } catch (e) {
    return failWith(asEmberError(e), src, colorInfo, file);
  }
}

function dumpAst(src, file, colorInfo) {
  try {
    process.stdout.write(astDump(parse(tokenize(src, file), file)) + '\n');
    return EXIT_OK;
  } catch (e) {
    return failWith(asEmberError(e), src, colorInfo, file);
  }
}

function loadSourceOr(file) {
  try {
    return { ok: true, src: readSource(file) };
  } catch {
    usageError('cannot read ' + file);
    return { ok: false };
  }
}

// Parse argv, dispatch one command, and return the process exit code.
export function cliMain(argv) {
  let noColorFlag = false;
  let themeName = null;
  let traceCalls = false;
  let wantTokens = false;
  let wantAst = false;
  let wantHelp = false;
  let wantVersion = false;
  let command = null;
  let file = null;
  const scriptArgs = [];
  let onlyScriptArgs = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (onlyScriptArgs) {
      scriptArgs.push(a);
      continue;
    }
    if (a === '--') {
      if (command !== 'run') return usageError('the `--` separator is only valid after `run`');
      onlyScriptArgs = true;
      continue;
    }
    switch (a) {
      case '--no-color':
        noColorFlag = true;
        continue;
      case '--trace-calls':
        traceCalls = true;
        continue;
      case '--tokens':
        wantTokens = true;
        continue;
      case '--ast':
        wantAst = true;
        continue;
      case '--version':
      case '-V':
        wantVersion = true;
        continue;
      case '--help':
      case '-h':
        wantHelp = true;
        continue;
      case '--theme': {
        const val = argv[i + 1];
        if (val === undefined || val.startsWith('-')) return usageError('`--theme` expects a value');
        themeName = val;
        i++;
        continue;
      }
    }
    if (a.startsWith('--theme=')) {
      themeName = a.slice('--theme='.length);
      continue;
    }
    if (a.startsWith('-') && a.length > 1) return usageError('unknown option `' + a + '`');
    if (command === null) {
      if (!COMMANDS.has(a)) return usageError('unknown command `' + a + '`; try `ember help`');
      command = a;
      continue;
    }
    if (FILE_COMMANDS.has(command) && file === null) {
      file = a;
      continue;
    }
    return usageError('unexpected argument `' + a + '`');
  }

  if (wantHelp) {
    process.stdout.write(helpText());
    return EXIT_OK;
  }
  if (wantVersion) {
    process.stdout.write('Ember ' + VERSION + '\n');
    return EXIT_OK;
  }

  if (command === null) command = 'repl';

  // Meaningless combinations fail loudly instead of being ignored.
  if (wantTokens && wantAst) return usageError('`--tokens` and `--ast` cannot be combined');
  if ((wantTokens || wantAst || traceCalls) && command !== 'run') {
    const bad = traceCalls ? '--trace-calls' : wantTokens ? '--tokens' : '--ast';
    return usageError('`' + bad + '` only applies to `run`');
  }

  const colorInfo = resolveTheme({ noColorFlag, themeName, stream: process.stdout });

  switch (command) {
    case 'help':
      process.stdout.write(helpText());
      return EXIT_OK;
    case 'version':
      process.stdout.write('Ember ' + VERSION + '\n');
      return EXIT_OK;
    case 'repl':
      return startRepl({ version: VERSION, noColorFlag, themeName });
    case 'tokens':
    case 'ast': {
      if (file === null) return usageError('`' + command + '` requires a file');
      const loaded = loadSourceOr(file);
      if (!loaded.ok) return EXIT_USAGE;
      return command === 'tokens'
        ? dumpTokens(loaded.src, file, colorInfo)
        : dumpAst(loaded.src, file, colorInfo);
    }
    case 'run': {
      if (file === null) return usageError('`run` requires a file');
      const loaded = loadSourceOr(file);
      if (!loaded.ok) return EXIT_USAGE;
      const src = loaded.src;

      if (wantTokens) return dumpTokens(src, file, colorInfo);
      if (wantAst) return dumpAst(src, file, colorInfo);

      let program;
      try {
        program = parse(tokenize(src, file), file);
      } catch (e) {
        return failWith(asEmberError(e), src, colorInfo, file);
      }


      const interp = new Interpreter({
        trace: traceCalls,
        // Trace goes to stderr so program stdout stays clean for pipes.
        traceSink: line => process.stderr.write(line + '\n')
      });
      interp.globals.define('argv', scriptArgs);

      try {
        interp.run(program, { filePath: file });
      } catch (e) {
        return failWith(asEmberError(e), src, colorInfo, file);
      }
      return EXIT_OK;
    }
  }
}
