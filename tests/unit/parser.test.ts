import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/core/lexer.js";
import { Parser } from "../../src/core/parser.js";

const parseExpr = (code: string) => new Parser(tokenize(code)).parseExpression();
const parseProgram = (code: string) => new Parser(tokenize(code)).parseProgram();

describe("Parser - Primary Literals, Wildcard, This & Grouping", () => {
  it("parses all primitive literal types, wildcards, and this accurately", () => {
    expect(parseExpr("42")).toMatchObject({ kind: "IntLit", value: 42n });
    expect(parseExpr("3.14")).toMatchObject({ kind: "FloatLit", value: 3.14 });
    expect(parseExpr("4i")).toMatchObject({ kind: "ComplexLit", real: 0, imaginary: 4 });
    expect(parseExpr('"hello"')).toMatchObject({ kind: "StringLit", value: "hello" });
    expect(parseExpr("true")).toMatchObject({ kind: "BooleanLit", value: true });
    expect(parseExpr("false")).toMatchObject({ kind: "BooleanLit", value: false });
    expect(parseExpr("None")).toMatchObject({ kind: "NoneLit" });
    expect(parseExpr("θ")).toMatchObject({ kind: "Identifier", name: "θ" });
    expect(parseExpr("_")).toMatchObject({ kind: "Wildcard" });
    expect(parseExpr("this")).toMatchObject({ kind: "ThisExpr" });
  });

  it("overrides precedence with parentheses", () => {
    expect(parseExpr("(1 + 2) * 3")).toMatchObject({
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

describe("Parser - Assignment Expressions", () => {
  it("parses variable, member, and indexed assignments", () => {
    expect(parseExpr("x = 42")).toMatchObject({
      kind: "Assign",
      target: { kind: "Identifier", name: "x" },
      value: { kind: "IntLit", value: 42n },
    });

    expect(parseExpr("this.x = 1")).toMatchObject({
      kind: "Assign",
      target: {
        kind: "MemberAccess",
        object: { kind: "ThisExpr" },
        name: { lexeme: "x" },
      },
      value: { kind: "IntLit", value: 1n },
    });

    expect(parseExpr("mat[i, j] = 0")).toMatchObject({
      kind: "Assign",
      target: { kind: "Index", object: { kind: "Identifier", name: "mat" } },
      value: { kind: "IntLit", value: 0n },
    });
  });

  it("groups chained assignments right-to-left and works inside let initializers", () => {
    // a = b = 3 => a = (b = 3)
    expect(parseExpr("a = b = 3")).toMatchObject({
      kind: "Assign",
      target: { kind: "Identifier", name: "a" },
      value: {
        kind: "Assign",
        target: { kind: "Identifier", name: "b" },
        value: { kind: "IntLit", value: 3n },
      },
    });

    expect(parseProgram("let x = a = b = 3;")[0]).toMatchObject({
      kind: "VarDecl",
      name: { lexeme: "x" },
      initializer: {
        kind: "Assign",
        target: { kind: "Identifier", name: "a" },
        value: { kind: "Assign", target: { kind: "Identifier", name: "b" } },
      },
    });
  });

  it("binds assignment looser than ternary (a = cond ? 1 : 2)", () => {
    expect(parseExpr("a = cond ? 1 : 2")).toMatchObject({
      kind: "Assign",
      target: { kind: "Identifier", name: "a" },
      value: { kind: "If", condition: { kind: "Identifier", name: "cond" } },
    });
  });
});

describe("Parser - Associativity & Precedence Hierarchy", () => {
  it("groups additive, multiplicative, and div left-to-right", () => {
    expect(parseExpr("10 - 3 - 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "-" },
      left: { kind: "Binary", operator: { lexeme: "-" } },
      right: { kind: "IntLit", value: 2n },
    });

    expect(parseExpr("16 div 4 div 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "div" },
      left: { kind: "Binary", operator: { lexeme: "div" } },
      right: { kind: "IntLit", value: 2n },
    });
  });

  it("groups exponentiation (**) right-to-left and allows unary minus on the exponent", () => {
    expect(parseExpr("2 ** 3 ** 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "**" },
      left: { kind: "IntLit", value: 2n },
      right: { kind: "Binary", operator: { lexeme: "**" } },
    });

    expect(parseExpr("2 ** -3")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "**" },
      right: { kind: "Unary", operator: { lexeme: "-" }, operand: { kind: "IntLit", value: 3n } },
    });
  });

  it("groups nested ternary (? :) right-to-left", () => {
    expect(parseExpr("a ? b : c ? d : e")).toMatchObject({
      kind: "If",
      condition: { kind: "Identifier", name: "a" },
      success: { kind: "Identifier", name: "b" },
      fail: { kind: "If", condition: { kind: "Identifier", name: "c" } },
    });
  });

  it("binds postfix (!) > power (**) > prefix unary (-) > mult > add > shift > bitwise > cmp > && > || > ternary", () => {
    expect(parseExpr("-2 ** 3!")).toMatchObject({
      kind: "Unary",
      operator: { lexeme: "-" },
      operand: {
        kind: "Binary",
        operator: { lexeme: "**" },
        left: { kind: "IntLit", value: 2n },
        right: { kind: "PostfixUnary", operator: { lexeme: "!" } },
      },
    });

    expect(parseExpr("3 + 4i * 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "+" },
      right: { kind: "Binary", operator: { lexeme: "*" } },
    });

    expect(parseExpr("x << 1 + 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "<<" },
      right: { kind: "Binary", operator: { lexeme: "+" } },
    });

    expect(parseExpr("a | b ^ c & d")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "|" },
      right: {
        kind: "Binary",
        operator: { lexeme: "^" },
        right: { kind: "Binary", operator: { lexeme: "&" } },
      },
    });

    expect(parseExpr("a <= b == c >= d")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "==" },
      left: { kind: "Binary", operator: { lexeme: "<=" } },
      right: { kind: "Binary", operator: { lexeme: ">=" } },
    });

    expect(parseExpr("A cross B + C")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "+" },
      left: { kind: "Binary", operator: { lexeme: "cross" } },
    });

    expect(parseExpr("S1 union S2 inter S3")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "union" },
      right: { kind: "Binary", operator: { lexeme: "inter" } },
    });

    expect(parseExpr("a || b && c ? 1 : 0")).toMatchObject({
      kind: "If",
      condition: {
        kind: "Binary",
        operator: { lexeme: "||" },
        right: { kind: "Binary", operator: { lexeme: "&&" } },
      },
    });
  });


  it("parses implicit multiplication (3b, 4i2, 2x ** 2, 2(x + 1)) with math precedence", () => {
    expect(parseExpr("3b")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "*" },
      left: { kind: "IntLit", value: 3n },
      right: { kind: "Identifier", name: "b" },
    });

    expect(parseExpr("4i2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "*" },
      left: { kind: "IntLit", value: 4n },
      right: { kind: "Identifier", name: "i2" },
    });

    expect(parseExpr("2x ** 2")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "*" },
      left: { kind: "IntLit", value: 2n },
      right: { kind: "Binary", operator: { lexeme: "**" } },
    });

    expect(parseExpr("2(x + 1)")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "*" },
      left: { kind: "IntLit", value: 2n },
      right: { kind: "Grouping" },
    });
  });

  it("does not combine non-adjacent < = or > > tokens", () => {
    expect(() => parseExpr("a < = b")).toThrow();
    expect(() => parseExpr("a > > b")).toThrow();
  });



  it("parses nested vectors <a, <1, 2>>, unary ! precedence, and decoded string escapes", () => {
    expect(parseExpr("<a, <1, 2>>")).toMatchObject({
      kind: "VectorLit",
      elements: [
        { kind: "Identifier", name: "a" },
        { kind: "VectorLit", elements: [{ value: 1n }, { value: 2n }] },
      ],
    });

    expect(parseExpr("!a == b")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "==" },
      left: { kind: "Unary", operator: { lexeme: "!" }, operand: { name: "a" } },
      right: { kind: "Identifier", name: "b" },
    });

    expect(parseExpr('"a\\nb\\t\\"c\\\\"')).toMatchObject({
      kind: "StringLit",
      value: 'a\nb\t"c\\',
    });
    expect(() => parseExpr('"\\q"')).toThrow(/Invalid escape sequence/);
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
      indexes: [{ kind: "IntLit", value: 0n }],
    });

    expect(parseExpr("m[i, j + 1]")).toMatchObject({
      kind: "Index",
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
    expect(sliceToEnd).toMatchObject({ kind: "Slicing", end: { kind: "IntLit", value: 4n } });
    if (sliceToEnd.kind === "Slicing") expect(sliceToEnd.start).toBeUndefined();

    const sliceFromStart = parseExpr("a[1:]");
    expect(sliceFromStart).toMatchObject({ kind: "Slicing", start: { kind: "IntLit", value: 1n } });
    if (sliceFromStart.kind === "Slicing") expect(sliceFromStart.end).toBeUndefined();

    const fullSlice = parseExpr("a[:]");
    expect(fullSlice).toMatchObject({ kind: "Slicing" });
    if (fullSlice.kind === "Slicing") {
      expect(fullSlice.start).toBeUndefined();
      expect(fullSlice.end).toBeUndefined();
    }
  });
});

