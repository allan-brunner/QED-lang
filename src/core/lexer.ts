import { Token, TokenType, KEYWORDS } from "./token";

// Trampoline types for stack-safe tail recursion
type TailCall<T> = { readonly done: true; readonly value: T }
  | { readonly done: false, readonly next: () => TailCall<T> }

const done = <T>(value: T): TailCall<T> => ({ done: true, value });
const tailCall = <T>(next: () => TailCall<T>): TailCall<T> => ({ done: false, next });

function trampoline<T>(step: TailCall<T>): T {
  let current = step;
  while (!current.done) {
    current = current.next();
  }
  return current.value;
}

interface LexerState {
  readonly source: string;
  readonly index: number;
  readonly line: number;
  readonly col: number;
  readonly tokens: Token[];
  readonly pendingDocs: string[];
}

// Helper to advance state by N characters on the same line
function advance(state: LexerState, count = 1): LexerState {
  return { ...state, index: state.index + count, col: state.col + count };
}

// Helper to emit a token and flush any buffered /// comments
function emit(state: LexerState, type: TokenType, lexeme: string): LexerState {
  const docComment = state.pendingDocs.length > 0
    ? state.pendingDocs.join("\n")
    : undefined;

  const token: Token = {
    type,
    lexeme,
    line: state.line,
    column: state.col,
    ...(docComment !== undefined ? { docComment } : {})
  };

  state.tokens.push(token);
  return {
    ...state,
    index: state.index + lexeme.length,
    col: state.col + lexeme.length,
    pendingDocs: []
  };
}

function scan(state: LexerState): TailCall<Token[]> {
  const { source, index, line, col } = state;

  if (index >= source.length) {
    const finalState = emit(state, TokenType.EOF, "");
    return done(finalState.tokens);
  }

  const ch = source[index];
  const nextCh = source[index + 1] ?? "";
  const thirdCh = source[index + 2] ?? "";

  switch (ch) {
    // Whitespace
    case " ":
    case "\r":
    case "\t":
      return tailCall(() => scan(advance(state, 1)));

    case "\n":
      return tailCall(() =>
        scan({ ...state, index: index + 1, line: line + 1, col: 1 })
      );

    // Single-character tokens
    case "(":
      return tailCall(() => scan(emit(state, TokenType.LEFT_PAREN, "(")));
    case ")":
      return tailCall(() => scan(emit(state, TokenType.RIGHT_PAREN, ")")));
    case "{":
      return tailCall(() => scan(emit(state, TokenType.LEFT_BRACE, "{")));
    case "}":
      return tailCall(() => scan(emit(state, TokenType.RIGHT_BRACE, "}")));
    case "[":
      return tailCall(() => scan(emit(state, TokenType.LEFT_BRACKET, "[")));
    case "]":
      return tailCall(() => scan(emit(state, TokenType.RIGHT_BRACKET, "]")));
    case ",":
      return tailCall(() => scan(emit(state, TokenType.COMMA, ",")));
    case ".":
      return tailCall(() => scan(emit(state, TokenType.DOT, ".")));
    case ";":
      return tailCall(() => scan(emit(state, TokenType.SEMICOLON, ";")));
    case ":":
      return tailCall(() => scan(emit(state, TokenType.COLON, ":")));
    case "?":
      return tailCall(() => scan(emit(state, TokenType.QUESTION, "?")));
    case "+":
      return tailCall(() => scan(emit(state, TokenType.PLUS, "+")));
    case "%":
      return tailCall(() => scan(emit(state, TokenType.PERCENT, "%")));
    case "\\":
      return tailCall(() => scan(emit(state, TokenType.BACKSLASH, "\\")));
    case "^":
      return tailCall(() => scan(emit(state, TokenType.CARET, "^")));

    // Multi-characters
    case "@":
      if (nextCh === "[") {
        return tailCall(() => scan(emit(state, TokenType.AT_BRACKET, "@[")));
      }
      throw new Error(`Unexpected '@' at ${line}:${col}`);

    case "-":
      return tailCall(() =>
        nextCh === ">"
          ? scan(emit(state, TokenType.THIN_ARROW, "->"))
          : scan(emit(state, TokenType.MINUS, "-"))
      );
    case "*":
      return tailCall(() =>
        nextCh === "*"
          ? scan(emit(state, TokenType.STAR_STAR, "**"))
          : scan(emit(state, TokenType.STAR, "*"))
      );
    case "!":
      return tailCall(() =>
        nextCh === "="
          ? scan(emit(state, TokenType.BANG_EQUAL, "!="))
          : scan(emit(state, TokenType.BANG, "!"))
      );
    case "&":
      return tailCall(() =>
        nextCh === "&"
          ? scan(emit(state, TokenType.AMP_AMP, "&&"))
          : scan(emit(state, TokenType.AMP, "&"))
      );
    case "|":
      return tailCall(() =>
        nextCh === "|"
          ? scan(emit(state, TokenType.PIPE_PIPE, "||"))
          : scan(emit(state, TokenType.PIPE, "|"))
      );
    case "~":
      return tailCall(() =>
        nextCh === "="
          ? scan(emit(state, TokenType.TILDE_EQUAL, "~="))
          : scan(emit(state, TokenType.TILDE, "~"))
      );

    case "=":
      if (nextCh === "=") {
        return tailCall(() => scan(emit(state, TokenType.EQUAL_EQUAL, "==")));
      } else if (nextCh === ">") {
        return tailCall(() => scan(emit(state, TokenType.FAT_ARROW, "=>")));
      }
      return tailCall(() => scan(emit(state, TokenType.EQUAL, "=")));
    case "<":
      if (nextCh === "<") {
        return tailCall(() => scan(emit(state, TokenType.LESS_LESS, "<<")));
      } else if (nextCh === "=") {
        return tailCall(() => scan(emit(state, TokenType.LESS_EQUAL, "<=")));
      }
      return tailCall(() => scan(emit(state, TokenType.LESS, "<")));
    case ">":
      if (nextCh === ">") {
        return tailCall(() => scan(emit(state, TokenType.GREATER_GREATER, ">>")));
      } else if (nextCh === "=") {
        return tailCall(() => scan(emit(state, TokenType.GREATER_EQUAL, ">=")));
      }
      return tailCall(() => scan(emit(state, TokenType.GREATER, ">")));

    case "/":
      if (nextCh === "/" && thirdCh === "/") {
        return tailCall(() => scan(readDocComment(state)));
      }
      if (nextCh === "/") {
        return tailCall(() => scan(skipLineComment(state)));
      }
      if (nextCh === "*") {
        return tailCall(() => scan(skipBlockComment(state)));
      }
      return tailCall(() => scan(emit(state, TokenType.SLASH, "/")));

    case "\"":
      return tailCall(() => scan(readString(state)));

    default:
      if (isDigit(ch)) {
        return tailCall(() => scan(readNumber(state)));
      }
      if (isIdentifierStart(ch)) {
        return tailCall(() => scan(readIdentifier(state)));
      }
      throw new Error(`Unexpected character '${ch}' at ${line}:${col}`);
  }
}

