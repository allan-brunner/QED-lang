import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/core/lexer.js";
import { TokenType } from "../../src/core/token.js";

const typesOf = (code: string) => tokenize(code).map((t) => t.type);

describe("Lexer - Operators & Delimiters", () => {
  it("tokenizes single and multi-character operators and single < > tokens", () => {
    const code = "= == => < <= << > >= >> ~ ~= ! != -> + - * ** / % \\ & && | || ^";
    expect(typesOf(code)).toEqual([
      TokenType.EQUAL,
      TokenType.EQUAL_EQUAL,
      TokenType.FAT_ARROW,
      TokenType.LESS,
      TokenType.LESS,
      TokenType.EQUAL,
      TokenType.LESS,
      TokenType.LESS,
      TokenType.GREATER,
      TokenType.GREATER,
      TokenType.EQUAL,
      TokenType.GREATER,
      TokenType.GREATER,
      TokenType.TILDE,
      TokenType.TILDE_EQUAL,
      TokenType.BANG,
      TokenType.BANG_EQUAL,
      TokenType.THIN_ARROW,
      TokenType.PLUS,
      TokenType.MINUS,
      TokenType.STAR,
      TokenType.STAR_STAR,
      TokenType.SLASH,
      TokenType.PERCENT,
      TokenType.BACKSLASH,
      TokenType.AMP,
      TokenType.AMP_AMP,
      TokenType.PIPE,
      TokenType.PIPE_PIPE,
      TokenType.CARET,
      TokenType.EOF,
    ]);
  });

  it("tokenizes all punctuation and bracket delimiters accurately", () => {
    const code = "( ) { } [ ] , . ; : ?";
    expect(typesOf(code)).toEqual([
      TokenType.LEFT_PAREN,
      TokenType.RIGHT_PAREN,
      TokenType.LEFT_BRACE,
      TokenType.RIGHT_BRACE,
      TokenType.LEFT_BRACKET,
      TokenType.RIGHT_BRACKET,
      TokenType.COMMA,
      TokenType.DOT,
      TokenType.SEMICOLON,
      TokenType.COLON,
      TokenType.QUESTION,
      TokenType.EOF,
    ]);
  });

  it("handles empty and whitespace-only input (including CRLF)", () => {
    expect(typesOf("")).toEqual([TokenType.EOF]);
    expect(typesOf("   \t\r\n\r\n  ")).toEqual([TokenType.EOF]);
  });

  it("handles factorial followed by equality without ambiguity (5! == 120)", () => {
    expect(typesOf("5! == 120")).toEqual([
      TokenType.INT_LIT,
      TokenType.BANG,
      TokenType.EQUAL_EQUAL,
      TokenType.INT_LIT,
      TokenType.EOF,
    ]);
  });
});

describe("Lexer - Keywords, Built-in Types & Identifiers", () => {
  it("distinguishes word operators and keywords from prefix-matching identifiers", () => {
    const code = "div dividend crossproduct cross inter interval union in input _ _privateVar";
    const tokens = tokenize(code);
    expect(tokens.map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.DIV, "div"],
      [TokenType.IDENT, "dividend"],
      [TokenType.IDENT, "crossproduct"],
      [TokenType.CROSS, "cross"],
      [TokenType.INTER, "inter"],
      [TokenType.IDENT, "interval"],
      [TokenType.UNION, "union"],
      [TokenType.IN, "in"],
      [TokenType.IDENT, "input"],
      [TokenType.UNDERLINE, "_"],
      [TokenType.IDENT, "_privateVar"],
      [TokenType.EOF, ""],
    ]);
  });

  it("recognizes all declaration, control-flow, and range keywords", () => {
    const code = "import class inherits func let const return break continue if else while for match true false None this to until by";
    expect(typesOf(code)).toEqual([
      TokenType.IMPORT,
      TokenType.CLASS,
      TokenType.INHERITS,
      TokenType.FUNC,
      TokenType.LET,
      TokenType.CONST,
      TokenType.RETURN,
      TokenType.BREAK,
      TokenType.CONTINUE,
      TokenType.IF,
      TokenType.ELSE,
      TokenType.WHILE,
      TokenType.FOR,
      TokenType.MATCH,
      TokenType.TRUE,
      TokenType.FALSE,
      TokenType.NONE,
      TokenType.THIS,
      TokenType.TO,
      TokenType.UNTIL,
      TokenType.BY,
      TokenType.EOF,
    ]);
  });

  it("recognizes all built-in type keywords", () => {
    const code = "Boolean Int BigInt Float Double String Vector Matrix Complex List Set Deque Heap Map";
    expect(typesOf(code)).toEqual([
      TokenType.TYPE_BOOLEAN,
      TokenType.TYPE_INT,
      TokenType.TYPE_BIGINT,
      TokenType.TYPE_FLOAT,
      TokenType.TYPE_DOUBLE,
      TokenType.TYPE_STRING,
      TokenType.TYPE_VECTOR,
      TokenType.TYPE_MATRIX,
      TokenType.TYPE_COMPLEX,
      TokenType.TYPE_LIST,
      TokenType.TYPE_SET,
      TokenType.TYPE_DEQUE,
      TokenType.TYPE_HEAP,
      TokenType.TYPE_MAP,
      TokenType.EOF,
    ]);
  });

  it("supports Greek unicode identifiers for math and physics formulas", () => {
    const tokens = tokenize("let θ = 2 * π + Δx - λ_0;");
    expect(tokens.map((t) => t.lexeme)).toEqual([
      "let", "θ", "=", "2", "*", "π", "+", "Δx", "-", "λ_0", ";", "",
    ]);
  });
});

