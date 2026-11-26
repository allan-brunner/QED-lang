import { Token } from "./token.js";

export type DiagnosticPhase = "lexer" | "parser" | "typechecker" | "runtime";
export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
    readonly phase: DiagnosticPhase;
    readonly severity: DiagnosticSeverity;
    readonly message: string;
    readonly line: number;
    readonly column: number;
    readonly length: number;
    readonly file?: string;
}

export class QEDError extends Error {
    public readonly phase: DiagnosticPhase;
    public readonly rawMessage: string;
    public readonly line: number;
    public readonly column: number;
    public readonly length: number;

    constructor(
        phase: DiagnosticPhase,
        message: string,
        line = 1,
        column = 1,
        length = 1,
        formattedMessage?: string
    ) {
        super(formattedMessage ?? `${phase} error at ${line}:${column}: ${message}`);
        this.phase = phase;
        this.rawMessage = message;
        this.line = line;
        this.column = column;
        this.length = Math.max(1, length);
    }

    public toDiagnostic(file?: string): Diagnostic {
        return {
            phase: this.phase,
            severity: "error",
            message: this.rawMessage,
            line: this.line,
            column: this.column,
            length: this.length,
            ...(file !== undefined ? { file } : {}),
        };
    }
}

export class LexerError extends QEDError {
    constructor(message: string, line: number, column: number, length = 1) {
        super("lexer", message, line, column, length, message);
    }
}

export class ParseError extends QEDError {
    constructor(message: string, token: Token, formatted?: string) {
        super(
            "parser",
            message,
            token.line,
            token.column,
            Math.max(1, token.lexeme.length),
            formatted ?? `Parse error at ${token.line}:${token.column} ('${token.lexeme}'): ${message}`
        );
    }
}

export class TypeCheckError extends QEDError {
    constructor(message: string, public readonly token?: Token) {
        const loc = token ? ` at ${token.line}:${token.column}` : "";
        super(
            "typechecker",
            message,
            token?.line ?? 1,
            token?.column ?? 1,
            Math.max(1, token?.lexeme.length ?? 1),
            `Type error${loc}: ${message}`
        );
    }
}