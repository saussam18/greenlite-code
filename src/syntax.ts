// Simple regex-based syntax highlighting for code display.
// Returns an array of { text, color } spans for a single line.
// Colors follow VS Code's dark theme palette.

export interface Token {
  text: string;
  color: string;
}

type Rule = [RegExp, string];

const COLORS = {
  keyword: "#c586c0",
  declaration: "#569cd6",
  string: "#ce9178",
  comment: "#6a9955",
  number: "#b5cea8",
  type: "#4ec9b0",
  function: "#dcdcaa",
  punctuation: "#d4d4d4",
  default: "#d4d4d4",
};

const JS_KEYWORDS =
  "break|case|catch|continue|debugger|default|do|else|finally|for|if|return|switch|throw|try|while|yield|await|async|new|delete|typeof|void|in|of|instanceof";
const JS_DECLARATIONS =
  "const|let|var|function|class|extends|implements|import|export|from|as|default|interface|type|enum|namespace|module|declare|abstract|readonly";
const JS_CONSTANTS = "true|false|null|undefined|NaN|Infinity|this|super";

const RUST_KEYWORDS =
  "as|break|continue|else|enum|extern|for|if|impl|in|loop|match|move|mut|ref|return|self|Self|static|struct|trait|type|unsafe|use|where|while|async|await|dyn|yield";
const RUST_DECLARATIONS =
  "const|crate|fn|let|mod|pub|static|struct|trait|type|use|extern|impl|enum";
const RUST_CONSTANTS = "true|false|None|Some|Ok|Err|self|Self";
const RUST_TYPES =
  "bool|char|f32|f64|i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|str|String|Vec|Option|Result|Box|Rc|Arc|HashMap|HashSet|BTreeMap|BTreeSet";

function buildRules(lang: "js" | "rust" | "json"): Rule[] {
  if (lang === "json") {
    return [
      // Strings (keys and values)
      [/^"(?:[^"\\]|\\.)*"(?=\s*:)/, COLORS.type],      // keys
      [/^"(?:[^"\\]|\\.)*"/, COLORS.string],              // string values
      // Numbers
      [/^-?[\d][\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?/, COLORS.number],
      // Booleans and null
      [/^(?:true|false|null)\b/, COLORS.declaration],
      // Punctuation
      [/^[{}()\[\];,:]+/, COLORS.punctuation],
      // Whitespace
      [/^\s+/, COLORS.default],
      // Anything else
      [/^./, COLORS.default],
    ];
  }

  if (lang === "js") {
    return [
      // Comments
      [/^\/\/.*$/, COLORS.comment],
      [/^\/\*[\s\S]*?\*\//, COLORS.comment],
      // Template literals (simplified — just the backtick string)
      [/^`(?:[^`\\]|\\.)*`/, COLORS.string],
      // Strings
      [/^"(?:[^"\\]|\\.)*"/, COLORS.string],
      [/^'(?:[^'\\]|\\.)*'/, COLORS.string],
      // Numbers
      [/^(?:0[xXbBoO])?[\d][\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?n?/, COLORS.number],
      // JSX/type annotations — capitalized identifiers as types
      [/^[A-Z][A-Za-z0-9_]*/, COLORS.type],
      // Declarations
      [new RegExp(`^\\b(?:${JS_DECLARATIONS})\\b`), COLORS.declaration],
      // Keywords
      [new RegExp(`^\\b(?:${JS_KEYWORDS})\\b`), COLORS.keyword],
      // Constants
      [new RegExp(`^\\b(?:${JS_CONSTANTS})\\b`), COLORS.declaration],
      // Function calls: word followed by (
      [/^[a-zA-Z_$][\w$]*(?=\s*\()/, COLORS.function],
      // Identifiers
      [/^[a-zA-Z_$][\w$]*/, COLORS.default],
      // Operators and punctuation
      [/^[{}()\[\];,.:?!&|<>=+\-*/%~^@#]+/, COLORS.punctuation],
      // Whitespace
      [/^\s+/, COLORS.default],
      // Anything else
      [/^./, COLORS.default],
    ];
  }

  // Rust
  return [
    // Comments
    [/^\/\/.*$/, COLORS.comment],
    [/^\/\*[\s\S]*?\*\//, COLORS.comment],
    // Attributes
    [/^#!?\[[\s\S]*?\]/, COLORS.keyword],
    // Raw strings
    [/^r#*"[\s\S]*?"#*/, COLORS.string],
    // Strings
    [/^"(?:[^"\\]|\\.)*"/, COLORS.string],
    // Char literals
    [/^'(?:[^'\\]|\\.)'/, COLORS.string],
    // Lifetime annotations
    [/^'[a-zA-Z_]\w*/, COLORS.keyword],
    // Numbers
    [/^(?:0[xXbBoO])?[\d][\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?(?:_?(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64))?/, COLORS.number],
    // Known types
    [new RegExp(`^\\b(?:${RUST_TYPES})\\b`), COLORS.type],
    // Capitalized identifiers as types
    [/^[A-Z][A-Za-z0-9_]*/, COLORS.type],
    // Declarations
    [new RegExp(`^\\b(?:${RUST_DECLARATIONS})\\b`), COLORS.declaration],
    // Keywords
    [new RegExp(`^\\b(?:${RUST_KEYWORDS})\\b`), COLORS.keyword],
    // Constants
    [new RegExp(`^\\b(?:${RUST_CONSTANTS})\\b`), COLORS.declaration],
    // Macros: word!
    [/^[a-zA-Z_]\w*!/, COLORS.function],
    // Function calls: word followed by (
    [/^[a-zA-Z_]\w*(?=\s*\()/, COLORS.function],
    // Identifiers
    [/^[a-zA-Z_]\w*/, COLORS.default],
    // Operators and punctuation
    [/^[{}()\[\];,.:?!&|<>=+\-*/%~^@#]+/, COLORS.punctuation],
    // Whitespace
    [/^\s+/, COLORS.default],
    // Anything else
    [/^./, COLORS.default],
  ];
}

export type Language = "js" | "rust" | "json" | null;

export function detectLanguage(filePath: string): Language {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
    case "mjs":
    case "cjs":
    case "mts":
    case "cts":
      return "js";
    case "rs":
      return "rust";
    case "json":
    case "jsonc":
      return "json";
    default:
      return null;
  }
}

const rulesCache = new Map<string, Rule[]>();

function getRules(lang: "js" | "rust" | "json"): Rule[] {
  if (!rulesCache.has(lang)) {
    rulesCache.set(lang, buildRules(lang));
  }
  return rulesCache.get(lang)!;
}

export function tokenizeLine(line: string, lang: Language): Token[] {
  if (!lang) {
    return [{ text: line, color: COLORS.default }];
  }

  const rules = getRules(lang);
  const tokens: Token[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    let matched = false;
    for (const [regex, color] of rules) {
      const m = remaining.match(regex);
      if (m) {
        tokens.push({ text: m[0], color });
        remaining = remaining.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      tokens.push({ text: remaining[0], color: COLORS.default });
      remaining = remaining.slice(1);
    }
  }

  // Merge adjacent tokens with the same color
  const merged: Token[] = [];
  for (const t of tokens) {
    if (merged.length > 0 && merged[merged.length - 1].color === t.color) {
      merged[merged.length - 1].text += t.text;
    } else {
      merged.push({ ...t });
    }
  }

  return merged;
}
