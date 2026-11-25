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

    it("checks while, for, break/continue, and match expressions", () => {
        expect(() =>
            check(`
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
    `)
        ).not.toThrow();

        // Rejections
        expect(() => check("while 1 { }")).toThrow(/must be Boolean/);
        expect(() => check("for x in 42 { }")).toThrow(/not iterable/);
        expect(() => check("for x in [1, 2] { x = 3; }")).toThrow(/Cannot reassign constant/);
        expect(() => check("break;")).toThrow(/inside a loop/);
        expect(() => check("continue;")).toThrow(/inside a loop/);
        expect(() => check("return 1;")).toThrow(/inside a function/);
        expect(() => check("for x in [1, 2] { if x == 1 { break; } else { break x; } }")).toThrow(/Cannot mix/);
        expect(() => check('let x = match 1 { "a" => 1, _ => 2 };')).toThrow(/cannot match/);
        expect(() => check("let x = match 1 { 0 => 1, 1 => 2 };")).toThrow(/Non-exhaustive/);
        expect(() => check('let x = match 1 { 0 => 1, _ => "two" };')).toThrow(/Incompatible 'match' arm types/);
        expect(() => check("let x = _;")).toThrow(/Wildcard '_'/);
    });

    it("supports two-pass hoisting, recursion, functions, classes, inheritance, and this", () => {
        expect(() =>
            check(`
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
    `)
        ).not.toThrow();

        // Rejections
        expect(() => check("class A inherits B {} class B inherits A {}")).toThrow(/Circular inheritance/);
        expect(() => check("class A inherits Missing {}")).toThrow(/not defined/);
        expect(() => check("let x = this;")).toThrow(/inside a class method/);
        expect(() => check("func bad(x: Int): Int { if x > 0 { return 1; } }")).toThrow(/body evaluates to 'Void'/);
        expect(() => check("func f(x: Int): Int => x; let a = f(1, 2);")).toThrow(/Expected 1 argument/);
        expect(() => check("class C { const k: Int = 1; } let c = C(); c.k = 2;")).toThrow(/constant field/);
        expect(() => check("let x = f(1); func f(a: Int) => a;")).toThrow(/explicit return type/);
    });

    function checkWithModules(code: string, modules: Record<string, string>): TypeChecker {
        const loader = (path: string) => {
            const src = modules[path];
            return src !== undefined ? new Parser(tokenize(src)).parseProgram() : undefined;
        };
        const program = new Parser(tokenize(code)).parseProgram();
        const checker = new TypeChecker({ moduleLoader: loader });
        checker.checkProgram(program);
        return checker;
    }

    it("supports built-in module imports, user file imports, and built-in properties/methods", () => {
        expect(() =>
            check(`
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
    `)
        ).not.toThrow();

        // User module import + inheritance across files
        expect(() =>
            checkWithModules(
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
            )
        ).not.toThrow();

        // Rejections
        expect(() => check('import "nonexistent";')).toThrow(/Unknown module/);
        expect(() =>
            checkWithModules('import "a";', { a: 'import "b";', b: 'import "a";' })
        ).toThrow(/Circular import/);
        expect(() => check('func f() { import "math"; }')).toThrow(/only allowed at the top level/);
        expect(() => check("let x = (3 + 4i).toInt;")).toThrow(/has no property or method 'toInt'/);
        expect(() => check('let xs = [1, 2]; xs.push("bad");')).toThrow(/cannot assign 'String' to 'Int'/);
    });

    it("checks Deque, Heap, and collection constructors", () => {
        expect(() =>
            check(`
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
    `)
        ).not.toThrow();

        // Rejections
        expect(() => check("let d = Deque();")).toThrow(/Cannot infer element type/);
        expect(() => check("let h = Heap();")).toThrow(/Cannot infer element type/);
        expect(() => check("let m = Map();")).toThrow(/Cannot infer types/);
        expect(() => check("let h: Heap<Complex> = Heap();")).toThrow(/must be orderable/);
        expect(() => check("let h = Heap([1i, 2i]);")).toThrow(/must be orderable/);
        expect(() => check("let h = Heap([1, 2]); let x = h[0];")).toThrow(/Cannot index/);
        expect(() => check("let d = Deque(42);")).toThrow(/not iterable/);
    });
});