describe("Parser - Collections, Vectors, Matrices & Dynamic Lists", () => {
  it("parses empty and populated vectors <1, 2, 3> and 2D matrices <1, 2; 3, 4>", () => {
    expect(parseExpr("<>")).toMatchObject({ kind: "VectorLit", elements: [] });
    expect(parseExpr("<1, 2, 3>")).toMatchObject({ kind: "VectorLit" });
    expect(parseExpr("<1, 2; 3, 4>")).toMatchObject({ kind: "MatrixLit", nbRows: 2, nbCols: 2 });
    expect(parseExpr("<1; 2; 3>")).toMatchObject({ kind: "MatrixLit", nbRows: 3, nbCols: 1 });
  });

  it("distinguishes sets {1, 2} from maps {\"a\": 1}", () => {
    expect(parseExpr("{1, 2, 3}")).toMatchObject({ kind: "SetLit" });
    expect(parseExpr('{"a": 1, "b": 2}')).toMatchObject({ kind: "MapLit" });
  });

  it("distinguishes standard lists from dynamic range lists (inclusive 'to' vs exclusive 'until')", () => {
    expect(parseExpr("[]")).toMatchObject({ kind: "ListLit", elements: [] });
    expect(parseExpr("[1, 2, 3]")).toMatchObject({ kind: "ListLit" });

    expect(parseExpr("[1 to 5]")).toMatchObject({
      kind: "ListDynamicLit",
      start: { kind: "IntLit", value: 1n },
      end: { kind: "IntLit", value: 5n },
      inclusive: true,
    });

    expect(parseExpr("[0 until 10 by 2]")).toMatchObject({
      kind: "ListDynamicLit",
      start: { kind: "IntLit", value: 0n },
      end: { kind: "IntLit", value: 10n },
      step: { kind: "IntLit", value: 2n },
      inclusive: false,
    });
  });
});

