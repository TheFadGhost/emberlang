// Golden tests: each example runs through the real CLI (bin/ember.js) as a
// child process and its stdout is compared byte-for-byte against output
// captured from actual runs of these exact files. The adventure example is
// driven by piped stdin; error fixtures check exit codes and diagnostic
// prefixes using throwaway programs under tmp-golden/.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ember = path.join(root, 'bin', 'ember.js');

function runExample(name, opts = {}) {
  return spawnSync(process.execPath, [ember, 'run', path.join('examples', name)], {
    cwd: root,
    encoding: 'utf8',
    ...opts
  });
}

const GOLDEN = {
  'hello.em': [
    'Hello from Ember',
    '6 * 7 = 42',
    'a + b is 13',
    ''
  ].join('\n'),

  'fizzbuzz.em': [
    '1',
    '2',
    '3 Fizz',
    '4',
    '5 Buzz',
    '6 Fizz',
    '7',
    '8',
    '9 Fizz',
    '10 Buzz',
    '11',
    '12 Fizz',
    '13',
    '14',
    '15 FizzBuzz',
    ''
  ].join('\n'),

  'fibonacci.em': [
    'fib(20) = 6765',
    'fibm(40) = 102334155',
    ''
  ].join('\n'),

  'closures.em': [
    'ticks: 1 2 3',
    'chimes: 101',
    'squares: [1, 4, 9]',
    ''
  ].join('\n'),

  'mapfilterreduce.em': [
    'words: ["pear", "fig", "plum", "cherry", "kiwi"]',
    'lengths: [4, 3, 4, 6, 4]',
    'long words: ["pear", "plum", "cherry", "kiwi"]',
    'total letters: 21',
    'shouty: ["PEAR", "PLUM", "CHERRY", "KIWI"]',
    ''
  ].join('\n')
};

// look -> go north -> go south -> go east -> go north wins in the grove;
// the win breaks the loop before another prompt is issued.
const ADVENTURE_INPUT = ['look', 'go north', 'go south', 'go east', 'go north'].join('\n') + '\n';
const ADVENTURE_GOLDEN = [
  'Find the ember stone. Commands: look, go <way>, quit.',
  'a sunlit clearing',
  'Soft grass and birdsong. Paths lead north and east.',
  'Exits: north, east',
  '> a sunlit clearing',
  'Soft grass and birdsong. Paths lead north and east.',
  'Exits: north, east',
  '> a cold cave',
  'Water drips in the dark. The clearing is back south.',
  'Exits: south',
  '> a sunlit clearing',
  'Soft grass and birdsong. Paths lead north and east.',
  'Exits: north, east',
  '> an old rope bridge',
  'The planks creak. A grove lies north, the clearing west.',
  'Exits: north, west',
  '> a hidden grove',
  'On the moss sits a stone that glows like an ember.',
  'You lift the ember stone. The quest is complete.',
  ''
].join('\n');

describe('golden examples', () => {
  for (const [name, expected] of Object.entries(GOLDEN)) {
    test('examples/' + name + ' prints exactly its golden output', () => {
      const r = runExample(name);
      assert.equal(r.status, 0, 'stderr was: ' + r.stderr);
      assert.strictEqual(r.stdout, expected);
    });
  }

  test('examples/adventure.em plays through a scripted session', () => {
    const r = runExample('adventure.em', { input: ADVENTURE_INPUT });
    assert.equal(r.status, 0, 'stderr was: ' + r.stderr);
    assert.strictEqual(r.stdout, ADVENTURE_GOLDEN);
  });
});

describe('golden error fixtures', () => {
  const tmp = path.join(root, 'tmp-golden');
  let parseErrFile;
  let runtimeErrFile;

  before(() => {
    fs.mkdirSync(tmp, { recursive: true });
    parseErrFile = path.join(tmp, 'parse-error.em');
    runtimeErrFile = path.join(tmp, 'runtime-error.em');
    fs.writeFileSync(parseErrFile, 'let x = (1 +\n');
    fs.writeFileSync(runtimeErrFile, 'print(1 / 0)\n');
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function runScratch(file) {
    return spawnSync(process.execPath, [ember, 'run', file], { cwd: root, encoding: 'utf8' });
  }

  test('parse error exits 65 with an E02 code and no JS stack', () => {
    const r = runScratch(parseErrFile);
    assert.equal(r.status, 65);
    assert.ok(r.stderr.includes('error[E02'), 'stderr was: ' + r.stderr);
    assert.ok(!r.stderr.includes('    at '), 'diagnostics must not contain JS stacks');
  });

  test('runtime error exits 70 with an E03 code', () => {
    const r = runScratch(runtimeErrFile);
    assert.equal(r.status, 70);
    assert.ok(r.stderr.includes('error[E03'), 'stderr was: ' + r.stderr);
  });

  test('missing file exits 2', () => {
    const r = runScratch(path.join('tmp-golden', 'no-such-file.em'));
    assert.equal(r.status, 2);
  });
});
