import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/core/lexer.js";
import { Parser } from "../../src/core/parser.js";

const parseExpr = (code: string) => new Parser(tokenize(code)).parseExpression();
const parseProgram = (code: string) => new Parser(tokenize(code)).parseProgram();

describe("Parser - Primary Literals, Wildcard & Grouping", () => {
  it("parses all primitive literal types and wildcards accurately", () => {
    expect(parseExpr("42")).toMatchObject({ kind: "IntLit", value: 42n });
    expect(parseExpr("3.14")).toMatchObject({ kind: "FloatLit", value: 3.14 });
    expect(parseExpr("4i")).toMatchObject({ kind: "ComplexLit", real: 0, imaginary: 4 });
    expect(parseExpr('"hello"')).toMatchObject({ kind: "StringLit", value: "hello" });
    expect(parseExpr("true")).toMatchObject({ kind: "BooleanLit", value: true });
    expect(parseExpr("false")).toMatchObject({ kind: "BooleanLit", value: false });
    expect(parseExpr("None")).toMatchObject({ kind: "NoneLit" });
    expect(parseExpr("θ")).toMatchObject({ kind: "Identifier", name: "θ" });
    expect(parseExpr("_")).toMatchObject({ kind: "Wildcard" });
  });

  it("overrides precedence with parentheses", () => {
    const ast = parseExpr("(1 + 2) * 3");
    expect(ast).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "*" },
      left: {
        kind: "Grouping",
        expr: {
          kind: "Binary",
          operator: { lexeme: "+" },
          left: { kind: "IntLit", value: 1n },
          right: { kind: "IntLit", value: 2n },
        },
      },
      right: { kind: "IntLit", value: 3n },
    });
  });
});

describe("Parser - Associativity", () => {
  it("groups additive, multiplicative, and div left-to-right", () => {
    expect(parseExpr("10 - 3 - 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "-" },
      left: {
        kind: "Binary",
        operator: { lexeme: "-" },
        left: { kind: "IntLit", value: 10n },
        right: { kind: "IntLit", value: 3n },
      },
      right: { kind: "IntLit", value: 2n },
    });

    expect(parseExpr("16 div 4 div 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "div" },
      left: {
        kind: "Binary",
        operator: { lexeme: "div" },
        left: { kind: "IntLit", value: 16n },
        right: { kind: "IntLit", value: 4n },
      },
      right: { kind: "IntLit", value: 2n },
    });
  });

  it("groups exponentiation (**) right-to-left and allows unary minus on the exponent", () => {
    expect(parseExpr("2 ** 3 ** 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "**" },
      left: { kind: "IntLit", value: 2n },
      right: {
        kind: "Binary",
        operator: { lexeme: "**" },
        left: { kind: "IntLit", value: 3n },
        right: { kind: "IntLit", value: 2n },
      },
    });

    expect(parseExpr("2 ** -3")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "**" },
      left: { kind: "IntLit", value: 2n },
      right: {
        kind: "Unary",
        operator: { lexeme: "-" },
        operand: { kind: "IntLit", value: 3n },
      },
    });
  });

  it("groups nested ternary (? :) right-to-left", () => {
    expect(parseExpr("a ? b : c ? d : e")).toMatchObject({
      kind: "If",
      condition: { kind: "Identifier", name: "a" },
      success: { kind: "Identifier", name: "b" },
      fail: {
        kind: "If",
        condition: { kind: "Identifier", name: "c" },
        success: { kind: "Identifier", name: "d" },
        fail: { kind: "Identifier", name: "e" },
      },
    });
  });
});