describe("Parser - Control Flow & Block Expressions", () => {
  it("parses blocks with implicit return expressions vs semicolon statements", () => {
    expect(parseExpr("{}")).toMatchObject({ kind: "Block", statements: [] });

    expect(parseExpr("{ let x = 2; x * 3 }")).toMatchObject({
      kind: "Block",
      statements: [{ kind: "VarDecl", name: { lexeme: "x" } }],
      returnExpr: { kind: "Binary", operator: { lexeme: "*" } },
    });

    const voidBlock = parseExpr("{ let x = 2; x * 3; }");
    expect(voidBlock).toMatchObject({ kind: "Block" });
    if (voidBlock.kind === "Block") expect(voidBlock.returnExpr).toBeUndefined();
  });

  it("marks expressions after explicit return as unreachable and rejects missing top-level semicolons", () => {
    const afterReturn = parseExpr("{ return 1; 2 }");
    expect(afterReturn).toMatchObject({
      kind: "Block",
      statements: [{ kind: "ReturnStmt" }],
      unreachable: [{ kind: "ExprStmt", expr: { kind: "IntLit", value: 2n } }],
    });
    if (afterReturn.kind === "Block") expect(afterReturn.returnExpr).toBeUndefined();

    expect(() => parseProgram("1 2")).toThrow(/Expected ';'/);
  });

  it("parses if, else if, else, while, for, and match expressions", () => {
    expect(parseExpr("if x > 0 { x } else if x < 0 { -x } else { 0 }")).toMatchObject({
      kind: "If",
      fail: { kind: "If", fail: { kind: "Block" } },
    });

    expect(parseExpr("while i > 0 { i = i - 1; }")).toMatchObject({
      kind: "While",
      condition: { kind: "Binary", operator: { lexeme: ">" } },
      block: { kind: "Block" },
    });

    expect(parseExpr("for _ in [1 to 3] { continue; }")).toMatchObject({
      kind: "For",
      identifier: { lexeme: "_" },
      expr: { kind: "ListDynamicLit" },
      block: { kind: "Block" },
    });

    expect(parseExpr("match n { 0 => 1, 1 | 2 => 2, _ => { n } }")).toMatchObject({
      kind: "Match",
      expr: { kind: "Identifier", name: "n" },
      arms: [
        { patterns: [{ kind: "IntLit", value: 0n }], success: { kind: "IntLit", value: 1n } },
        { patterns: [{ kind: "IntLit", value: 1n }, { kind: "IntLit", value: 2n }] },
        { patterns: [{ kind: "Wildcard" }], success: { kind: "Block" } },
      ],
    });
  });

  it("marks statements after an early implicit return as unreachable, without blocking mid-block if/while", () => {
    const earlyReturn = parseExpr("{ let x = 2; x * 3 let y = 10; }");
    expect(earlyReturn).toMatchObject({
      kind: "Block",
      statements: [{ kind: "VarDecl", name: { lexeme: "x" } }],
      returnExpr: { kind: "Binary", operator: { lexeme: "*" } },
      unreachable: [{ kind: "VarDecl", name: { lexeme: "y" } }],
    });

    const midIf = parseExpr("{ if x > 0 { log(x); } x * 3 }");
    expect(midIf).toMatchObject({
      kind: "Block",
      statements: [{ kind: "ExprStmt", expr: { kind: "If" }, hasSemicolon: false }],
      returnExpr: { kind: "Binary", operator: { lexeme: "*" } },
    });
    if (midIf.kind === "Block") {
      expect(midIf.unreachable).toBeUndefined();
    }

    const trailingIf = parseExpr("{ let x = 2; if x > 0 { x } else { -x } }");
    expect(trailingIf).toMatchObject({
      kind: "Block",
      statements: [{ kind: "VarDecl", name: { lexeme: "x" } }],
      returnExpr: { kind: "If" },
    });
  });
});

