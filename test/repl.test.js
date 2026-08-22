// Pure unit tests for the REPL helpers and the shared token dump format.
// No spawning, no interactive stdin: only imports and direct calls.

import test from 'node:test';
import assert from 'node:assert/strict';

import { needsContinuation, extractCommand, makeCompleter } from '../src/repl.js';
import { formatToken } from '../src/cli.js';
import { unexpectedEOF, syntaxError, CODES } from '../src/errors.js';
import { tokenize } from '../src/lexer.js';

test('needsContinuation is true for UnexpectedEOF errors', () => {
  const err = unexpectedEOF('unexpected end of input', { line: 1, col: 2, endCol: 2 }, '<test>');
  assert.equal(err.eof, true);
  assert.equal(needsContinuation(err), true);
});

test('needsContinuation is false for plain syntax errors', () => {
  const err = syntaxError(CODES.UNEXPECTED_TOKEN, 'unexpected `)`', { line: 1, col: 1, endCol: 2 }, '<test>');
  assert.equal(err.eof, undefined);
  assert.equal(needsContinuation(err), false);
});

test('needsContinuation is false for null and foreign errors', () => {
  assert.equal(needsContinuation(null), false);
  assert.equal(needsContinuation(new Error('boom')), false);
});

test('extractCommand parses colon commands', () => {
  assert.deepEqual(extractCommand(':help'), { name: 'help', arg: '' });
  assert.deepEqual(extractCommand('  :env '), { name: 'env', arg: '' });
  assert.deepEqual(extractCommand(':tokens let x = 1'), { name: 'tokens', arg: 'let x = 1' });
});

test('extractCommand rejects non-command lines', () => {
  assert.equal(extractCommand('let x = 1'), null);
});

test('extractCommand treats a bare colon as an empty command name', () => {
  assert.deepEqual(extractCommand(':'), { name: '', arg: '' });
});

test('makeCompleter offers identifier completions from names and builtins', () => {
  const complete = makeCompleter(['xs', 'ys'], ['print', 'push', 'len']);
  const [all, wordAll] = complete('p');
  assert.equal(wordAll, 'p');
  assert.ok(all.includes('print'));
  assert.ok(all.includes('push'));
  assert.ok(!all.includes('len'));
  const [single, wordSingle] = complete('pu');
  assert.equal(wordSingle, 'pu');
  assert.deepEqual(single, ['push']);
});

test('makeCompleter offers command completions for colon input', () => {
  const complete = makeCompleter([], []);
  const [hits, word] = complete(':e');
  assert.equal(word, ':e');
  assert.deepEqual([...hits].sort(), [':env', ':exit']);
});

test('makeCompleter returns the readline [[hits], remainder] shape with no hits for junk', () => {
  const complete = makeCompleter(['a'], ['b']);
  const result = complete('%$');
  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], []);
});

test('formatToken renders an INT exactly per the contract', () => {
  const tok = tokenize('42', '<test>')[0];
  assert.equal(formatToken(tok), 'INT      `42` @ 1.1-1.3');
});

test('formatToken JSON-quotes STRING values inside backticks', () => {
  const tok = tokenize('"hi"', '<test>')[0];
  assert.equal(formatToken(tok), 'STRING   `"hi"` @ 1.1-1.5');
});

test('formatToken renders KEYWORD and the trailing EOF token', () => {
  const toks = tokenize('let', '<test>');
  assert.equal(formatToken(toks[0]), 'KEYWORD  `let` @ 1.1-1.4');
  assert.equal(toks[toks.length - 1].type, 'EOF');
  assert.equal(formatToken(toks[toks.length - 1]), 'EOF      `null` @ 1.4-1.4');
});
