// Diagnostic renderer: turns EmberError-shaped data into the block defined
// in DESIGN.md. Owns all display-width arithmetic (tabs, CJK widths) so
// caret spans are exact, not approximate. Never prints; returns strings.

const TAB_STOP = 4;
const MAX_WIDTH = 120;   // display cells before elision
const HEAD_CELLS = 72;   // kept from line start when eliding
const TAIL_CELLS = 45;   // kept from line end when eliding
const MARKER = '...';

// Approximate display width of a code point: 2 for East Asian Wide and
// Fullwidth forms, 0 for common combining marks and variation selectors,
// 1 otherwise. Good enough for alignment; not a full wcwidth.
export function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp === 0) return 0;
  if (
    (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xfe20 && cp <= 0xfe2f)
  ) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2;
  return 1;
}

export function displayWidth(text) {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w;
}

// Substring of `text` covering display cells [fromCell, toCell). A wide or
// combining character straddling a boundary is dropped, never split.
function sliceCells(text, fromCell, toCell) {
  let out = '';
  let disp = 0;
  for (const ch of text) {
    const w = charWidth(ch);
    if (disp >= fromCell && disp + w <= toCell) out += ch;
    disp += w;
    if (disp >= toCell) break;
  }
  return out;
}

// Expand tabs to TAB_STOP stops for display. Returns the expanded text plus
// colMap: colMap[i] is the display column of original code point i, and
// colMap[n] (n = code point count) is one past its last cell.
export function expandLine(rawLine) {
  const units = Array.from(rawLine);
  let disp = 0;
  let text = '';
  const colMap = new Array(units.length + 1);
  for (let i = 0; i < units.length; i++) {
    const ch = units[i];
    colMap[i] = disp;
    if (ch === '\t') {
      const advance = TAB_STOP - (disp % TAB_STOP);
      text += ' '.repeat(advance);
      disp += advance;
    } else {
      text += ch;
      disp += charWidth(ch);
    }
  }
  colMap[units.length] = disp;
  return { text, colMap };
}

function splitLines(sourceText) {
  return sourceText.split('\n').map(l => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

// Paint backticked terms in `message` with the literal role. Unbalanced
// backticks degrade to plain text rather than crashing.
function paintMessage(message, paint) {
  if (!paint) return message;
  let out = '';
  let rest = message;
  for (;;) {
    const open = rest.indexOf('`');
    if (open === -1) { out += rest; break; }
    const close = rest.indexOf('`', open + 1);
    if (close === -1) { out += rest; break; }
    out += rest.slice(0, open);
    out += paint('literal', '`' + rest.slice(open + 1, close) + '`');
    rest = rest.slice(close + 1);
  }
  return out;
}

function paintOrPlain(paint, role, text) {
  return paint ? paint(role, text) : text;
}

// Render one diagnostic to a string ending with a newline. d fields:
// severity ('error'|'warning'|'internal'), kind, code, message, filePath,
// line, col, endCol (code-point columns, 1-based), help.
export function renderDiagnostic(d, sourceText, colorInfo) {
  const paint = colorInfo && colorInfo.enabled ? colorInfo.paint : null;
  const severityWord = d.severity ?? 'error';
  // `internal` shares the error role's colour; there is no separate theme
  // entry because it is still an error to the user.
  const severityRole = severityWord === 'internal' ? 'error' : severityWord;
  const out = [];

  out.push(
    paintOrPlain(paint, severityRole, severityWord) +
    '[' + d.code + ']: ' +
    paintMessage(d.message ?? '', paint)
  );

  const hasLocation = Number.isInteger(d.line);
  if (hasLocation && d.filePath) {
    out.push(paintOrPlain(paint, 'gutter', '  --> ' + d.filePath + ':' + d.line + ':' + d.col));
  }

  if (hasLocation && typeof sourceText === 'string') {
    const lines = splitLines(sourceText);
    const rawLine = lines[d.line - 1] ?? '';
    const numWidth = String(d.line).length;
    const gutterRow = ' '.repeat(numWidth) + ' |';
    const rowPrefix = String(d.line).padStart(numWidth) + ' | ';

    const { text: expandedRaw, colMap } = expandLine(rawLine);

    // Elide very long lines while keeping excerpt/caret aligned: display
    // columns beyond the cut shift left; columns inside the hidden middle
    // clamp onto the marker so carets never point into thin air silently.
    let expanded = expandedRaw;
    let remap = (c) => c;
    const totalW = displayWidth(expandedRaw);
    if (totalW > MAX_WIDTH) {
      const headText = sliceCells(expandedRaw, 0, HEAD_CELLS);
      const tailStart = totalW - TAIL_CELLS;
      const tailText = sliceCells(expandedRaw, tailStart, totalW);
      const headW = displayWidth(headText);
      expanded = headText + MARKER + tailText;
      remap = (c) =>
        c <= headW ? c
          : c >= tailStart ? headW + MARKER.length + (c - tailStart)
            : headW;
    }

    const totalAfter = displayWidth(expanded);
    const at = (cpIdx) => colMap[Math.min(Math.max(cpIdx, 0), colMap.length - 1)];
    // Remap raw display columns through the elision FIRST (its thresholds
    // are in raw coordinates), then clamp to the rendered width.
    let startDisp = Math.min(remap(at(d.col - 1)), totalAfter);
    let endDisp = Math.min(remap(at(d.endCol - 1)), totalAfter);
    endDisp = Math.max(startDisp + 1, endDisp);

    out.push(paintOrPlain(paint, 'gutter', gutterRow));
    out.push(paintOrPlain(paint, 'gutter', rowPrefix) + expanded);
    out.push(
      paintOrPlain(paint, 'gutter', ' '.repeat(numWidth) + ' | ') +
      ' '.repeat(startDisp) +
      paintOrPlain(paint, 'caret', '^'.repeat(endDisp - startDisp))
    );
    if (d.help) out.push(paintOrPlain(paint, 'gutter', gutterRow));
  }

  if (d.help) {
    out.push((paint ? paint('help', 'help: ') : 'help: ') + d.help);
  }

  if (severityWord === 'internal') {
    out.push('');
    out.push('this is a bug in Ember, not in your program');
  }

  // DESIGN.md: a blank line follows every diagnostic block.
  return out.join('\n') + '\n\n';
}

// Convenience wrapper reading fields off an EmberError-like object.
// Builtin-raised errors carry call-site spans but no filePath; the front
// ends pass their filename here so every block gets its location line.
export function renderError(err, sourceText, colorInfo, defaultPath = null) {
  if (!err.filePath && err.line != null) err.filePath = defaultPath;
  return renderDiagnostic(
    {
      severity: err.kind === 'internal' ? 'internal' : 'error',
      kind: err.kind,
      code: err.code,
      message: err.message,
      filePath: err.filePath,
      line: err.line,
      col: err.col,
      endCol: err.endCol,
      help: err.help
    },
    sourceText,
    colorInfo
  );
}