describe("Parser - Full Precedence Hierarchy & Combined Operators", () => {
  it("binds postfix (!) tighter than power (**), and power tighter than prefix unary (-)", () => {
    expect(parseExpr("-2 ** 3!")).toMatchObject({
      kind: "Unary",
      operator: { lexeme: "-" },
      operand: {
        kind: "Binary",
        operator: { lexeme: "**" },
        left: { kind: "IntLit", value: 2n },
        right: {
          kind: "PostfixUnary",
          operator: { lexeme: "!" },
          operand: { kind: "IntLit", value: 3n },
        },
      },
    });
  });

  it("binds multiplication tighter than addition for complex numbers (3 + 4i * 2)", () => {
    expect(parseExpr("3 + 4i * 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "+" },
      left: { kind: "IntLit", value: 3n },
      right: {
        kind: "Binary",
        operator: { lexeme: "*" },
        left: { kind: "ComplexLit", real: 0, imaginary: 4 },
        right: { kind: "IntLit", value: 2n },
      },
    });
  });

  it("combines adjacent <<, >>, <=, >= tokens and respects their precedence", () => {
    expect(parseExpr("x << 1 + 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "<<" },
      left: { kind: "Identifier", name: "x" },
      right: {
        kind: "Binary",
        operator: { lexeme: "+" },
        left: { kind: "IntLit", value: 1n },
        right: { kind: "IntLit", value: 2n },
      },
    });

    expect(parseExpr("a <= b == c >= d")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "==" },
      left: { kind: "Binary", operator: { lexeme: "<=" } },
      right: { kind: "Binary", operator: { lexeme: ">=" } },
    });
  });

  it("binds bitwise AND (&) tighter than XOR (^), and XOR tighter than OR (|)", () => {
    // a | b ^ c & d => a | (b ^ (c & d))
    expect(parseExpr("a | b ^ c & d")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "|" },
      left: { kind: "Identifier", name: "a" },
      right: {
        kind: "Binary",
        operator: { lexeme: "^" },
        left: { kind: "Identifier", name: "b" },
        right: {
          kind: "Binary",
          operator: { lexeme: "&" },
          left: { kind: "Identifier", name: "c" },
          right: { kind: "Identifier", name: "d" },
        },
      },
    });
  });

  it("binds vector/set operators correctly (A cross B + C and S1 union S2 inter S3)", () => {
    expect(parseExpr("A cross B + C")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "+" },
      left: {
        kind: "Binary",
        operator: { lexeme: "cross" },
        left: { kind: "Identifier", name: "A" },
        right: { kind: "Identifier", name: "B" },
      },
      right: { kind: "Identifier", name: "C" },
    });

    expect(parseExpr("S1 union S2 inter S3")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "union" },
      left: { kind: "Identifier", name: "S1" },
      right: {
        kind: "Binary",
        operator: { lexeme: "inter" },
        left: { kind: "Identifier", name: "S2" },
        right: { kind: "Identifier", name: "S3" },
      },
    });
  });

  it("binds prefix logical ! looser than comparisons (!a == b => !(a == b))", () => {
    expect(parseExpr("!a == b")).toMatchObject({
      kind: "Unary",
      operator: { lexeme: "!" },
      operand: {
        kind: "Binary",
        operator: { lexeme: "==" },
        left: { kind: "Identifier", name: "a" },
        right: { kind: "Identifier", name: "b" },
      },
    });
  });

  it("binds && tighter than ||, and || tighter than ternary (? :)", () => {
    expect(parseExpr("a || b && c ? 1 : 0")).toMatchObject({
      kind: "If",
      condition: {
        kind: "Binary",
        operator: { lexeme: "||" },
        left: { kind: "Identifier", name: "a" },
        right: {
          kind: "Binary",
          operator: { lexeme: "&&" },
          left: { kind: "Identifier", name: "b" },
          right: { kind: "Identifier", name: "c" },
        },
      },
      success: { kind: "IntLit", value: 1n },
      fail: { kind: "IntLit", value: 0n },
    });
  });
});

describe("Parser - Postfix Chaining, Calls, Indexing & Slicing", () => {
  it("chains member access, function calls, and postfix factorial (vec.norm()!)", () => {
    expect(parseExpr("vec.norm()!")).toMatchObject({
      kind: "PostfixUnary",
      operator: { lexeme: "!" },
      operand: {
        kind: "FunctionCall",
        args: [],
        object: {
          kind: "MemberAccess",
          object: { kind: "Identifier", name: "vec" },
          name: { lexeme: "norm" },
        },
      },
    });
  });

  it("parses parameterless method calls on numeric literals (3.sqrt)", () => {
    expect(parseExpr("3.sqrt")).toMatchObject({
      kind: "MemberAccess",
      object: { kind: "IntLit", value: 3n },
      name: { lexeme: "sqrt" },
    });
  });

  it("parses single and 2D matrix indexing (a[0] and m[i, j + 1])", () => {
    expect(parseExpr("a[0]")).toMatchObject({
      kind: "Index",
      object: { kind: "Identifier", name: "a" },
      indexes: [{ kind: "IntLit", value: 0n }],
    });

    expect(parseExpr("m[i, j + 1]")).toMatchObject({
      kind: "Index",
      object: { kind: "Identifier", name: "m" },
      indexes: [
        { kind: "Identifier", name: "i" },
        { kind: "Binary", operator: { lexeme: "+" } },
      ],
    });
  });

  it("parses all four slice forms (a[1:4], a[:4], a[1:], a[:])", () => {
    expect(parseExpr("a[1:4]")).toMatchObject({
      kind: "Slicing",
      start: { kind: "IntLit", value: 1n },
      end: { kind: "IntLit", value: 4n },
    });

    const sliceToEnd = parseExpr("a[:4]");
    expect(sliceToEnd).toMatchObject({
      kind: "Slicing",
      end: { kind: "IntLit", value: 4n },
    });
    if (sliceToEnd.kind === "Slicing") {
      expect(sliceToEnd.start).toBeUndefined();
    }

    const sliceFromStart = parseExpr("a[1:]");
    expect(sliceFromStart).toMatchObject({
      kind: "Slicing",
      start: { kind: "IntLit", value: 1n },
    });
    if (sliceFromStart.kind === "Slicing") {
      expect(sliceFromStart.end).toBeUndefined();
    }

    const fullSlice = parseExpr("a[:]");
    expect(fullSlice).toMatchObject({
      kind: "Slicing",
    });
    if (fullSlice.kind === "Slicing") {
      expect(fullSlice.start).toBeUndefined();
      expect(fullSlice.end).toBeUndefined();
    }
  });
});

