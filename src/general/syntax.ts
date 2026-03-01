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

const C_KEYWORDS =
  "auto|break|case|continue|default|do|else|for|goto|if|register|return|sizeof|static|switch|typedef|volatile|while|alignas|alignof|asm|catch|class|co_await|co_return|co_yield|concept|consteval|constexpr|constinit|decltype|delete|explicit|export|final|friend|inline|module|mutable|namespace|new|noexcept|operator|override|private|protected|public|requires|static_assert|template|this|throw|try|typeid|typename|using|virtual";
const C_DECLARATIONS =
  "const|enum|extern|struct|union|typedef|static|inline|register|volatile|class|namespace|template|using";
const C_CONSTANTS = "true|false|NULL|nullptr|stdin|stdout|stderr|EOF";
const C_TYPES =
  "void|bool|char|short|int|long|float|double|signed|unsigned|size_t|ssize_t|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|nullptr_t|string|vector|map|set|pair|unique_ptr|shared_ptr|wchar_t|char16_t|char32_t|ptrdiff_t|intptr_t|uintptr_t|FILE";

const CSS_AT_RULES =
  "media|import|keyframes|font-face|charset|supports|page|namespace|layer|property|container|scope|starting-style";
const CSS_KEYWORDS =
  "important|from|to|and|or|not|only|all|print|screen|none|inherit|initial|unset|revert";