describe("Lexer - Numbers, Complex Literals & Parameterless Methods", () => {
  it("tokenizes integers, floats, scientific notation, and complex literals", () => {
    const tokens = tokenize("0 42 3.14 1.5e-10 2E+5 1e3 4i 2.5i 1e3i");
    expect(tokens.map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.INT_LIT, "0"],
      [TokenType.INT_LIT, "42"],
      [TokenType.FLOAT_LIT, "3.14"],
      [TokenType.FLOAT_LIT, "1.5e-10"],
      [TokenType.FLOAT_LIT, "2E+5"],
      [TokenType.FLOAT_LIT, "1e3"],
      [TokenType.COMPLEX_LIT, "4i"],
      [TokenType.COMPLEX_LIT, "2.5i"],
      [TokenType.COMPLEX_LIT, "1e3i"],
      [TokenType.EOF, ""],
    ]);
  });

  it("does not confuse parameterless method calls on ints (3.sqrt) with floats", () => {
    const tokens = tokenize("3.sqrt");
    expect(tokens.map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.INT_LIT, "3"],
      [TokenType.DOT, "."],
      [TokenType.IDENT, "sqrt"],
      [TokenType.EOF, ""],
    ]);
  });

  it("does not consume 'i' as a complex literal when followed by identifier characters (4i_var)", () => {
    const tokens = tokenize("4i_var");
    expect(tokens.map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.INT_LIT, "4"],
      [TokenType.IDENT, "i_var"],
      [TokenType.EOF, ""],
    ]);
  });

  it("handles implicit-multiplication boundaries (4i2, 3e, 2epsilon) and escaped newlines in strings", () => {
    expect(tokenize("4i2").map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.INT_LIT, "4"],
      [TokenType.IDENT, "i2"],
      [TokenType.EOF, ""],
    ]);

    expect(tokenize("3e 2epsilon").map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.INT_LIT, "3"],
      [TokenType.IDENT, "e"],
      [TokenType.INT_LIT, "2"],
      [TokenType.IDENT, "epsilon"],
      [TokenType.EOF, ""],
    ]);

    const escapedNl = tokenize('"a\\\nb" x');
    expect(escapedNl[1]).toMatchObject({ lexeme: "x", line: 2, column: 4 });
  });
});

