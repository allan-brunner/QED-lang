import { tokenize } from "./lexer.js";
import { Parser } from "./parser.js";
import { TypeChecker, ModuleLoader } from "./typechecker.js";
import { Diagnostic, QEDError } from "./diagnostics.js";
import { Token } from "./token.js";
import { Expr, Stmt } from "./ast.js";
import { Type } from "./types.js";

export interface AnalyzeOptions {
    readonly file?: string;
    readonly moduleLoader?: ModuleLoader;
}

export interface AnalysisResult {
    readonly ok: boolean;
    readonly tokens: readonly Token[];
    readonly ast: readonly Stmt[];
    readonly exprTypes: ReadonlyMap<Expr, Type>;
    readonly diagnostics: readonly Diagnostic[];
}

export function analyze(source: string, options: AnalyzeOptions = {}): AnalysisResult {
    const diagnostics: Diagnostic[] = [];
    let tokens: Token[] = [];

    try {
        tokens = tokenize(source);
    } catch (err) {
        if (err instanceof QEDError) {
            diagnostics.push(err.toDiagnostic(options.file));
            return { ok: false, tokens, ast: [], exprTypes: new Map(), diagnostics };
        }
        throw err;
    }

    const parsed = new Parser(tokens).parseProgram();
    for (const d of parsed.diagnostics) {
        diagnostics.push(options.file ? { ...d, file: options.file } : d);
    }

    const checker = new TypeChecker({ moduleLoader: options.moduleLoader });
    const typeDiags = checker.checkProgram(parsed.stmts);
    for (const d of typeDiags) {
        diagnostics.push(options.file ? { ...d, file: options.file } : d);
    }

    return {
        ok: diagnostics.length === 0,
        tokens,
        ast: parsed.stmts,
        exprTypes: checker.exprTypes,
        diagnostics,
    };
}