describe("Parser - Declarations & Statements", () => {
  it("parses import declarations", () => {
    expect(parseProgram('import "linear_algebra";')[0]).toMatchObject({
      kind: "ImportDecl",
      path: { lexeme: '"linear_algebra"' },
    });
  });

  it("parses let and const declarations with primitives, nested generics, optionals, and function types", () => {
    const stmts = parseProgram(`
      let a = 10;
      const b: Int? = None;
      let c: Map<String, List<List<Int>>> = {"grid": [[1, 2]]};
      let fnType: (Int, Float) -> Boolean? = check;
    `);

    expect(stmts[0]).toMatchObject({ kind: "VarDecl", isConst: false, name: { lexeme: "a" } });
    expect(stmts[1]).toMatchObject({
      kind: "VarDecl",
      isConst: true,
      typeAnnotation: { kind: "NamedType", name: { lexeme: "Int" }, optional: true },
    });
    expect(stmts[2]).toMatchObject({
      kind: "VarDecl",
      typeAnnotation: {
        kind: "NamedType",
        name: { lexeme: "Map" },
        typeParams: [
          { kind: "NamedType", name: { lexeme: "String" } },
          {
            kind: "NamedType",
            name: { lexeme: "List" },
            typeParams: [
              {
                kind: "NamedType",
                name: { lexeme: "List" },
                typeParams: [{ kind: "NamedType", name: { lexeme: "Int" } }],
              },
            ],
          },
        ],
      },
    });
    expect(stmts[3]).toMatchObject({
      kind: "VarDecl",
      typeAnnotation: {
        kind: "FuncType",
        params: [{ kind: "NamedType" }, { kind: "NamedType" }],
        returnType: { kind: "NamedType", name: { lexeme: "Boolean" }, optional: true },
      },
    });
  });

  it("parses function declarations (block, expression-bodied, typed/untyped params, parameterless, doc comments)", () => {
    const stmts = parseProgram(`
      /// Adds two integers
      func add(a: Int, b: Int): Int {
        return a + b;
      }
      func square(x) => x * x;
      func pi: Float => 3.14159;
      func empty() {}
    `);

    expect(stmts[0]).toMatchObject({
      kind: "FuncDecl",
      docComment: "Adds two integers",
      identifier: { lexeme: "add" },
      params: [
        { name: { lexeme: "a" }, typeAnnotation: { kind: "NamedType", name: { lexeme: "Int" } } },
        { name: { lexeme: "b" }, typeAnnotation: { kind: "NamedType", name: { lexeme: "Int" } } },
      ],
      returnType: { kind: "NamedType", name: { lexeme: "Int" } },
      body: { kind: "Block" },
    });

    expect(stmts[1]).toMatchObject({
      kind: "FuncDecl",
      identifier: { lexeme: "square" },
      params: [{ name: { lexeme: "x" } }],
      body: { kind: "Binary", operator: { lexeme: "*" } },
    });

    expect(stmts[2]).toMatchObject({
      kind: "FuncDecl",
      identifier: { lexeme: "pi" },
      params: [],
      returnType: { kind: "NamedType", name: { lexeme: "Float" } },
      body: { kind: "FloatLit", value: 3.14159 },
    });

    expect(stmts[3]).toMatchObject({
      kind: "FuncDecl",
      identifier: { lexeme: "empty" },
      params: [],
      body: { kind: "Block", statements: [] },
    });
  });

  it("parses class declarations (empty, inheritance, fields, methods, doc comments)", () => {
    const stmts = parseProgram(`
      class Empty {}
      /// A 2D vector
      class Vec2 inherits Shape {
        let x: Float = 0.0;
        const dim: Int = 2;
        func norm: Float {
          return (this.x ** 2).sqrt;
        }
      }
      let after = 1;
    `);

    expect(stmts[0]).toMatchObject({
      kind: "ClassDecl",
      identifier: { lexeme: "Empty" },
      members: [],
    });

    expect(stmts[1]).toMatchObject({
      kind: "ClassDecl",
      docComment: "A 2D vector",
      identifier: { lexeme: "Vec2" },
      inherits: { lexeme: "Shape" },
      members: [
        { kind: "VarDecl", isConst: false, name: { lexeme: "x" } },
        { kind: "VarDecl", isConst: true, name: { lexeme: "dim" } },
        { kind: "FuncDecl", identifier: { lexeme: "norm" } },
      ],
    });

    expect(stmts[2]).toMatchObject({ kind: "VarDecl", name: { lexeme: "after" } });
  });

  it("parses return, break (with and without value), and continue statements", () => {
    const stmts = parseProgram(`
      return;
      return 42;
      break;
      break x + 1;
      continue;
    `);

    expect(stmts[0]).toMatchObject({ kind: "ReturnStmt" });
    expect(stmts[1]).toMatchObject({ kind: "ReturnStmt", returned: { kind: "IntLit", value: 42n } });
    expect(stmts[2]).toMatchObject({ kind: "BreakStmt" });
    expect(stmts[3]).toMatchObject({ kind: "BreakStmt", returned: { kind: "Binary" } });
    expect(stmts[4]).toMatchObject({ kind: "ContinueStmt" });
  });
});