describe("Parser - Collections, Vectors, Matrices & Dynamic Lists", () => {
  it("parses empty and populated vectors <1, 2, 3> and 2D matrices <1, 2; 3, 4>", () => {
    expect(parseExpr("<>")).toMatchObject({
      kind: "VectorLit",
      elements: [],
    });

    expect(parseExpr("<1, 2, 3>")).toMatchObject({
      kind: "VectorLit",
      elements: [
        { kind: "IntLit", value: 1n },
        { kind: "IntLit", value: 2n },
        { kind: "IntLit", value: 3n },
      ],
    });

    expect(parseExpr("<1, 2; 3, 4>")).toMatchObject({
      kind: "MatrixLit",
      nbRows: 2,
      nbCols: 2,
    });

    expect(parseExpr("<1; 2; 3>")).toMatchObject({
      kind: "MatrixLit",
      nbRows: 3,
      nbCols: 1,
    });
  });

  it("distinguishes sets {1, 2} and {1} from maps {\"a\": 1}", () => {
    expect(parseExpr("{1}")).toMatchObject({
      kind: "SetLit",
      elements: [{ kind: "IntLit", value: 1n }],
    });

    expect(parseExpr("{1, 2, 3}")).toMatchObject({
      kind: "SetLit",
      elements: [
        { kind: "IntLit", value: 1n },
        { kind: "IntLit", value: 2n },
        { kind: "IntLit", value: 3n },
      ],
    });

    expect(parseExpr('{"a": 1, "b": 2}')).toMatchObject({
      kind: "MapLit",
      entries: [
        { key: { kind: "StringLit", value: "a" }, value: { kind: "IntLit", value: 1n } },
        { key: { kind: "StringLit", value: "b" }, value: { kind: "IntLit", value: 2n } },
      ],
    });
  });

  it("distinguishes standard lists [], [1, 2] from dynamic range lists [1 to 10 by 2]", () => {
    expect(parseExpr("[]")).toMatchObject({ kind: "ListLit", elements: [] });
    expect(parseExpr("[1, 2, 3]")).toMatchObject({ kind: "ListLit" });

    expect(parseExpr("[1 to 5]")).toMatchObject({
      kind: "ListDynamicLit",
      start: { kind: "IntLit", value: 1n },
      end: { kind: "IntLit", value: 5n },
    });

    expect(parseExpr("[0 until 10 by 2]")).toMatchObject({
      kind: "ListDynamicLit",
      start: { kind: "IntLit", value: 0n },
      end: { kind: "IntLit", value: 10n },
      step: { kind: "IntLit", value: 2n },
    });
  });
});

