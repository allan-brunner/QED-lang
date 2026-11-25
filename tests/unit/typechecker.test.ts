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
          let b: Int = x div 2;
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

    it("infers typed vectors/matrices, promotes numerics, and enforces strict linear algebra", () => {
        expect(() =>
            check(`
        let vi = <1, 2, 3>;                    // Vector<Int>
        let vf = <1, 2.5, 3>;                  // Vector<Float>
        let vd: Vector = vi;                   // Vector<Int> widens to Vector<Double>
        let vc = 2i * vi;                      // Vector<Complex>
        let dot: Float = vi * vf;              // Dot product -> Float
        let scaled: Vector<Double> = vi / 2;   // Int / Int -> Double
        let m = <1, 2; 3, 4>;                  // Matrix<Int>
        let mv: Vector<Float> = m * vf;        // Matrix * Vector -> Vector<Float>
        let cell: Int = m[0, 1];
        let row: Vector<Int> = m[0];
        let cp: Vector<Int> = vi cross <4, 5, 6>;
      `)
        ).not.toThrow();

        // Strict linear algebra rejections
        expect(() => check("let x = <1, 2> + 1;")).toThrow(/cannot be applied/);
        expect(() => check("let x = <1, 2; 3, 4> + 1;")).toThrow(/cannot be applied/);
        expect(() => check("let x = 2 cross <1, 2, 3>;")).toThrow(/cannot be applied/);
        expect(() => check("let x = 1 / <1, 2>;")).toThrow(/cannot be applied/);
        expect(() => check('let x = <1, "a">;')).toThrow(/must be numeric/);
        expect(() => check("let x: Vector<String> = <>;")).toThrow(/must be numeric/);
    });

    it("checks lists, dynamic ranges, sets, maps, contextual empty literals, indexing & slicing", () => {
        expect(() =>
            check(`
      let nums = [1, 2, 3];                        // List<Int>
      let mixed: List<Float> = [1, 2.5];           // Element widening
      let optList = [1, None];                     // List<Int?>
      let nested: List<List<Int>> = [[], [1, 2]];  // Contextual empty inner list
      let range1: List<Int> = [1 to 10 by 2];
      let range2: List<Float> = [0.0 until 1.0 by 0.25];
      let range3: List<Float> = [0 until 5 by 0.5];
      let s: Set<Int> = {1, 2, 3};
      let s2 = s union {4, 5};
      let m = {"a": 1, "b": 2.5};                  // Map<String, Float>
      let m2: Map<String, Int>? = {};              // Contextual optional empty map

      let first: Int = nums[0];
      let sub: List<Int> = nums[1:3];
      let val: Float = m["a"];
      nums[0] = 99;
      m["c"] = 3;
      let hasKey: Boolean = "a" in m;
      let hasElem: Boolean = 2 in s2;
    `)
        ).not.toThrow();

        // Rejections
        expect(() => check("let a = [];")).toThrow(/Cannot infer element type/);
        expect(() => check('let a = [1, "oops"];')).toThrow(/Incompatible List element types/);
        expect(() => check("let a: List<Int> = [1]; let b: List<Float> = a;")).toThrow(/Cannot assign/);
        expect(() => check('let r = ["a" to "z"];')).toThrow(/must be real numeric/);
        expect(() => check("let r = [1i to 5i];")).toThrow(/must be real numeric/);
        expect(() => check('let m = {"a": 1}; let x = m[0];')).toThrow(/Map key/);
        expect(() => check('let s = "abc"; s[0] = "z";')).toThrow(/Cannot mutate a String/);
        expect(() => check('let a = [1, 2]; let s = a["0":1];')).toThrow(/must be an integer/);
    });
});