describe("Parser - Syntax Error Detection", () => {
  it("throws descriptive errors on malformed expressions and statements", () => {
    expect(() => parseExpr("(1 + 2")).toThrow(/Expected '\)'/);
    expect(() => parseExpr("f(1, 2")).toThrow(/Expected '\)'/);
    expect(() => parseExpr("arr[0")).toThrow(/Expected '\]'/);
    expect(() => parseExpr("<1, 2")).toThrow(/Expected '>'/);
    expect(() => parseExpr("<1, 2; 3>")).toThrow(/Matrix row 2 has 1 columns, expected 2/);
    expect(() => parseExpr("1 + * 2")).toThrow(/Unexpected token '\*'/);
    expect(() => parseExpr("a ? b")).toThrow(/Expected ':'/);
    expect(() => parseExpr("1 = 2")).toThrow(/Invalid assignment target/);
    expect(() => parseExpr("(a) = 2")).toThrow(/Invalid assignment target/);
    expect(() => parseExpr("for 123 in list {}")).toThrow(/Expected identifier or '_'/);
    expect(() => parseExpr("match x { 1 2 }")).toThrow(/Expected '=>'/);
    expect(() => parseProgram("let x: Map<Int> = 0;")).toThrow(/Expected ','/);
    expect(() => parseProgram("let x = 5")).toThrow(/Expected ';'/);
    expect(() => parseProgram("import 123;")).toThrow(/Expected string/);
    expect(() => parseProgram("class Foo { let x = 1;")).toThrow(/Expected '}'/);
    expect(() => parseProgram("func f(a: Int b: Int) {}")).toThrow(/Expected '\)'/);
    expect(() => parseProgram("func f() => 1")).toThrow(/Expected ';'/);
    expect(() => parseProgram("continue")).toThrow(/Expected ';'/);
    expect(() => parseExpr("")).toThrow(/Unexpected token/);
  });
});

