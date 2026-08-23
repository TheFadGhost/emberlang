// AST node factories and the text dumper used by `:ast` / `ember ast`.
// Nodes are plain objects: {kind, line, col, endCol, ...fields}.

function node(kind, span, fields = {}) {
  return {
    kind,
    line: span.line,
    col: span.col,
    endCol: span.endCol ?? span.col,
    ...fields
  };
}

export const Program = (span, body) => node('Program', span, { body });
export const LetStmt = (span, f) => node('LetStmt', span, f);          // {name, nameTok, value}
export const AssignStmt = (span, f) => node('AssignStmt', span, f);    // {target, op, value}
export const ExprStmt = (span, f) => node('ExprStmt', span, f);        // {expr}
export const IfStmt = (span, f) => node('IfStmt', span, f);            // {branches:[{cond,body}], elseBody}
export const WhileStmt = (span, f) => node('WhileStmt', span, f);      // {cond, body}
export const ForStmt = (span, f) => node('ForStmt', span, f);          // {name, iter, body}
export const FnDecl = (span, f) => node('FnDecl', span, f);            // {name, params, body}
export const ReturnStmt = (span, f) => node('ReturnStmt', span, f ?? {}); // {value|null}
export const BreakStmt = (span) => node('BreakStmt', span);
export const ContinueStmt = (span) => node('ContinueStmt', span);
export const Block = (span, body) => node('Block', span, { body });

export const BinOp = (span, f) => node('BinOp', span, f);              // {op, left, right}
export const UnOp = (span, f) => node('UnOp', span, f);                // {op, operand}
export const Call = (span, f) => node('Call', span, f);                // {callee, args}
export const Index = (span, f) => node('Index', span, f);              // {obj, index}
export const Slice = (span, f) => node('Slice', span, f);              // {obj, low, high}
export const RangeLit = (span, f) => node('RangeLit', span, f);        // {low, high}
export const ArrLit = (span, f) => node('ArrLit', span, f);            // {items[]}
export const MapLit = (span, f) => node('MapLit', span, f);            // {entries: [{key, value}]}

export const Ident = (span, f) => node('Ident', span, f);              // {name, tok}
export const NumLit = (span, f) => node('NumLit', span, f);            // {value, isInt}
export const StrLit = (span, f) => node('StrLit', span, f);            // {value}
export const BoolLit = (span, f) => node('BoolLit', span, f);          // {value}
export const NullLit = (span) => node('NullLit', span);
export const FnExpr = (span, f) => node('FnExpr', span, f);            // {params, body}

// Render the AST as an indented tree, one node per line. Used by :ast,
// `ember ast`, and parser tests that assert tree shape.
export function astDump(root) {
  const out = [];
  walk(root, 0);
  return out.join('\n');

  function label(n) {
    switch (n.kind) {
      case 'Program': return 'Program';
      case 'LetStmt': return 'LetStmt name=' + n.name;
      case 'AssignStmt': return 'AssignStmt op=' + n.op;
      case 'ExprStmt': return 'ExprStmt';
      case 'IfStmt': {
        let s = 'IfStmt branches=' + n.branches.length + (n.elseBody ? ' else' : '');
        return s;
      }
      case 'WhileStmt': return 'WhileStmt';
      case 'ForStmt': return 'ForStmt name=' + n.name;
      case 'FnDecl': return 'FnDecl name=' + n.name + ' params=[' + n.params.map(p => p.name).join(', ') + ']';
      case 'ReturnStmt': return n.value ? 'ReturnStmt' : 'ReturnStmt null';
      case 'BreakStmt': return 'BreakStmt';
      case 'ContinueStmt': return 'ContinueStmt';
      case 'Block': return 'Block stmts=' + n.body.length;
      case 'BinOp': return 'BinOp ' + n.op;
      case 'UnOp': return 'UnOp ' + n.op;
      case 'Call': return 'Call args=' + n.args.length;
      case 'Index': return 'Index';
      case 'Slice': return 'Slice';
      case 'RangeLit': return 'RangeLit';
      case 'ArrLit': return 'ArrLit items=' + n.items.length;
      case 'MapLit': return 'MapLit entries=' + n.entries.length;
      case 'Ident': return 'Ident ' + n.name;
      case 'NumLit': return 'NumLit ' + String(n.value) + (n.isInt ? '' : 'f');
      case 'StrLit': return 'StrLit ' + JSON.stringify(n.value);
      case 'BoolLit': return 'BoolLit ' + String(n.value);
      case 'NullLit': return 'NullLit';
      case 'FnExpr': return 'FnExpr params=[' + n.params.map(p => p.name).join(', ') + ']';
      default: return n.kind;
    }
  }

  function children(n) {
    switch (n.kind) {
      case 'Program':
      case 'Block':
        return [...n.body];
      case 'LetStmt':
        return [n.value];
      case 'AssignStmt':
        return [n.target, n.value];
      case 'ExprStmt':
        return [n.expr];
      case 'IfStmt': {
        const kids = [];
        for (const br of n.branches) kids.push(br.cond, br.body);
        if (n.elseBody) kids.push(n.elseBody);
        return kids;
      }
      case 'WhileStmt':
        return [n.cond, n.body];
      case 'ForStmt':
        return [n.iter, n.body];
      case 'FnDecl':
        return [n.body];
      case 'ReturnStmt':
        return n.value ? [n.value] : [];
      case 'BreakStmt':
      case 'ContinueStmt':
        return [];
      case 'BinOp':
        return [n.left, n.right];
      case 'UnOp':
        return [n.operand];
      case 'Call':
        return [n.callee, ...n.args];
      case 'Index':
        return [n.obj, n.index];
      case 'Slice':
        return [n.obj, ...(n.low ? [n.low] : []), ...(n.high ? [n.high] : [])];
      case 'RangeLit':
        return [n.low, n.high];
      case 'ArrLit':
        return [...n.items];
      case 'MapLit':
        return n.entries.flatMap(en => [en.key, en.value]);
      case 'Ident':
      case 'NumLit':
      case 'StrLit':
      case 'BoolLit':
      case 'NullLit':
        return [];
      case 'FnExpr':
        return [n.body];
      default:
        return [];
    }
  }

  function walk(n, depth) {
    out.push('  '.repeat(depth) + label(n));
    for (const c of children(n)) walk(c, depth + 1);
  }
}
