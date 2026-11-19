import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/core/lexer.js";
import { Parser } from "../../src/core/parser.js";
import { TypeChecker } from "../../src/core/typechecker.js";

function check(code: string): TypeChecker {
    const program = new Parser(tokenize(code)).parseProgram();
    const checker = new TypeChecker();
    checker.checkProgram(program);
    return checker;
}

describe("TypeChecker - Base", () => {
    it("checks variable declarations, inference, optionals, blocks, and contextual empty Map/Set", () => {
        expect(() =>
            check(`
        let x = 10;
        const y: Int? = None;
        let m: Map<String, Int> = {};
        let s: Set<Int> = {};
        let res: Int = {
          let a = x + 5;
          if a == 15 { a } else => 0
        };
      `)
        ).not.toThrow();
    });

    it("rejects type mismatches, const reassignment, undefined vars, and unreachable code", () => {
        expect(() => check('let x: Int = "oops";')).toThrow(/Cannot assign 'String'/);
        expect(() => check("const a = 1; a = 2;")).toThrow(/Cannot reassign constant/);
        expect(() => check("let a = unknownVar;")).toThrow(/Undefined identifier/);
        expect(() => check("let a = None;")).toThrow(/Cannot infer type/);
        expect(() => check("let a = { 1 2 };")).toThrow(/Unreachable code/);
    });
});