describe("Lexer - Strings, Comments, Positions & Error Handling", () => {
  it("tokenizes strings and preserves escaped quotes and multiline coordinates", () => {
    const tokens = tokenize('let s = "hello \\"world\\"";');
    expect(tokens[3].type).toBe(TokenType.STRING_LIT);
    expect(tokens[3].lexeme).toBe('"hello \\"world\\""');
    expect(tokens[4].type).toBe(TokenType.SEMICOLON);

    const multiline = tokenize('"line1\nline2" x');
    expect(multiline[0]).toMatchObject({ type: TokenType.STRING_LIT, line: 1, column: 1 });
    expect(multiline[1]).toMatchObject({ type: TokenType.IDENT, lexeme: "x", line: 2, column: 8 });
  });

  it("tracks exact line and column numbers across newlines and block comments", () => {
    const code = "let a = 1;\n/* multi\nline */ let b = 2;";
    const tokens = tokenize(code);
    expect(tokens[0]).toMatchObject({ lexeme: "let", line: 1, column: 1 });
    expect(tokens[4]).toMatchObject({ lexeme: ";", line: 1, column: 10 });
    expect(tokens[5]).toMatchObject({ lexeme: "let", line: 3, column: 9 });
    expect(tokens[6]).toMatchObject({ lexeme: "b", line: 3, column: 13 });
  });

  it("ignores // line comments and nested /* */ block comments", () => {
    const code = `
      let x = 10; // line comment
      /* outer comment /* deeply /* nested */ comment */ still in outer */
      let y = 20;
    `;
    expect(typesOf(code)).toEqual([
      TokenType.LET, TokenType.IDENT, TokenType.EQUAL, TokenType.INT_LIT, TokenType.SEMICOLON,
      TokenType.LET, TokenType.IDENT, TokenType.EQUAL, TokenType.INT_LIT, TokenType.SEMICOLON,
      TokenType.EOF,
    ]);
  });

  it("attaches multi-line /// doc comments to the next token and flushes", () => {
    const code = `
      /// Computes magnitude
      /// Returns Float
      func norm(v: Vector): Float { v }
    `;
    const tokens = tokenize(code);
    expect(tokens[0].type).toBe(TokenType.FUNC);
    expect(tokens[0].docComment).toBe("Computes magnitude\nReturns Float");
    expect(tokens[1].docComment).toBeUndefined();
  });

  it("throws descriptive errors on invalid lexical constructs", () => {
    expect(() => tokenize('let a = "unterminated;')).toThrow(/Unclosed string starting at 1:9/);
    expect(() => tokenize("/* unclosed /* nested */")).toThrow(/Unclosed block comment starting at 1:1/);
    expect(() => tokenize("1.5e+")).toThrow(/Invalid scientific/);
    expect(() => tokenize("$invalid")).toThrow(/Unexpected character '\$'/);
    expect(() => tokenize("@foo")).toThrow(/Unexpected character '@'/);
  });
});

describe("Lexer - Edge Cases & Regressions", () => {
  it("treats Object.prototype property names as normal identifiers", () => {
    const tokens = tokenize("toString constructor valueOf hasOwnProperty");
    expect(tokens.map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.IDENT, "toString"],
      [TokenType.IDENT, "constructor"],
      [TokenType.IDENT, "valueOf"],
      [TokenType.IDENT, "hasOwnProperty"],
      [TokenType.EOF, ""],
    ]);
  });

  it("handles scientific-like implicit multiplication (2e+x) and rejects dangling signs (1.5e-)", () => {
    expect(tokenize("2e+x").map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.INT_LIT, "2"],
      [TokenType.IDENT, "e"],
      [TokenType.PLUS, "+"],
      [TokenType.IDENT, "x"],
      [TokenType.EOF, ""],
    ]);
    expect(() => tokenize("1.5e-")).toThrow(/Invalid scientific notation/);
  });

  it("handles member access on float and complex literals (3.14.abs, 4i.re)", () => {
    expect(tokenize("3.14.abs 4i.re").map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.FLOAT_LIT, "3.14"],
      [TokenType.DOT, "."],
      [TokenType.IDENT, "abs"],
      [TokenType.COMPLEX_LIT, "4i"],
      [TokenType.DOT, "."],
      [TokenType.IDENT, "re"],
      [TokenType.EOF, ""],
    ]);
  });

  it("handles escaped backslashes before closing quotes and CRLF line continuations", () => {
    const escapedBackslash = tokenize('"abc\\\\" x');
    expect(escapedBackslash[0]).toMatchObject({ type: TokenType.STRING_LIT, lexeme: '"abc\\\\"' });
    expect(escapedBackslash[1]).toMatchObject({ type: TokenType.IDENT, lexeme: "x" });

    const crlfContinuation = tokenize('"a\\\r\nb" y');
    expect(crlfContinuation[1]).toMatchObject({ lexeme: "y", line: 2, column: 4 });

    expect(() => tokenize('"unclosed\\')).toThrow(/Unclosed string/);
  });
});