function skipLineComment(state: LexerState): LexerState {
  let i = state.index + 2;
  while (i < state.source.length && state.source[i] !== "\n") {
    i++;
  }
  return { ...state, index: i, col: state.col + (i - state.index) };
}

function readDocComment(state: LexerState): LexerState {
  const start = state.index + 3;
  let i = start;
  while (i < state.source.length && state.source[i] !== "\n") {
    i++;
  }
  const text = state.source.slice(start, i).trim();
  return {
    ...state,
    index: i,
    col: state.col + (i - state.index),
    pendingDocs: [...state.pendingDocs, text]
  };
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentifierStart(ch: string): boolean {
  // Matches ASCII letters, underscore, and greek unicode block
  return /^[a-zA-Z_\u0370-\u03FF]$/.test(ch);
}

function readIdentifier(state: LexerState): LexerState {
  let i = state.index;
  while (i < state.source.length && /^[a-zA-Z0-9_\u0370-\u03FF]$/.test(state.source[i])) {
    i++;
  }
  const lexeme = state.source.slice(state.index, i);
  const type = KEYWORDS[lexeme] ?? TokenType.IDENT;
  return emit(state, type, lexeme);
}

function readString(state: LexerState): LexerState {
  let i = state.index + 1;
  let line = state.line;
  let col = state.col + 1;

  while (i < state.source.length && state.source[i] !== "\"") {
    if (state.source[i] == "\\") {
      i += 2;
      col += 2;
      continue;
    }
    if (state.source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    i++;
  }

  if (state.source[i] !== "\"") {
    throw new Error(`Unclosed string starting at ${state.line}:${state.col}`);
  }

  const lexeme = state.source.slice(state.index, i + 1);
  const emitted = emit(state, TokenType.STRING_LIT, lexeme);
  return { ...emitted, index: i + 1, line, col: col + 1 };
}

function skipBlockComment(state: LexerState): LexerState {
  let i = state.index + 2;
  let line = state.line;
  let col = state.col + 2;
  let depth = 1;

  while (i < state.source.length && depth > 0) {
    if (state.source[i] === "/" && state.source[i + 1] === "*") {
      depth++;
      i += 2;
      col += 2;
    } else if (state.source[i] === "*" && state.source[i + 1] === "/") {
      depth--;
      i += 2;
      col += 2;
    } else if (state.source[i] === "\n") {
      line++;
      col = 1;
      i++;
    } else {
      col++;
      i++;
    }
  }

  if (depth > 0) {
    throw new Error(`Unclosed block comment starting at ${state.line}:${state.col}`);
  }

  return { ...state, index: i, line, col };
}

function readNumber(state: LexerState): LexerState {
  let i = state.index;
  let isFloat = false;

  while (i < state.source.length && isDigit(state.source[i])) {
    i++;
  }

  if (state.source[i] === "." && isDigit(state.source[i + 1] ?? "")) {
    isFloat = true;
    i++;
    while (i < state.source.length && isDigit(state.source[i])) {
      i++;
    }
  }

  if (state.source[i] === "e" || state.source[i] === "E") {
    isFloat = true;
    i++;
    if (state.source[i] === "+" || state.source[i] === "-") {
      i++;
    }
    if (!isDigit(state.source[i] ?? "")) {
      throw new Error(`Invalid scientific notifation at ${state.line}:${state.col}`);
    }
    while (i < state.source.length && isDigit(state.source[i])) {
      i++;
    }
  }

  if (state.source[i] === "i" && !isIdentifierStart(state.source[i + 1] ?? "")) {
    i++;
    const lexeme = state.source.slice(state.index, i);
    return emit(state, TokenType.COMPLEX_LIT, lexeme);
  }

  const lexeme = state.source.slice(state.index, i);
  return emit(state, isFloat ? TokenType.FLOAT_LIT : TokenType.INT_LIT, lexeme);
}

export function tokenize(source: string): Token[] {
  return trampoline(
    scan({
      source,
      index: 0,
      line: 1,
      col: 1,
      tokens: [],
      pendingDocs: []
    })
  );
}
