import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/core/lexer.js";
import { Parser } from "../../src/core/parser.js";
import { TypeChecker } from "../../src/core/typechecker.js";
import { Diagnostic } from "../../src/core/diagnostics.js";

function check(code: string): { checker: TypeChecker; diagnostics: readonly Diagnostic[] } {
    const program = new Parser(tokenize(code)).parseProgram();
    const checker = new TypeChecker();
    const diagnostics = checker.checkProgram(program.stmts);
    return { checker, diagnostics };
}

describe("TypeChecker - Base", () => {
    it("checks variable declarations, inference, optionals, blocks, and contextual empty Map/Set", () => {
        expect(check(`
        let x = 10;
        const y: Int? = None;
        let m: Map<String, Int> = {};
        let s: Set<Int> = {};
        let res: Int = {
          let a = x + 5;
          let b: Int = x div 2;
          if a == 15 { a } else => 0
        };
      `).diagnostics).toEqual([]);
    });

    it("rejects type mismatches, const reassignment, undefined vars, and unreachable code", () => {
        expect(check('let x: Int = "oops";').diagnostics[0].message).toMatch(/Cannot assign 'String'/);
        expect(check("const a = 1; a = 2;").diagnostics[0].message).toMatch(/Cannot reassign constant/);
        expect(check("let a = unknownVar;").diagnostics[0].message).toMatch(/Undefined identifier/);
        expect(check("let a = None;").diagnostics[0].message).toMatch(/Cannot infer type/);
        expect(check("let a = { 1 2 };").diagnostics[0].message).toMatch(/Unreachable code/);
    });

    it("infers typed vectors/matrices, promotes numerics, and enforces strict linear algebra", () => {
        expect(
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
      `).diagnostics
        ).toEqual([]);

        // Strict linear algebra rejections
        expect(check("let x = <1, 2> + 1;").diagnostics[0].message).toMatch(/cannot be applied/);
        expect(check("let x = <1, 2; 3, 4> + 1;").diagnostics[0].message).toMatch(/cannot be applied/);
        expect(check("let x = 2 cross <1, 2, 3>;").diagnostics[0].message).toMatch(/cannot be applied/);
        expect(check("let x = 1 / <1, 2>;").diagnostics[0].message).toMatch(/cannot be applied/);
        expect(check('let x = <1, "a">;').diagnostics[0].message).toMatch(/must be numeric/);
        expect(check("let x: Vector<String> = <>;").diagnostics[0].message).toMatch(/must be numeric/);
    });

    it("checks lists, dynamic ranges, sets, maps, contextual empty literals, indexing & slicing", () => {
        expect(check(`
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
    `).diagnostics
        ).toEqual([]);

        // Rejections
        expect(check("let a = [];").diagnostics[0].message).toMatch(/Cannot infer element type/);
        expect(check('let a = [1, "oops"];').diagnostics[0].message).toMatch(/Incompatible List element types/);
        expect(check("let a: List<Int> = [1]; let b: List<Float> = a;").diagnostics[0].message).toMatch(/Cannot assign/);
        expect(check('let r = ["a" to "z"];').diagnostics[0].message).toMatch(/must be real numeric/);
        expect(check("let r = [1i to 5i];").diagnostics[0].message).toMatch(/must be real numeric/);
        expect(check('let m = {"a": 1}; let x = m[0];').diagnostics[0].message).toMatch(/Map key/);
        expect(check('let s = "abc"; s[0] = "z";').diagnostics[0].message).toMatch(/Cannot mutate a String/);
        expect(check('let a = [1, 2]; let s = a["0":1];').diagnostics[0].message).toMatch(/must be an integer/);
    });

    it("checks while, for, break/continue, and match expressions", () => {
        expect(check(`
        let i = 0;
        while i < 5 {
            i = i + 1;
            if i == 3 { continue; }
        }

        // Loop returning a value via break -> Int?
        let found: Int? = for n in [1 to 10] {
            if n > 5 { break n; }
        };

        // Wildcard for-loop & matrix row iteration
        let sum = 0;
        for _ in [1, 2, 3] { sum = sum + 1; }
        for row in <1, 2; 3, 4> {
            let first: Int = row[0];
        }

        // Exhaustive match with numeric promotion and optional matching
        let label: Float = match i {
            0 => 1,
            1 | 2 => 2.5,
            _ => 0,
        };

        let flag = true;
        let boolMatch: Int = match flag {
            true => 1,
            false => 0,
        };

        let opt: Int? = None;
        let unwrapped: Int = match opt {
            None => 0,
            1 => 10,
            _ => -1,
        };

        // Side-effecting match without wildcard is allowed
        match i {
            0 => { sum = 0; },
        }
    `).diagnostics
        ).toEqual([]);

        // Rejections
        expect(check("while 1 { }").diagnostics[0].message).toMatch(/must be Boolean/);
        expect(check("for x in 42 { }").diagnostics[0].message).toMatch(/not iterable/);
        expect(check("for x in [1, 2] { x = 3; }").diagnostics[0].message).toMatch(/Cannot reassign constant/);
        expect(check("break;").diagnostics[0].message).toMatch(/inside a loop/);
        expect(check("continue;").diagnostics[0].message).toMatch(/inside a loop/);
        expect(check("return 1;").diagnostics[0].message).toMatch(/inside a function/);
        expect(check("for x in [1, 2] { if x == 1 { break; } else { break x; } }").diagnostics[0].message).toMatch(/Cannot mix/);
        expect(check('let x = match 1 { "a" => 1, _ => 2 };').diagnostics[0].message).toMatch(/cannot match/);
        expect(check("let x = match 1 { 0 => 1, 1 => 2 };").diagnostics[0].message).toMatch(/Non-exhaustive/);
        expect(check('let x = match 1 { 0 => 1, _ => "two" };').diagnostics[0].message).toMatch(/Incompatible 'match' arm types/);
        expect(check("let x = _;").diagnostics[0].message).toMatch(/Wildcard '_'/);
    });

    it("supports two-pass hoisting, recursion, functions, classes, inheritance, and this", () => {
        expect(check(`
      // Mutual recursion (requires two-pass hoisting)
      func isEven(n: Int): Boolean => n == 0 ? true : isOdd(n - 1);
      func isOdd(n: Int): Boolean => n == 0 ? false : isEven(n - 1);

      // Inferred return type & parameterless computed function
      func square(x: Int) => x * x;
      func pi: Float => 3.14159;
      let sq: Int = square(4);
      let circleArea: Double = pi * 2 ** 2;

      // Forward class inheritance & self-referential fields
      class Vec2 inherits Shape {
        let x: Float = 0.0;
        let y: Float = 0.0;
        const dim: Int = 2;

        func init(x: Float, y: Float) {
          this.x = x;
          this.y = y;
        }

        func norm: Double {
          return (this.x ** 2 + this.y ** 2).sqrt;
        }
      }

      class Shape {
        let id: Int = 0;
        func getId(): Int { return this.id; }
      }

      let v = Vec2(3.0, 4.0);
      let s: Shape = v;            // Subclass assignability
      let n: Double = v.norm;      // Auto-invoked parameterless method
      let id: Int = v.getId();     // Inherited method
      v.x = 1.0;
    `).diagnostics
        ).toEqual([]);

        // Rejections
        expect(check("class A inherits B {} class B inherits A {}").diagnostics[0].message).toMatch(/Circular inheritance/);
        expect(check("class A inherits Missing {}").diagnostics[0].message).toMatch(/not defined/);
        expect(check("let x = this;").diagnostics[0].message).toMatch(/inside a class method/);
        expect(check("func bad(x: Int): Int { if x > 0 { return 1; } }").diagnostics[0].message).toMatch(/body evaluates to 'Void'/);
        expect(check("func f(x: Int): Int => x; let a = f(1, 2);").diagnostics[0].message).toMatch(/Expected 1 argument/);
        expect(check("class C { const k: Int = 1; } let c = C(); c.k = 2;").diagnostics[0].message).toMatch(/constant field/);
        expect(check("let x = f(1); func f(a: Int) => a;").diagnostics[0].message).toMatch(/explicit return type/);
    });

    function checkWithModules(
        code: string,
        modules: Record<string, string>
    ): { checker: TypeChecker; diagnostics: readonly Diagnostic[] } {
        const loader = (path: string) => {
            const src = modules[path];
            return src !== undefined ? new Parser(tokenize(src)).parseProgram() : undefined;
        };
        const program = new Parser(tokenize(code)).parseProgram();
        const checker = new TypeChecker({ moduleLoader: loader });
        const diagnostics = checker.checkProgram(program.stmts);
        return { checker, diagnostics };
    }

    it("supports built-in module imports, user file imports, and built-in properties/methods", () => {
        expect(check(`
        import "math";
        import "linalg";
        import "io";

        // Math module & widening (Int -> Double)
        let angle: Double = sin(π / 2) + cos(0);
        let g: Int = gcd(12, 18);

        // Numeric & Complex properties
        let s: Double = 9.sqrt;
        let z = 3 + 4i;
        let r: Double = z.re;
        let mag: Double = z.abs;
        let conj: Complex = z.conj;
        let txt: String = 42.toString;

        // Vector & Matrix properties/methods
        let v = <3, 4>;
        let n: Double = v.norm;
        let u: Vector<Double> = v.unit;
        let d: Double = v.dot(<1, 0>);
        let id: Matrix<Double> = identity(3);
        let inv: Matrix<Double> = id.T.inv;
        let tr: Double = id.trace;

        // Collections & Optional helpers
        let xs = [1, 2, 3];
        xs.push(4);
        let top: Int? = xs.pop();
        let safe: Int = top.unwrapOr(0);
        let hasTwo: Boolean = xs.contains(2);

        let m = {"a": 1};
        let vOpt: Int? = m.get("a");
        let ks: List<String> = m.keys;
        println("done");
    `).diagnostics
        ).toEqual([]);

        // User module import + inheritance across files
        expect(checkWithModules(
            `
        import "shapes";
        class Circle inherits Shape {
          let r: Double = 1.0;
        }
        let c = Circle();
        let id: Int = c.getId();
        let d: Double = scale(2.0);
      `,
            {
                shapes: `
          class Shape {
            let id: Int = 1;
            func getId(): Int { return this.id; }
          }
          func scale(x: Double): Double => x * 2.0;
        `,
            }
        ).diagnostics
        ).toEqual([]);

        // Rejections
        expect(check('import "nonexistent";').diagnostics[0].message).toMatch(/Unknown module/);
        expect(checkWithModules('import "a";', { a: 'import "b";', b: 'import "a";' })
            .diagnostics[0].message).toMatch(/Circular import/);
        expect(check('func f() { import "math"; }').diagnostics[0].message).toMatch(/only allowed at the top level/);
        expect(check("let x = (3 + 4i).toInt;").diagnostics[0].message).toMatch(/has no property or method 'toInt'/);
        expect(check('let xs = [1, 2]; xs.push("bad");').diagnostics[0].message).toMatch(/cannot assign 'String' to 'Int'/);
    });

    it("checks Deque, Heap, and collection constructors", () => {
        expect(check(`
      let d1: Deque<Int> = Deque();
      let d2 = Deque([1, 2, 3]);
      let d3: Deque<Float> = Deque([1, 2]);
      d1.pushFront(10);
      d1.pushBack(20);
      let front: Int? = d1.front;
      let popped: Int? = d1.popBack();
      let elem: Int = d2[0];
      d2[0] = 99;
      let hasOne: Boolean = 1 in d2;
      for x in d2 { let n: Int = x; }

      let h1: Heap<Int> = Heap();
      let h2 = Heap([5, 1, 3]);
      let h3 = Heap(["c", "a", "b"]);
      h1.push(42);
      let top: Int? = h1.peek;
      let minVal: Int? = h1.pop();
      let sorted: List<Int> = h2.toList();
      for v in h2 { let n: Int = v; }

      let s1: Set<String> = Set();
      let s2 = Set([1, 2, 2]);
      let m1: Map<String, Int> = Map();
    `).diagnostics
        ).toEqual([]);

        // Rejections
        expect(check("let d = Deque();").diagnostics[0].message).toMatch(/Cannot infer element type/);
        expect(check("let h = Heap();").diagnostics[0].message).toMatch(/Cannot infer element type/);
        expect(check("let m = Map();").diagnostics[0].message).toMatch(/Cannot infer types/);
        expect(check("let h: Heap<Complex> = Heap();").diagnostics[0].message).toMatch(/must be orderable/);
        expect(check("let h = Heap([1i, 2i]);").diagnostics[0].message).toMatch(/must be orderable/);
        expect(check("let h = Heap([1, 2]); let x = h[0];").diagnostics[0].message).toMatch(/Cannot index/);
        expect(check("let d = Deque(42);").diagnostics[0].message).toMatch(/not iterable/);
    });
});

describe("TypeChecker - Exhaustive Edge Cases", () => {
    it("enforces numeric promotion, BigInt precision guards, bitwise ops, factorial, and string ops", () => {
        expect(check(`
        let bi: BigInt = 10.toBigInt;
        let bigPlusFloat: Double = bi + 1.5;   // BigInt + Float -> Double (no precision loss)
        let bigPlusInt: BigInt = bi + 5;
        let intDiv: Double = 5 / 2;
        let bitRes: Int = (~1 & 3 | 4 ^ 8) << 1 >> 1;
        let fact: Int = 5!;
        let factBig: BigInt = bi!;
        let approx: Boolean = (3.14 ~= 3.141) && (<1, 2> ~= <1.0, 2.0>);
        let matPow: Matrix<Int> = <1, 2; 3, 4> ** 2;
        let matDiv: Matrix<Double> = <1, 2; 3, 4> / 2;
        let rowMul: Vector<Int> = <1, 2> * <1, 2; 3, 4>;
        let setDiff: Set<Int> = {1, 2, 3} \\ {2};
        let strOps: Boolean = ("a" + "b" < "c") && ("a" in "abc") && ("hi".length == 2);
        let parts: List<String> = "a,b".trim.upper.split(",");
        let ch: String = "hello"[0];
        let sub: String = "hello"[1:4];
      `).diagnostics
        ).toEqual([]);

        expect(check("let b: BigInt = 1.toBigInt; let f: Float = b;").diagnostics[0].message).toMatch(/Cannot assign/);
        expect(check("let x = 1i < 2i;").diagnostics[0].message).toMatch(/cannot be applied/);
        expect(check("let x = 1.5 & 2;").diagnostics[0].message).toMatch(/cannot be applied/);
        expect(check("let x = 3.5!;").diagnostics[0].message).toMatch(/cannot be applied/);
        expect(check("let x = ~1.5;").diagnostics[0].message).toMatch(/cannot be applied/);
        expect(check("let x = <1, 2; 3, 4> ** 0.5;").diagnostics[0].message).toMatch(/cannot be applied/);
        expect(check("let x = {1, 2} union {1.5};").diagnostics[0].message).toMatch(/cannot be applied/);
    });

    it("checks first-class functions, nested block functions, shadowing, and scoping", () => {
        expect(check(`
        func add(a: Int, b: Int): Int => a + b;
        func apply(f: (Int, Int) -> Int, x: Int, y: Int): Int => f(x, y);
        let fnVar: (Int, Int) -> Int = add;
        let r1: Int = apply(fnVar, 2, 3);

        // Nested function inside a block & variable shadowing
        let x = 1;
        let r2: Int = {
          let x = "shadowed";
          func helper(n: Int): Int => n + x.length;
          helper(10)
        };
        let stillInt: Int = x + 1;
      `).diagnostics
        ).toEqual([]);

        expect(check("let x = 1; x();").diagnostics[0].message).toMatch(/Cannot call value of non-function type/);
        expect(check("let a = 1; let a = 2;").diagnostics[0].message).toMatch(/already declared/);
        expect(check("func f(a: Int, a: Int): Int => a;").diagnostics[0].message).toMatch(/Duplicate parameter/);
        expect(check("for x in [1, 2] { } let y = x;").diagnostics[0].message).toMatch(/Undefined identifier/);
        expect(check("func f() { class Local {} }").diagnostics[0].message).toMatch(/only allowed at the top level/);
    });

    it("checks multi-level inheritance, untyped class fields, optional edge cases, and divergence", () => {
        expect(check(`
        class A { let base = 10; }
        class B inherits A { let mid = "ok"; }
        class C inherits B {
          func read(): Int {
            this.base = 20;
            return this.base + this.mid.length;
          }
        }
        let c = C();
        let asA: A = c;
        let listOfA: List<A> = [c, B(), A()];

        // Optional contextual literals & branching
        let ov: Vector<Int>? = <>;
        let ol: List<Int>? = [];
        let branchOpt: Int? = if true { 1 } else { None };
        let isNull: Boolean = branchOpt == None && branchOpt.isNone;
        let unwrapped: Int = branchOpt.unwrap();

        // Divergence (Never) in if/match inside typed function
        func guarded(x: Int): Int {
          let v: Int = if x < 0 { return -1; } else { x };
          match v {
            0 => { return 0; },
            _ => v * 2,
          }
        }

        // Multiple break types merging into Float?
        let loopVal: Float? = while true {
          if true { break 1; } else { break 2.5; }
        };
      `).diagnostics
        ).toEqual([]);

        expect(check("let x: Ghost = 1;").diagnostics[0].message).toMatch(/Unknown type 'Ghost'/);
        expect(check("class A { let x = None; }").diagnostics[0].message).toMatch(/Cannot infer type of field/);
    });

    it("populates exprTypes side-table with contextual resolved types", () => {
        const program = new Parser(tokenize("let m: Map<String, Int> = {};")).parseProgram();
        const checker = new TypeChecker();
        checker.checkProgram(program.stmts);

        const decl = program.stmts[0];
        expect(decl.kind).toBe("VarDecl");
        if (decl.kind === "VarDecl") {
            expect(checker.exprTypes.get(decl.initializer)).toEqual({
                kind: "Map",
                key: { kind: "Primitive", name: "String" },
                value: { kind: "Primitive", name: "Int" },
            });
        }
    });
});