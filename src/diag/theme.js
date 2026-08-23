// Theme tokens: the ONLY place ANSI codes exist in the codebase.
// Two themes, one token table each, semantic roles only — see DESIGN.md.

const R = '\x1b[0m';

export const THEMES = {
  dark: {
    error: '\x1b[1;31m',      // bold red
    warning: '\x1b[1;33m',    // bold yellow
    help: '\x1b[32m',         // green
    literal: '\x1b[36m',      // cyan
    caret: '\x1b[31m',        // red
    gutter: '\x1b[90m',       // bright black
    result: '\x1b[96m',       // bright cyan
    prompt: '\x1b[35m',       // magenta
    promptCont: '\x1b[90m'    // bright black
  },
  light: {
    error: '\x1b[31m',        // red (bold washes out on light backgrounds)
    warning: '\x1b[33m',      // yellow
    help: '\x1b[32m',         // green
    literal: '\x1b[34m',      // blue (cyan is low-contrast on white)
    caret: '\x1b[31m',        // red
    gutter: '\x1b[90m',       // bright black
    result: '\x1b[94m',       // bright blue
    prompt: '\x1b[35m',       // magenta
    promptCont: '\x1b[90m'    // bright black
  }
};

export const THEME_NAMES = Object.keys(THEMES);

function colourOff() {
  return { enabled: false, themeName: 'none', paint: (_role, text) => text };
}

// Degradation order from DESIGN.md: --no-color flag, NO_COLOR env,
// TERM=dumb, non-TTY stream; otherwise on, theme resolved from explicit
// name > EMBER_THEME > dark. Unknown names warn once and fall back to dark.
export function resolveTheme({ noColorFlag = false, themeName = null, stream = process.stdout, env = process.env } = {}) {
  if (noColorFlag) return colourOff();
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return colourOff();
  if ((env.TERM || '') === 'dumb') return colourOff();
  if (!stream || !stream.isTTY) return colourOff();

  let chosen = themeName ?? env.EMBER_THEME ?? 'dark';
  if (!THEME_NAMES.includes(chosen)) {
    // Warnings go to stderr regardless of which stream colour detection
    // used; stdout stays reserved for program output.
    process.stderr.write('warning: unknown theme `' + chosen + '`, using `dark`; valid themes: ' + THEME_NAMES.join(', ') + '\n');
    chosen = 'dark';
  }
  const codes = THEMES[chosen];
  return {
    enabled: true,
    themeName: chosen,
    paint(role, text) {
      const c = codes[role];
      return c ? c + text + R : text;
    }
  };
}
