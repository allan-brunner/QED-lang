import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/core/lexer.js";
import { TokenType } from "../../src/core/token.js";

// Helper to extract just token types for concise assertions
const typesOf = (code: string) => tokenize(code).map((t) => t.type);

describe("Lexer - Operators & Delimiters", () => {
  it("tokenizes single and multi-character operators accurately", () => {
    const code = "= == => < <= << > >= >> ~ ~= ! != -> @[ ( )";
    expect(typesOf(code)).toEqual([
      TokenType.EQUAL,
      TokenType.EQUAL_EQUAL,
      TokenType.FAT_ARROW,
      TokenType.LESS,
      TokenType.LESS_EQUAL,
      TokenType.LESS_LESS,
      TokenType.GREATER,
      TokenType.GREATER_EQUAL,
      TokenType.GREATER_GREATER,
      TokenType.TILDE,
      TokenType.TILDE_EQUAL,
      TokenType.BANG,
      TokenType.BANG_EQUAL,
      TokenType.THIN_ARROW,
      TokenType.AT_BRACKET,
      TokenType.LEFT_PAREN,
      TokenType.RIGHT_PAREN,
      TokenType.EOF,
    ]);
  });

  it("records the exact lexeme for closing parenthesis", () => {
    const tokens = tokenize("()");
    expect(tokens[0].lexeme).toBe("(");
    expect(tokens[1].lexeme).toBe(")");
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

describe("Lexer - Identifiers, keywords & greek math symbols", () => {
  it("distinguishes word operators and keywords from prefix-matching identifiers", () => {
    const code = "div dividend inter interval in input _ _privateVar";
    const tokens = tokenize(code);
    expect(tokens.map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.DIV, "div"],
      [TokenType.IDENT, "dividend"],
      [TokenType.INTER, "inter"],
      [TokenType.IDENT, "interval"],
      [TokenType.IN, "in"],
      [TokenType.IDENT, "input"],
      [TokenType.UNDERLINE, "_"],
      [TokenType.IDENT, "_privateVar"],
      [TokenType.EOF, ""],
    ]);
  });

  it("supports greek unicode identifiers for physics formulas", () => {
    const tokens = tokenize("let θ = 2 * π + Δx;");
    expect(tokens.map((t) => t.lexeme)).toEqual([
      "let", "θ", "=", "2", "*", "π", "+", "Δx", ";", "",
    ]);
  });
});

describe("Lexer - Numbers, complex literals & parameterless methods", () => {
  it("tokenizes integers, floats, scientific notation, and complex literals", () => {
    const tokens = tokenize("42 3.14 1.5e-10 4i 2.5i");
    expect(tokens.map((t) => [t.type, t.lexeme])).toEqual([
      [TokenType.INT_LIT, "42"],
      [TokenType.FLOAT_LIT, "3.14"],
      [TokenType.FLOAT_LIT, "1.5e-10"],
      [TokenType.COMPLEX_LIT, "4i"],
      [TokenType.COMPLEX_LIT, "2.5i"],
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
});

describe("Lexer - Strings", () => {
  it("tokenizes strings and preserves escaped quotes", () => {
    const tokens = tokenize('let s = "hello \\"world\\"";');
    expect(tokens[3].type).toBe(TokenType.STRING_LIT);
    expect(tokens[3].lexeme).toBe('"hello \\"world\\""');
    expect(tokens[4].type).toBe(TokenType.SEMICOLON);
  });

  it("throws on unclosed string with line and column", () => {
    expect(() => tokenize('let a = "unterminated;')).toThrow(
      /Unclosed string starting at 1:9/
    );
  });
});

describe("Lexer - Comments & Doc Comments", () => {
  it("ignores // line comments and nested /* */ block comments", () => {
    const code = `
      let x = 10; // line comment
      /* outer comment /* nested comment */ still in outer */
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
});
