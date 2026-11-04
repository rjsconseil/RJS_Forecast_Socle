// Langage de formule des chiffres présentés. Aucune évaluation de code : analyse puis
// interprétation d'un arbre. Une valeur inconnue (null) se propage : elle n'est jamais
// remplacée par zéro, sauf si la formule le demande explicitement avec `siInconnu(x, 0)`.
//
// Syntaxe : nombres (1.5), références (budget.revenusRealises, bpm.resultatPeriode),
// + - * / , parenthèses, comparaisons (> < >= <= == !=) et fonctions :
//   min(a, b, …)  max(a, b, …)  abs(x)  arrondi(x, n)  si(condition, alors, sinon)
//   siInconnu(x, valeur)  pourcentage(part, total)
import { fail } from '../errors.mjs';

const FUNCTIONS = {
  min: { arity: [1, 20], fn: (...a) => Math.min(...a) },
  max: { arity: [1, 20], fn: (...a) => Math.max(...a) },
  abs: { arity: [1, 1], fn: (x) => Math.abs(x) },
  arrondi: { arity: [1, 2], fn: (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n },
  pourcentage: { arity: [2, 2], fn: (p, t) => (t === 0 ? null : (p / t) * 100) },
  si: { arity: [3, 3], lazy: true },
  siInconnu: { arity: [2, 2], lazy: true },
};

export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS);

// ---------- analyse ----------

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-zÀ-ÿ_][\wÀ-ÿ]*(?:\.[A-Za-zÀ-ÿ_][\wÀ-ÿ]*)*)|(>=|<=|==|!=|[-+*/(),<>]))/y;
  let m;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new Error(`Caractère inattendu à la position ${pos + 1} : « ${src.slice(pos).trim()[0]} »`);
    }
    pos = re.lastIndex;
    if (m[1]) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2]) tokens.push({ t: 'id', v: m[2] });
    else if (m[3]) tokens.push({ t: 'op', v: m[3] });
  }
  return tokens;
}

export function parseFormula(src) {
  if (typeof src !== 'string' || !src.trim()) fail('FORMULA_INVALID', 'La formule est vide.');
  let tokens;
  try {
    tokens = tokenize(src);
  } catch (e) {
    fail('FORMULA_INVALID', e.message);
  }
  let i = 0;
  const peek = () => tokens[i];
  const take = (v) => {
    const t = tokens[i];
    if (!t || (v && t.v !== v)) fail('FORMULA_INVALID', `« ${v ?? 'expression'} » attendu${t ? ` au lieu de « ${t.v} »` : ' en fin de formule'}.`);
    i += 1;
    return t;
  };

  const comparison = () => {
    let node = additive();
    while (peek() && ['>', '<', '>=', '<=', '==', '!='].includes(peek().v)) {
      const op = take().v;
      node = { type: 'bin', op, left: node, right: additive() };
    }
    return node;
  };
  const additive = () => {
    let node = term();
    while (peek() && ['+', '-'].includes(peek().v)) {
      const op = take().v;
      node = { type: 'bin', op, left: node, right: term() };
    }
    return node;
  };
  const term = () => {
    let node = unary();
    while (peek() && ['*', '/'].includes(peek().v)) {
      const op = take().v;
      node = { type: 'bin', op, left: node, right: unary() };
    }
    return node;
  };
  const unary = () => {
    if (peek()?.v === '-') {
      take('-');
      return { type: 'neg', arg: unary() };
    }
    return primary();
  };
  const primary = () => {
    const t = peek();
    if (!t) fail('FORMULA_INVALID', 'Formule incomplète.');
    if (t.t === 'num') return take() && { type: 'num', value: t.v };
    if (t.v === '(') {
      take('(');
      const e = comparison();
      take(')');
      return e;
    }
    if (t.t === 'id') {
      take();
      if (peek()?.v === '(') {
        const def = FUNCTIONS[t.v];
        if (!def) fail('FORMULA_INVALID', `Fonction inconnue : ${t.v}. Fonctions admises : ${FORMULA_FUNCTIONS.join(', ')}.`);
        take('(');
        const args = [];
        if (peek()?.v !== ')') {
          args.push(comparison());
          while (peek()?.v === ',') {
            take(',');
            args.push(comparison());
          }
        }
        take(')');
        if (args.length < def.arity[0] || args.length > def.arity[1]) fail('FORMULA_INVALID', `Nombre d'arguments incorrect pour ${t.v}.`);
        return { type: 'call', name: t.v, args };
      }
      return { type: 'ref', name: t.v };
    }
    fail('FORMULA_INVALID', `Élément inattendu : « ${t.v} ».`);
  };

  const ast = comparison();
  if (i < tokens.length) fail('FORMULA_INVALID', `Élément inattendu : « ${tokens[i].v} ».`);
  return ast;
}

export function referencesOf(ast, acc = new Set()) {
  if (ast.type === 'ref') acc.add(ast.name);
  if (ast.type === 'bin') referencesOf(ast.left, acc), referencesOf(ast.right, acc);
  if (ast.type === 'neg') referencesOf(ast.arg, acc);
  if (ast.type === 'call') ast.args.forEach((a) => referencesOf(a, acc));
  return acc;
}

// ---------- évaluation ----------

/** Évalue l'arbre ; `resolve(name)` renvoie la valeur (number|null) d'une référence. */
export function evaluate(ast, resolve) {
  switch (ast.type) {
    case 'num':
      return ast.value;
    case 'ref':
      return resolve(ast.name);
    case 'neg': {
      const v = evaluate(ast.arg, resolve);
      return v === null ? null : -v;
    }
    case 'bin': {
      const a = evaluate(ast.left, resolve);
      const b = evaluate(ast.right, resolve);
      if (a === null || b === null) return null;
      switch (ast.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : a / b;
        case '>': return a > b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
      }
      return null;
    }
    case 'call': {
      if (ast.name === 'si') {
        const c = evaluate(ast.args[0], resolve);
        if (c === null) return null;
        return evaluate(c ? ast.args[1] : ast.args[2], resolve);
      }
      if (ast.name === 'siInconnu') {
        const v = evaluate(ast.args[0], resolve);
        return v === null ? evaluate(ast.args[1], resolve) : v;
      }
      const args = ast.args.map((a) => evaluate(a, resolve));
      if (args.some((v) => v === null)) return null;
      const r = FUNCTIONS[ast.name].fn(...args);
      return r === null || !Number.isFinite(r) ? null : r;
    }
  }
  return null;
}

/** Restitue la formule avec les valeurs substituées, pour l'explication affichée. */
export function substitute(ast, valueOf, fmt) {
  const s = (n) => substitute(n, valueOf, fmt);
  switch (ast.type) {
    case 'num': return String(ast.value);
    case 'ref': return fmt(valueOf(ast.name));
    case 'neg': return `−${s(ast.arg)}`;
    case 'bin': return `(${s(ast.left)} ${ast.op === '-' ? '−' : ast.op === '*' ? '×' : ast.op === '/' ? '÷' : ast.op} ${s(ast.right)})`;
    case 'call': return `${ast.name}(${ast.args.map(s).join(', ')})`;
  }
  return '?';
}
