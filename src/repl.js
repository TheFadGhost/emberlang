// REPL: persistent-session interactive loop plus pure helpers shared with
// tests (continuation detection, colon commands, tab completion). Errors
// render through the shared renderer with the filename `<repl>`.

import readline from 'node:readline';
import { tokenize } from './lexer.js';
import { parse } from './parser.js';
import { Interpreter } from './interpreter.js';
import { astDump } from './ast.js';
import { Env } from './interp/env.js';
import { installBuiltins } from './builtins.js';
import { repr } from './interp/values.js';
import { EmberError, internalError } from './errors.js';
import { resolveTheme } from './diag/theme.js';
import { renderError } from './diag/render.js';
import { formatToken } from './cli.js';

const REPL_COMMANDS = [':ast', ':env', ':exit', ':help', ':quit', ':reset', ':tokens'];

// True only for the parser's unexpected-end-of-input error (E0202), the one
// failure that means "keep buffering" rather than "report".
export function needsContinuation(err) {
  return Boolean(err && err.eof === true);
}

// Split a `:name rest...` line after trimming; null when the line is not a
// command. A bare `:` yields an empty name so dispatch can report it.
export function extractCommand(line) {
  const t = line.trim();
  if (!t.startsWith(':')) return null;
  const body = t.slice(1);
  const gap = body.search(/\s/);
  if (gap === -1) return { name: body, arg: '' };
  return { name: body.slice(0, gap), arg: body.slice(gap + 1).trim() };
}

// readline-style completer over identifiers (names + builtins), or over the
// colon commands when the word being completed starts with `:`.
export function makeCompleter(names, builtins) {
  const words = [...new Set([...names, ...builtins])].sort();
  return function complete(line) {
    if (line.startsWith(':')) {
      return [REPL_COMMANDS.filter(c => c.startsWith(line)), line];
    }
    const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(line);
    if (!m) return [[], line];
    const word = m[0];
    return [words.filter(w => w.startsWith(word)), word];
  };
}

// Top-level statements run directly against globals (run()'s `env` option)
// so bindings accumulate across inputs; scripts get a fresh child scope.

function builtinNames() {
  const env = new Env();
  installBuiltins(env);
  return [...env.vars.keys()];
}

function freshInterpreter() {
  const ix = new Interpreter({ trace: false });
  ix.globals.define('argv', []);
  return ix;
}

const HELP_LINES = [
  'commands:',
  '  :help          list the REPL commands',
  '  :tokens CODE   print the token stream of CODE',
  '  :ast CODE      print the syntax tree of CODE',
  '  :env           list the bindings in scope',
  '  :reset         start a fresh interpreter',
  '  :exit          leave the REPL, as do :quit and Ctrl+D',
  ''
].join('\n');

function toRenderable(e) {
  return e instanceof EmberError ? e : internalError(String((e && e.message) || e));
}

// Run the interactive loop until stdin closes. Returns an exit code only on
// early failure; otherwise the loop ends with a natural process exit of 0.
export function startRepl({ version, noColorFlag = false, themeName = null }) {
  const colorInfo = resolveTheme({ noColorFlag, themeName, stream: process.stdout });
  const paint = colorInfo.paint;
  const out = s => process.stdout.write(s);
  const errOut = s => process.stderr.write(s);

  out('Ember ' + version + ' — type :help for commands\n');

  let interp = freshInterpreter();
  const completion = { names: interp.globals.names() };
  let buffer = '';
  const tty = Boolean(process.stdin.isTTY);

  const MAIN_PROMPT = paint('prompt', '>> ');
  const CONT_PROMPT = paint('promptCont', '.. ');
  const setMainPrompt = () => rl.setPrompt(MAIN_PROMPT);
  const setContPrompt = () => rl.setPrompt(CONT_PROMPT);
  // Piped input degrades silently: same behaviour, no painted prompts.
  const showPrompt = () => {
    if (tty) rl.prompt();
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: MAIN_PROMPT,
    completer: line => makeCompleter(completion.names, builtinNames())(line)
  });

  const execute = (program, src) => {
    try {
      const value = interp.run(program, { filePath: '<repl>', env: interp.globals });
      if (value !== null) out(paint('result', '= ' + repr(value)) + '\n');
    } catch (e) {
      const err = toRenderable(e);
      if (!err.filePath) err.filePath = '<repl>'; // builtin errors carry spans but no path
      errOut(renderError(err, src, colorInfo));
    }
  };

  const handleCommand = raw => {
    const cmd = extractCommand(raw);
    if (cmd.name === '') {
      errOut(paint('error', 'unknown command `:`; try :help') + '\n');
    } else {
      switch (cmd.name) {
        case 'help':
          out(HELP_LINES);
          break;
        case 'tokens':
          try {
            out(tokenize(cmd.arg, '<repl>').map(formatToken).join('\n') + '\n');
          } catch (e) {
            errOut(renderError(toRenderable(e), cmd.arg, colorInfo));
          }
          break;
        case 'ast':
          try {
            out(astDump(parse(tokenize(cmd.arg, '<repl>'), '<repl>')) + '\n');
          } catch (e) {
            errOut(renderError(toRenderable(e), cmd.arg, colorInfo));
          }
          break;
        case 'env':
          for (const name of interp.globals.names()) {
            const v = interp.globals.get(name, null, null);
            if (v && v.__native) continue;
            out(name + ' = ' + repr(v) + '\n');
          }
          break;
        case 'reset':
          interp = freshInterpreter();
          completion.names = interp.globals.names();
          break;
        case 'exit':
        case 'quit':
          rl.close();
          return;
        default:
          errOut(paint('error', 'unknown command `:' + cmd.name + '`; try :help') + '\n');
      }
    }
    showPrompt();
  };

  rl.on('line', text => {
    const line = text.replace(/\r$/, '');

    if (buffer === '' && line.trim().startsWith(':')) {
      handleCommand(line);
      return;
    }

    if (line.trim() === '') {
      if (buffer !== '') {
        buffer = '';
        setMainPrompt();
      }
      showPrompt();
      return;
    }

    buffer = buffer === '' ? line : buffer + '\n' + line;
    let program;
    try {
      program = parse(tokenize(buffer, '<repl>'), '<repl>');
    } catch (e) {
      if (needsContinuation(e)) {
        setContPrompt();
        showPrompt();
        return;
      }
      errOut(renderError(toRenderable(e), buffer, colorInfo));
      buffer = '';
      setMainPrompt();
      showPrompt();
      return;
    }

    const src = buffer;
    buffer = '';
    setMainPrompt();
    execute(program, src);
    completion.names = interp.globals.names();
    showPrompt();
  });

  rl.on('SIGINT', () => {
    if (buffer === '') {
      rl.close();
      return;
    }
    buffer = '';
    setMainPrompt();
    out('\n');
    showPrompt();
  });

  setMainPrompt();
  showPrompt();
}
