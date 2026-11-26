import { Type } from "./types.js";

export interface SymbolEntry {
    readonly type: Type;
    readonly isConst: boolean;
}

export class Scope {
    private readonly symbols = new Map<string, SymbolEntry>();
    private readonly pendingFuncs = new Set<string>();

    constructor(public readonly parent?: Scope) { }

    define(name: string, entry: SymbolEntry): boolean {
        if (this.symbols.has(name)) return false;
        this.symbols.set(name, entry);
        return true;
    }

    lookup(name: string): SymbolEntry | undefined {
        return this.symbols.get(name) ?? this.parent?.lookup(name);
    }

    hasOwn(name: string): boolean {
        return this.symbols.has(name);
    }

    addPendingFunc(name: string): void {
        this.pendingFuncs.add(name);
    }

    deletePendingFunc(name: string): void {
        this.pendingFuncs.delete(name);
    }

    hasOwnPendingFunc(name: string): boolean {
        return this.pendingFuncs.has(name);
    }

    hasPendingFunc(name: string): boolean {
        return this.pendingFuncs.has(name) || (this.parent?.hasPendingFunc(name) ?? false);
    }

    entries(): IterableIterator<[string, SymbolEntry]> {
        return this.symbols.entries();
    }
}