describe("Parser - Precedence, Control-Flow & Constructor Edge Cases", () => {
  it("binds IMPLICIT_MUL tighter than unary and division (-2x, 2 ** -3x, 1 / 2π)", () => {
    expect(parseExpr("-2x")).toMatchObject({
      kind: "Unary",
      operator: { lexeme: "-" },
      operand: {
        kind: "Binary",
        operator: { lexeme: "*" },
        left: { kind: "IntLit", value: 2n },
        right: { kind: "Identifier", name: "x" },
      },
    });

    expect(parseExpr("2 ** -3x")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "**" },
      left: { kind: "IntLit", value: 2n },
      right: {
        kind: "Unary",
        operator: { lexeme: "-" },
        operand: { kind: "Binary", operator: { lexeme: "*" } },
      },
    });

    expect(parseExpr("1 / 2π")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "/" },
      left: { kind: "IntLit", value: 1n },
      right: {
        kind: "Binary",
        operator: { lexeme: "*" },
        left: { kind: "IntLit", value: 2n },
        right: { kind: "Identifier", name: "π" },
      },
    });
  });

  it("parses '=>' one-liner if/else/while/for, block-started while conditions, and ternary assignments", () => {
    expect(parseExpr("if flag => -1 else => 1")).toMatchObject({
      kind: "If",
      success: { kind: "Unary", operator: { lexeme: "-" } },
      fail: { kind: "IntLit", value: 1n },
    });

    expect(parseExpr("while i > 0 => i = i - 1")).toMatchObject({
      kind: "While",
      block: { kind: "Assign" },
    });

    expect(parseExpr("for x in xs => x * 2")).toMatchObject({
      kind: "For",
      block: { kind: "Binary", operator: { lexeme: "*" } },
    });

    expect(parseExpr("while { let a = 1; a > 0 } && running { break; }")).toMatchObject({
      kind: "While",
      condition: { kind: "Binary", operator: { lexeme: "&&" }, left: { kind: "Block" } },
    });

    expect(parseExpr("cond ? a = 1 : b = 2")).toMatchObject({
      kind: "If",
      success: { kind: "Assign", target: { name: "a" } },
      fail: { kind: "Assign", target: { name: "b" } },
    });
  });

  it("parses signed match patterns, trailing commas, collection constructors, and generic Vector/Matrix types", () => {
    expect(parseExpr("match x { -1 | +1 => true, _ => false, }")).toMatchObject({
      kind: "Match",
      arms: [
        {
          patterns: [
            { kind: "Unary", operator: { lexeme: "-" }, operand: { value: 1n } },
            { kind: "Unary", operator: { lexeme: "+" }, operand: { value: 1n } },
          ],
        },
        { patterns: [{ kind: "Wildcard" }] },
      ],
    });

    expect(parseExpr("Deque([1, 2])")).toMatchObject({
      kind: "FunctionCall",
      object: { kind: "Identifier", name: "Deque" },
      args: [{ kind: "ListLit" }],
    });
    expect(() => parseExpr("Set")).toThrow(/Expected '\(' after collection constructor/);

    const stmts = parseProgram(`
      let v: Vector<Complex> = <1i>;
      let m: Matrix<Float> = <1.0; 2.0>;
      func pi: Float => 3.14;
      func empty() {}
    `);
    expect(stmts[0]).toMatchObject({
      typeAnnotation: { name: { lexeme: "Vector" }, typeParams: [{ name: { lexeme: "Complex" } }] },
    });
    expect(stmts[2]).toMatchObject({ kind: "FuncDecl", hasParens: false });
    expect(stmts[3]).toMatchObject({ kind: "FuncDecl", hasParens: true });
  });

  it("parses blocks starting with statement keywords and rejects malformed control flow / class bodies", () => {
    expect(parseExpr("{ func f() => 1; f() }")).toMatchObject({
      kind: "Block",
      statements: [{ kind: "FuncDecl" }],
      returnExpr: { kind: "FunctionCall" },
    });
    expect(() => parseExpr("if a b")).toThrow(/Expected '\{' or '=>'/);
    expect(() => parseExpr("if a => 1 else 2")).toThrow(/Expected '\{', 'if', or '=>'/);
    expect(() => parseExpr("match x { 1 => 2 3 => 4 }")).toThrow(/Expected '\}'/);
    expect(() => parseProgram("class A { 123; }")).toThrow(/Expected 'let', 'const', or 'func'/);
  });
});