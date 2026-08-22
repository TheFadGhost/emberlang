#!/usr/bin/env node
// The REPL drives the event loop and ends with a natural exit (code 0);
// every other command returns an integer exit code handed to process.exit.
import { cliMain } from '../src/cli.js';

const code = cliMain(process.argv.slice(2));
if (typeof code === 'number') process.exit(code);