describe("Parser - Blocks, Control Flow & Statements", () => {
  it("parses blocks with implicit return expressions vs semicolon statements", () => {
    const emptyBlock = parseExpr("{}");
    expect(emptyBlock).toMatchObject({ kind: "Block", statements: [] });

    const withReturn = parseExpr("{ let x = 2; x * 3 }");
    expect(withReturn).toMatchObject({
      kind: "Block",
      statements: [{ kind: "VarDecl", isConst: false, name: { lexeme: "x" } }],
      returnExpr: {
        kind: "Binary",
        operator: { lexeme: "*" },
        left: { kind: "Identifier", name: "x" },
        right: { kind: "IntLit", value: 3n },
      },
    });

    const voidBlock = parseExpr("{ let x = 2; x * 3; }");
    expect(voidBlock).toMatchObject({
      kind: "Block",
      statements: [
        { kind: "VarDecl", name: { lexeme: "x" } },
        { kind: "ExprStmt", expr: { kind: "Binary", operator: { lexeme: "*" } } },
      ],
    });
    if (voidBlock.kind === "Block") {
      expect(voidBlock.returnExpr).toBeUndefined();
    }
  });

  it("parses if, else if, and else expressions", () => {
    expect(parseExpr("if x > 0 { x } else if x < 0 { -x } else { 0 }")).toMatchObject({
      kind: "If",
      condition: { kind: "Binary", operator: { lexeme: ">" } },
      success: { kind: "Block" },
      fail: {
        kind: "If",
        condition: { kind: "Binary", operator: { lexeme: "<" } },
        success: { kind: "Block" },
        fail: { kind: "Block" },
      },
    });
  });

  it("parses while and for expressions (with identifier and wildcard)", () => {
    expect(parseExpr("while i != 0 i")).toMatchObject({
      kind: "While",
      condition: { kind: "Binary", operator: { lexeme: "!=" } },
      block: { kind: "Identifier", name: "i" },
    });

    expect(parseExpr("while i > 0 { i + 4 }")).toMatchObject({
      kind: "While",
      block: { kind: "Block" },
    });

    expect(parseExpr("for _ in [1, 2, 3] { 1 + 3; }")).toMatchObject({
      kind: "For",
      identifier: { lexeme: "_" },
      expr: { kind: "ListLit" },
      block: { kind: "Block" },
    });

    expect(parseExpr("for i in [1 to 3 by 1] i")).toMatchObject({
      kind: "For",
      identifier: { lexeme: "i" },
      expr: { kind: "ListDynamicLit" },
      block: { kind: "Identifier", name: "i" },
    });
  });

  it("parses match expressions with multiple patterns and wildcards", () => {
    expect(parseExpr("match n { 0 => 1 1 | 2 => 2 _ => { n } }")).toMatchObject({
      kind: "Match",
      expr: { kind: "Identifier", name: "n" },
      arms: [
        { patterns: [{ kind: "IntLit", value: 0n }], success: { kind: "IntLit", value: 1n } },
        {
          patterns: [
            { kind: "IntLit", value: 1n },
            { kind: "IntLit", value: 2n },
          ],
          success: { kind: "IntLit", value: 2n },
        },
        { patterns: [{ kind: "Wildcard" }], success: { kind: "Block" } },
      ],
    });
  });

  it("parses let and const declarations with primitives, nested generics, optionals, and function types", () => {
    const stmts = parseProgram(`
      let a = 10;
      const b: Int? = None;
      let c: Map<String, List<Int>> = {"scores": [1, 2]};
      let fnType: (Int, Float) -> Boolean? = check;
    `);

    expect(stmts[0]).toMatchObject({
      kind: "VarDecl",
      isConst: false,
      name: { lexeme: "a" },
      initializer: { kind: "IntLit", value: 10n },
    });

    expect(stmts[1]).toMatchObject({
      kind: "VarDecl",
      isConst: true,
      name: { lexeme: "b" },
      typeAnnotation: {
        kind: "NamedType",
        name: { lexeme: "Int" },
        optional: true,
      },
    });

    expect(stmts[2]).toMatchObject({
      kind: "VarDecl",
      name: { lexeme: "c" },
      typeAnnotation: {
        kind: "NamedType",
        name: { lexeme: "Map" },
        typeParams: [
          { kind: "NamedType", name: { lexeme: "String" } },
          {
            kind: "NamedType",
            name: { lexeme: "List" },
            typeParams: [{ kind: "NamedType", name: { lexeme: "Int" } }],
          },
        ],
      },
    });

    expect(stmts[3]).toMatchObject({
      kind: "VarDecl",
      name: { lexeme: "fnType" },
      typeAnnotation: {
        kind: "FuncType",
        params: [
          { kind: "NamedType", name: { lexeme: "Int" } },
          { kind: "NamedType", name: { lexeme: "Float" } },
        ],
        returnType: {
          kind: "NamedType",
          name: { lexeme: "Boolean" },
          optional: true,
        },
      },
    });
  });
});

describe("Parser - Syntax Error Detection", () => {
  it("throws descriptive errors on malformed expressions, jagged matrices, and invalid statements", () => {
    expect(() => parseExpr("(1 + 2")).toThrow(/Expected '\)'/);
    expect(() => parseExpr("f(1, 2")).toThrow(/Expected '\)'/);
    expect(() => parseExpr("arr[0")).toThrow(/Expected '\]'/);
    expect(() => parseExpr("<1, 2")).toThrow(/Expected '>'/);
    expect(() => parseExpr("<1, 2; 3>")).toThrow(/Matrix row 2 has 1 columns, expected 2/);
    expect(() => parseExpr("1 + * 2")).toThrow(/Unexpected token '\*'/);
    expect(() => parseExpr("a ? b")).toThrow(/Expected ':'/);
    expect(() => parseExpr("for 123 in list {}")).toThrow(/Expected identifier or '_'/);
    expect(() => parseExpr("match x { 1 2 }")).toThrow(/Expected '=>'/);
    expect(() => parseProgram("let x: Map<Int> = 0;")).toThrow(/Expected ','/);
    expect(() => parseProgram("let x = 5")).toThrow(/Expected ';'/);
    expect(() => parseExpr("")).toThrow(/Unexpected token/);
  });
});
