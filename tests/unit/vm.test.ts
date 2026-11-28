import { describe, it, expect } from "vitest";
import { analyze } from "../../src/core/analyzer.js";
import { Compiler } from "../../src/compiler/compiler.js";
import { disassembleChunk } from "../../src/vm/disassembler.js";
import { RuntimeError, VM } from "../../src/vm/vm.js";

function runQED(code: string) {
  const analysis = analyze(code);
  expect(analysis.diagnostics).toEqual([]);
  const proto = new Compiler().compileProgram(analysis.ast);
  const output: string[] = [];
  const vm = new VM({ stdout: (line) => output.push(line) });
  vm.run(proto);
  return { vm, output, proto };
}

describe("VM & Compiler", () => {
  it("evaluates arithmetic, implicit multiplication, division, factorial, and complex math", () => {
    const { vm } = runQED(`
      let a = 2 + 3 * 4;
      let b = 2(3 + 4);
      let c = 5 / 2;
      let d = 5 div 2;
      let e = 5!;
      let z = (3 + 4i) * (1 - 2i);
      let mag = (3 + 4i).abs;
      let big: BigInt = 20;
      let bigFact = big!;
    `);

    expect(vm.getGlobal("a")).toEqual({ kind: "Int", value: 14 });
    expect(vm.getGlobal("b")).toEqual({ kind: "Int", value: 14 });
    expect(vm.getGlobal("c")).toEqual({ kind: "Double", value: 2.5 });
    expect(vm.getGlobal("d")).toEqual({ kind: "Int", value: 2 });
    expect(vm.getGlobal("e")).toEqual({ kind: "Int", value: 120 });
    expect(vm.getGlobal("z")).toEqual({ kind: "Complex", re: 11, im: -2 });
    expect(vm.getGlobal("mag")).toEqual({ kind: "Double", value: 5 });
    expect(vm.getGlobal("bigFact")).toEqual({ kind: "BigInt", value: 2432902008176640000n });
  });

  it("handles short-circuit && and || without evaluating the skipped branch", () => {
    // If right-hand side executed, (1 / 0) would throw Division by zero
    const { vm, proto } = runQED(`
      let a = false && (1 / 0 == 0);
      let b = true || (1 / 0 == 0);
      let c = true && (2 + 2 == 4);
      let d = false || (3 ~= 3.0000000001);
    `);

    console.log(disassembleChunk(proto.chunk, proto.name));

    expect(vm.getGlobal("a")).toEqual({ kind: "Boolean", value: false });
    expect(vm.getGlobal("b")).toEqual({ kind: "Boolean", value: true });
    expect(vm.getGlobal("c")).toEqual({ kind: "Boolean", value: true });
    expect(vm.getGlobal("d")).toEqual({ kind: "Boolean", value: true });
  });

  it("supports io.println, string properties, reassignment, and disassembly", () => {
    const { output, proto } = runQED(`
      import "io";
      let x = 10;
      x = x + 32;
      println("answer = " + x.toString);
      println("  hello  ".trim.upper);
    `);

    expect(output).toEqual(["answer = 42", "HELLO"]);

    const asm = disassembleChunk(proto.chunk, proto.name);
    expect(asm).toContain("IMPORT_BUILTIN");
    expect(asm).toContain("DEFINE_GLOBAL");
    expect(asm).toContain("CALL");
  });

  it("reports runtime errors with exact source line and column diagnostics", () => {
    const analysis = analyze("let x = 1;\nlet y = 10 / 0;");
    expect(analysis.diagnostics).toEqual([]);
    const proto = new Compiler().compileProgram(analysis.ast);
    const vm = new VM();

    try {
      vm.run(proto);
      expect.unreachable("Expected RuntimeError");
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      const diag = (err as RuntimeError).toDiagnostic("main.qed");
      expect(diag).toMatchObject({
        phase: "runtime",
        severity: "error",
        file: "main.qed",
        line: 2,
        column: 12,
      });
    }
  });
});