function buildRules(lang: Exclude<Language, null>): Rule[] {
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
      // Operators and punctuation (/ excluded before * or / to allow comment detection)
      [/^(?:[{}()\[\];,.:?!&|<>=+\-*%~^@#]|\/(?![/*]))+/, COLORS.punctuation],
      // Whitespace
      [/^\s+/, COLORS.default],
      // Anything else
      [/^./, COLORS.default],
    ];
  }

  if (lang === "css") {
    return [
      // Comments
      [/^\/\*[\s\S]*?\*\//, COLORS.comment],
      // At-rules
      [new RegExp(`^@(?:${CSS_AT_RULES})\\b`), COLORS.keyword],
      // Hex colors
      [/^#[0-9a-fA-F]{3,8}\b/, COLORS.number],
      // Strings
      [/^"(?:[^"\\]|\\.)*"/, COLORS.string],
      [/^'(?:[^'\\]|\\.)*'/, COLORS.string],
      // URL function
      [/^url\(/, COLORS.function],
      // !important
      [/^!important\b/, COLORS.keyword],
      // Numbers with units
      [/^-?[\d][\d.]*(?:px|em|rem|%|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|s|ms|deg|rad|turn|fr|dpi|dpcm|dppx)?\b/, COLORS.number],
      // Functions: calc(), rgb(), var(), etc.
      [/^[a-zA-Z][\w-]*(?=\s*\()/, COLORS.function],
      // Keywords
      [new RegExp(`^\\b(?:${CSS_KEYWORDS})\\b`), COLORS.keyword],
      // Properties (word followed by :)
      [/^[a-zA-Z][\w-]*(?=\s*:)/, COLORS.type],
      // Class selectors
      [/^\.[a-zA-Z_][\w-]*/, COLORS.declaration],
      // ID selectors
      [/^#[a-zA-Z_][\w-]*/, COLORS.declaration],
      // Pseudo-classes and pseudo-elements
      [/^::?[a-zA-Z][\w-]*/, COLORS.keyword],
      // Identifiers
      [/^[a-zA-Z_][\w-]*/, COLORS.default],
      // Punctuation
      [/^[{}()\[\];,:>~+*=|^$]+/, COLORS.punctuation],
      // Whitespace
      [/^\s+/, COLORS.default],
      // Anything else
      [/^./, COLORS.default],
    ];
  }

  if (lang === "html") {
    return [
      // Comments
      [/^<!--[\s\S]*?-->/, COLORS.comment],
      // DOCTYPE
      [/^<!DOCTYPE[^>]*>/i, COLORS.keyword],
      // Script/style content would need a multi-pass parser; keep simple
      // Closing tags
      [/^<\/[a-zA-Z][\w-]*\s*>/, COLORS.declaration],
      // Self-closing tags and opening tags with attributes
      [/^<[a-zA-Z][\w-]*/, COLORS.declaration],
      // Attribute names (inside tags)
      [/^\s+[a-zA-Z][\w-:]*(?=\s*=)/, COLORS.type],
      // Strings (attribute values)
      [/^"(?:[^"\\]|\\.)*"/, COLORS.string],
      [/^'(?:[^'\\]|\\.)*'/, COLORS.string],
      // Tag close
      [/^\s*\/?>/, COLORS.declaration],
      // Entities
      [/^&[a-zA-Z0-9#]+;/, COLORS.number],
      // Punctuation
      [/^[=<>\/]+/, COLORS.punctuation],
      // Whitespace
      [/^\s+/, COLORS.default],
      // Text content
      [/^[^<&\s]+/, COLORS.default],
      // Anything else
      [/^./, COLORS.default],
    ];
  }

  if (lang === "c") {
    return [
      // Comments
      [/^\/\/.*$/, COLORS.comment],
      [/^\/\*[\s\S]*?\*\//, COLORS.comment],
      // Preprocessor directives
      [/^#\s*(?:include|define|ifdef|ifndef|endif|if|else|elif|undef|pragma|error|warning)\b.*$/, COLORS.keyword],
      // Strings
      [/^"(?:[^"\\]|\\.)*"/, COLORS.string],
      // Char literals
      [/^'(?:[^'\\]|\\.)'/, COLORS.string],
      // Numbers
      [/^(?:0[xXbB])?[\d][\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?(?:[uUlLfF]{0,3})?\b/, COLORS.number],
      // Known types
      [new RegExp(`^\\b(?:${C_TYPES})\\b`), COLORS.type],
      // Capitalized identifiers as types
      [/^[A-Z][A-Z_0-9]{2,}\b/, COLORS.number], // MACRO_CONSTANTS
      [/^[A-Z][A-Za-z0-9_]*/, COLORS.type],
      // Declarations
      [new RegExp(`^\\b(?:${C_DECLARATIONS})\\b`), COLORS.declaration],
      // Keywords
      [new RegExp(`^\\b(?:${C_KEYWORDS})\\b`), COLORS.keyword],
      // Constants
      [new RegExp(`^\\b(?:${C_CONSTANTS})\\b`), COLORS.declaration],
      // Function calls: word followed by (
      [/^[a-zA-Z_]\w*(?=\s*\()/, COLORS.function],
      // Identifiers
      [/^[a-zA-Z_]\w*/, COLORS.default],
      // Operators and punctuation (/ excluded before * or / to allow comment detection)
      [/^(?:[{}()\[\];,.:?!&|<>=+\-*%~^@#]|\/(?![/*]))+/, COLORS.punctuation],
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
    // Operators and punctuation (/ excluded before * or / to allow comment detection)
    [/^(?:[{}()\[\];,.:?!&|<>=+\-*%~^@#]|\/(?![/*]))+/, COLORS.punctuation],
    // Whitespace
    [/^\s+/, COLORS.default],
    // Anything else
    [/^./, COLORS.default],
  ];
}

export type Language = "js" | "rust" | "json" | "css" | "html" | "c" | null;

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
    case "css":
    case "scss":
    case "less":
      return "css";
    case "html":
    case "htm":
    case "svg":
    case "xml":
      return "html";
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hxx":
    case "hh":
      return "c";
    default:
      return null;
  }
}

const rulesCache = new Map<string, Rule[]>();

function getRules(lang: Exclude<Language, null>): Rule[] {
  if (!rulesCache.has(lang)) {
    rulesCache.set(lang, buildRules(lang));
  }
  return rulesCache.get(lang)!;
}

export function tokenizeLine(
  line: string,
  lang: Language,
  inBlockComment: boolean = false,
): { tokens: Token[]; inBlockComment: boolean } {
  if (!lang) {
    return { tokens: [{ text: line, color: COLORS.default }], inBlockComment: false };
  }

  const blockStart = lang === "html" ? "<!--" : lang !== "json" ? "/*" : null;
  const blockEnd = lang === "html" ? "-->" : lang !== "json" ? "*/" : null;

  const rules = getRules(lang);
  const tokens: Token[] = [];
  let remaining = line;
  let inBlock = inBlockComment;

  while (remaining.length > 0) {
    // Inside a block comment from a previous line — scan for closing token
    if (inBlock && blockEnd) {
      const endIdx = remaining.indexOf(blockEnd);
      if (endIdx >= 0) {
        tokens.push({ text: remaining.slice(0, endIdx + blockEnd.length), color: COLORS.comment });
        remaining = remaining.slice(endIdx + blockEnd.length);
        inBlock = false;
      } else {
        tokens.push({ text: remaining, color: COLORS.comment });
        remaining = "";
      }
      continue;
    }

    // Check for block comment opening
    if (blockStart && blockEnd && remaining.startsWith(blockStart)) {
      const endIdx = remaining.indexOf(blockEnd, blockStart.length);
      if (endIdx >= 0) {
        // Closes on same line
        tokens.push({ text: remaining.slice(0, endIdx + blockEnd.length), color: COLORS.comment });
        remaining = remaining.slice(endIdx + blockEnd.length);
      } else {
        // Doesn't close — rest of line is comment, carry state forward
        tokens.push({ text: remaining, color: COLORS.comment });
        inBlock = true;
        remaining = "";
      }
      continue;
    }

    // Regular rule matching
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

  return { tokens: merged, inBlockComment: inBlock };
}
