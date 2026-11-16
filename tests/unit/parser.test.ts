import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/core/lexer.js";
import { Parser } from "../../src/core/parser.js";

const parseExpr = (code: string) => new Parser(tokenize(code)).parseExpression();

describe("Parser - Primary literals & grouping", () => {
  it("parses all primitive literal types accurately", () => {
    expect(parseExpr("42")).toMatchObject({ kind: "IntLit", value: 42n });
    expect(parseExpr("3.14")).toMatchObject({ kind: "FloatLit", value: 3.14 });
    expect(parseExpr("4i")).toMatchObject({ kind: "ComplexLit", real: 0, imaginary: 4 });
    expect(parseExpr('"hello"')).toMatchObject({ kind: "StringLit", value: "hello" });
    expect(parseExpr("true")).toMatchObject({ kind: "BooleanLit", value: true });
    expect(parseExpr("false")).toMatchObject({ kind: "BooleanLit", value: false });
    expect(parseExpr("None")).toMatchObject({ kind: "NoneLit" });
    expect(parseExpr("θ")).toMatchObject({ kind: "Identifier", name: "θ" });
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
        }
      },
      right: { kind: "IntLit", value: 3n },
    });
  });
});

describe("Parser - Associativity", () => {
  it("groups additive, multiplicative, and div left-to-right", () => {
    // 10 - 3 - 2 => (10 - 3) - 2
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

    // 16 div 4 div 2 => (16 div 4) div 2
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

  it("groups exponentiation (**) right-to-left", () => {
    // 2 ** 3 ** 2 => 2 ** (3 ** 2)
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
  });

  it("groups nested ternary (? :) right-to-left", () => {
    // a ? b : c ? d : e => a ? b : (c ? d : e)
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

describe("Parser - Full precedence hierarchy", () => {
  it("binds postfix (!) tighter than power (**), and power tighter than prefix unary (-)", () => {
    // -2 ** 3! => -(2 ** (3!))
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

  it("binds arithmetic tighter than bit shifts (x << 1 + 2)", () => {
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
  });

  it("binds vector/set operators correctly (A cross B + C)", () => {
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
  });

  it("binds comparisons and approximate equality (~=) looser than math", () => {
    // a + b ~= c * d => (a + b) ~= (c * d)
    expect(parseExpr("a + b ~= c * d")).toMatchObject({
      kind: "Binary",
      operator: { lexeme: "~=" },
      left: { kind: "Binary", operator: { lexeme: "+" } },
      right: { kind: "Binary", operator: { lexeme: "*" } },
    });
  });

  it("binds && tighter than ||, and || tighter than ternary (? :)", () => {
    // a || b && c ? 1 : 0 => (a || (b && c)) ? 1 : 0
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

describe("Parser - Postfix chaining, calls, indexing & slicing", () => {
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

describe("Parser - Syntax error detection", () => {
  it("throws descriptive errors on malformed expressions", () => {
    expect(() => parseExpr("(1 + 2")).toThrow(/Expected '\)'/);
    expect(() => parseExpr("f(1, 2")).toThrow(/Expected '\)'/);
    expect(() => parseExpr("arr[0")).toThrow(/Expected '\]'/);
    expect(() => parseExpr("1 + * 2")).toThrow(/Unexpected token '\*'/);
    expect(() => parseExpr("a ? b")).toThrow(/Expected ':'/);
    expect(() => parseExpr("")).toThrow(/Unexpected token/);
  });
});

describe("Parser - Collections, control flow & statements", () => {
  it("parses vectors @[1, 2, 3] and 2D matrices @[1, 2; 3, 4]", () => {
    expect(parseExpr("@[1, 2, 3]").kind).toBe("VectorLit");
    expect(parseExpr("@[1, 2; 3, 4]").kind).toBe("MatrixLit");
  });

  it("distinguishes sets {1, 2} from maps {\"a\": 1}", () => {
    expect(parseExpr("{1, 2}").kind).toBe("SetLit");
    expect(parseExpr('{"a": 1}').kind).toBe("MapLit");
  });

  it("distinguishes lists [1, 2, 3] from dynamic lists [1 to 3]", () => {
    expect(parseExpr("[1, 2, 3]").kind).toBe("ListLit");
    expect(parseExpr('[1 to 3]').kind).toBe("ListDynamicLit");
  });

  it.skip("parses blocks with implicit return expressions vs semicolon statements", () => {
    const withReturn = parseExpr("{ let x = 2; x * 3 }");
    expect(withReturn.kind).toBe("Block");

    const voidBlock = parseExpr("{ let x = 2; x * 3; }");
    expect(voidBlock.kind).toBe("Block");
  });

  it("parses while and for expressions", () => {
    expect(parseExpr("while i != 0 i").kind).toBe("While");
    expect(parseExpr("while i > 0 {i + 4}").kind).toBe("While");
    expect(parseExpr("for _ in [1, 2, 3] {1 + 3;}").kind).toBe("For");
    expect(parseExpr("for i in [1 to 3 by 1] i").kind).toBe("For");
  });

  it("parses if/else and match expressions", () => {
    expect(parseExpr("if x > 0 { x } else { -x }").kind).toBe("If");
    expect(parseExpr("match n { 0 => 1 _ => {n} }").kind).toBe("Match");
  });
});
