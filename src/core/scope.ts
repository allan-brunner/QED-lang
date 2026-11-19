import { Type } from "./types.js";

export interface SymbolEntry {
    readonly type: Type;
    readonly isConst: boolean;
}

export class Scope {
    private readonly symbols = new Map<string, SymbolEntry>();

    constructor(public readonly parent?: Scope) { }

    define(name: string, entry: SymbolEntry): boolean {
        if (this.symbols.has(name)) return false;
        this.symbols.set(name, entry);
        return true;
    }

    lookup(name: string): SymbolEntry | undefined {
        return this.symbols.get(name) ?? this.parent?.lookup(name);
    }
}