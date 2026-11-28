import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { analyze } from "./core/analyzer.js";
import { QEDError } from "./core/diagnostics.js";
import { tokenize } from "./core/lexer.js";
import { Parser } from "./core/parser.js";
import { ModuleLoader, TypeChecker } from "./core/typechecker.js";
import { Compiler } from "./compiler/compiler.js";
import { disassembleChunk } from "./vm/disassembler.js";
import { RuntimeError, VM, valueToString } from "./vm/vm.js";

function createFsModuleLoader(baseDir: string): ModuleLoader {
  return (importPath: string) => {
    const candidates = [
      path.resolve(baseDir, importPath),
      path.resolve(baseDir, `${importPath}.qed`),
    ];
    const resolved = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!resolved) return undefined;
    const source = fs.readFileSync(resolved, "utf8");
    return new Parser(tokenize(source)).parseProgram();
  };
}

// Counts unclosed (), [], {} outside strings and // comments for multi-line REPL input
function nestingDepth(source: string): number {
  let depth = 0;
  let inString = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
    }
  }
  return depth;
}

function runFile(filePath: string, options: { showDisasm: boolean; checkOnly: boolean }): void {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(absPath, "utf8");
  const displayName = path.basename(absPath);

  const analysis = analyze(source, {
    file: displayName,
    moduleLoader: createFsModuleLoader(path.dirname(absPath)),
  });

  if (!analysis.ok) {
    for (const d of analysis.diagnostics) {
      const target = d.file ?? displayName;
      console.error(`[${d.phase}] ${target}:${d.line}:${d.column} — ${d.message}`);
    }
    process.exit(1);
  }

  if (options.checkOnly) {
    console.log(`${displayName}: OK (0 errors)`);
    return;
  }

  const proto = new Compiler().compileProgram(analysis.ast);

  if (options.showDisasm) {
    console.log(disassembleChunk(proto.chunk, displayName));
    console.log("---");
  }

  try {
    const vm = new VM({ stdout: (line) => console.log(line) });
    vm.run(proto);
  } catch (err) {
    if (err instanceof RuntimeError) {
      const d = err.toDiagnostic(displayName);
      console.error(`[runtime] ${displayName}:${d.line}:${d.column} — ${d.message}`);
      process.exit(1);
    }
    throw err;
  }
}

function startRepl(initialDisasm: boolean): void {
  let showDisasm = initialDisasm;
  let checker = new TypeChecker({ moduleLoader: createFsModuleLoader(process.cwd()) });
  let vm = new VM({ stdout: (line) => console.log(line) });
  let buffer = "";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "qed> ",
  });

  console.log("QED REPL — type '.help' for commands, '.exit' or Ctrl+D to quit.");
  rl.prompt();

  const evalChunk = (code: string, label: string, printResult: boolean): void => {
    let tokens;
    try {
      tokens = tokenize(code);
    } catch (err) {
      if (err instanceof QEDError) {
        const d = err.toDiagnostic(label);
        console.error(`[${d.phase}] ${label}:${d.line}:${d.column} — ${d.message}`);
        return;
      }
      throw err;
    }

    const parsed = new Parser(tokens).parseProgram();
    if (parsed.diagnostics.length > 0) {
      for (const d of parsed.diagnostics) {
        console.error(`[${d.phase}] ${label}:${d.line}:${d.column} — ${d.message}`);
      }
      return;
    }

    const typeDiags = checker.checkProgram(parsed.stmts);
    if (typeDiags.length > 0) {
      for (const d of typeDiags) {
        const file = d.file ?? label;
        console.error(`[${d.phase}] ${file}:${d.line}:${d.column} — ${d.message}`);
      }
      return;
    }

    const proto = new Compiler().compileProgram(parsed.stmts, printResult);

    if (showDisasm) {
      console.log(disassembleChunk(proto.chunk, label));
    }

    try {
      const value = vm.run(proto);
      if (printResult && value.kind !== "Void") {
        console.log(`=> ${valueToString(value)} : ${value.kind}`);
      }
    } catch (err) {
      if (err instanceof RuntimeError) {
        const d = err.toDiagnostic(label);
        console.error(`[runtime] ${label}:${d.line}:${d.column} — ${d.message}`);
      } else {
        console.error(`Internal error: ${(err as Error).message}`);
      }
    }
  };

  rl.on("line", (rawLine) => {
    const trimmed = rawLine.trim();

    // Handle dot-commands when not in the middle of a multi-line input
    if (buffer === "" && trimmed.startsWith(".")) {
      const [cmd, ...rest] = trimmed.split(/\s+/);
      switch (cmd) {
        case ".help":
          console.log("  .disasm        Toggle bytecode disassembly output");
          console.log("  .load <file>   Execute a .qed file into the current session");
          console.log("  .reset         Clear all variables and reset VM state");
          console.log("  .exit          Quit the REPL");
          break;
        case ".disasm":
          showDisasm = !showDisasm;
          console.log(`Disassembly ${showDisasm ? "ON" : "OFF"}.`);
          break;
        case ".reset":
          checker = new TypeChecker({ moduleLoader: createFsModuleLoader(process.cwd()) });
          vm = new VM({ stdout: (line) => console.log(line) });
          console.log("Session reset.");
          break;
        case ".load": {
          const target = rest.join(" ");
          if (!target) {
            console.error("Usage: .load <file.qed>");
          } else {
            const abs = path.resolve(target);
            if (!fs.existsSync(abs)) {
              console.error(`File not found: ${target}`);
            } else {
              evalChunk(fs.readFileSync(abs, "utf8"), path.basename(abs), false);
            }
          }
          break;
        }
        case ".exit":
        case ".quit":
          rl.close();
          return;
        default:
          console.error(`Unknown command '${cmd}'. Type '.help' for commands.`);
      }
      rl.prompt();
      return;
    }

    buffer = buffer === "" ? rawLine : `${buffer}\n${rawLine}`;

    if (buffer.trim() === "") {
      buffer = "";
      rl.prompt();
      return;
    }

    if (nestingDepth(buffer) > 0) {
      rl.setPrompt("...  ");
      rl.prompt();
      return;
    }

    const code = buffer;
    buffer = "";
    rl.setPrompt("qed> ");
    evalChunk(code, "<repl>", true);
    rl.prompt();
  });

  rl.on("close", () => {
    console.log();
    process.exit(0);
  });
}

function main(): void {
  const args = process.argv.slice(2);
  let showDisasm = false;
  let checkOnly = false;
  let filePath: string | undefined;

  for (const arg of args) {
    if (arg === "--disasm" || arg === "-d") {
      showDisasm = true;
    } else if (arg === "--check" || arg === "-c") {
      checkOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage:");
      console.log("  qed                          Start interactive REPL");
      console.log("  qed <file.qed> [--disasm]    Compile and execute a file");
      console.log("  qed <file.qed> --check       Type-check a file without running");
      return;
    } else if (!arg.startsWith("-")) {
      filePath = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  if (filePath) {
    runFile(filePath, { showDisasm, checkOnly });
  } else {
    startRepl(showDisasm);
  }
}

main();
