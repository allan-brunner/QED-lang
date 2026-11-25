import { SymbolEntry } from "./scope.js";
import { Type, Types, isNumeric, optionalOf } from "./types.js";

const fn = (params: readonly Type[], returnType: Type): Type => ({
    kind: "Function",
    params,
    returnType,
    hasParens: true,
});

const constSym = (type: Type): SymbolEntry => ({ type, isConst: true });

function defineModule(
    entries: Record<string, SymbolEntry>
): ReadonlyMap<string, SymbolEntry> {
    return new Map<string, SymbolEntry>(Object.entries(entries));
}

export const BUILTIN_MODULES: ReadonlyMap<string, ReadonlyMap<string, SymbolEntry>> =
    new Map<string, ReadonlyMap<string, SymbolEntry>>([
        [
            "math",
            defineModule({
                π: constSym(Types.Double),
                pi: constSym(Types.Double),
                e: constSym(Types.Double),
                τ: constSym(Types.Double),
                tau: constSym(Types.Double),

                sin: constSym(fn([Types.Double], Types.Double)),
                cos: constSym(fn([Types.Double], Types.Double)),
                tan: constSym(fn([Types.Double], Types.Double)),
                asin: constSym(fn([Types.Double], Types.Double)),
                acos: constSym(fn([Types.Double], Types.Double)),
                atan: constSym(fn([Types.Double], Types.Double)),
                atan2: constSym(fn([Types.Double, Types.Double], Types.Double)),
                exp: constSym(fn([Types.Double], Types.Double)),
                ln: constSym(fn([Types.Double], Types.Double)),
                log10: constSym(fn([Types.Double], Types.Double)),

                floor: constSym(fn([Types.Double], Types.Int)),
                ceil: constSym(fn([Types.Double], Types.Int)),
                round: constSym(fn([Types.Double], Types.Int)),
                gcd: constSym(fn([Types.Int, Types.Int], Types.Int)),
                lcm: constSym(fn([Types.Int, Types.Int], Types.Int)),
                min: constSym(fn([Types.Double, Types.Double], Types.Double)),
                max: constSym(fn([Types.Double, Types.Double], Types.Double)),
            }),
        ],
        [
            "linalg",
            defineModule({
                identity: constSym(fn([Types.Int], { kind: "Matrix", element: Types.Double })),
                zeros: constSym(fn([Types.Int, Types.Int], { kind: "Matrix", element: Types.Double })),
                ones: constSym(fn([Types.Int, Types.Int], { kind: "Matrix", element: Types.Double })),
                zeroVec: constSym(fn([Types.Int], { kind: "Vector", element: Types.Double })),
            }),
        ],
        [
            "io",
            defineModule({
                print: constSym(fn([Types.String], Types.Void)),
                println: constSym(fn([Types.String], Types.Void)),
                input: constSym(fn([], Types.String)),
            }),
        ],
    ]);

export function lookupBuiltinMember(objType: Type, name: string): Type | undefined {
    // Optional<T>
    if (objType.kind === "Optional") {
        switch (name) {
            case "isNone":
            case "isSome":
                return Types.Boolean;
            case "unwrap":
                return fn([], objType.inner);
            case "unwrapOr":
                return fn([objType.inner], objType.inner);
        }
        return undefined;
    }

    // Numerics
    if (isNumeric(objType)) {
        const isComplex = objType.kind === "Primitive" && objType.name === "Complex";
        switch (name) {
            case "sqrt": return isComplex ? Types.Complex : Types.Double;
            case "abs": return isComplex ? Types.Double : objType;
            case "toInt": return isComplex ? undefined : Types.Int;
            case "toBigInt": return isComplex ? undefined : Types.BigInt;
            case "toFloat": return isComplex ? undefined : Types.Float;
            case "toDouble": return isComplex ? undefined : Types.Double;
            case "toComplex": return Types.Complex;
            case "toString": return Types.String;
        }
        if (isComplex) {
            switch (name) {
                case "re":
                case "im":
                case "arg":
                    return Types.Double;
                case "conj":
                    return Types.Complex;
            }
        }
        return undefined;
    }

    // Boolean
    if (objType.kind === "Primitive" && objType.name === "Boolean") {
        if (name === "toString") return Types.String;
        return undefined;
    }

    // String
    if (objType.kind === "Primitive" && objType.name === "String") {
        switch (name) {
            case "length": return Types.Int;
            case "isEmpty": return Types.Boolean;
            case "upper":
            case "lower":
            case "trim":
                return Types.String;
            case "contains":
            case "startsWith":
            case "endsWith":
                return fn([Types.String], Types.Boolean);
            case "split":
                return fn([Types.String], { kind: "List", element: Types.String });
        }
        return undefined;
    }

    // Vector<T>
    if (objType.kind === "Vector") {
        const isComplex = objType.element.kind === "Primitive" && objType.element.name === "Complex";
        switch (name) {
            case "length": return Types.Int;
            case "norm": return Types.Double;
            case "sum": return objType.element;
            case "unit":
                return { kind: "Vector", element: isComplex ? Types.Complex : Types.Double };
            case "dot": {
                const vecTarget: Type = { kind: "Vector", element: isComplex ? Types.Complex : Types.Double };
                return fn([vecTarget], isComplex ? Types.Complex : Types.Double);
            }
        }
        return undefined;
    }

    // Matrix<T>
    if (objType.kind === "Matrix") {
        const isComplex = objType.element.kind === "Primitive" && objType.element.name === "Complex";
        switch (name) {
            case "rows":
            case "cols":
                return Types.Int;
            case "T":
            case "transpose":
                return objType;
            case "trace":
            case "det":
                return objType.element;
            case "inv":
                return { kind: "Matrix", element: isComplex ? Types.Complex : Types.Double };
        }
        return undefined;
    }

    // List<T>
    if (objType.kind === "List") {
        switch (name) {
            case "length": return Types.Int;
            case "isEmpty": return Types.Boolean;
            case "first":
            case "last":
                return optionalOf(objType.element);
            case "push":
                return fn([objType.element], Types.Void);
            case "pop":
                return fn([], optionalOf(objType.element));
            case "contains":
                return fn([objType.element], Types.Boolean);
            case "reverse":
                return fn([], objType);
        }
        return undefined;
    }

    // Set<T>
    if (objType.kind === "Set") {
        switch (name) {
            case "length": return Types.Int;
            case "isEmpty": return Types.Boolean;
            case "add":
                return fn([objType.element], Types.Void);
            case "remove":
            case "contains":
                return fn([objType.element], Types.Boolean);
        }
        return undefined;
    }

    // Deque<T>
    if (objType.kind === "Deque") {
        switch (name) {
            case "length": return Types.Int;
            case "isEmpty": return Types.Boolean;
            case "front":
            case "back":
                return optionalOf(objType.element);
            case "pushFront":
            case "pushBack":
                return fn([objType.element], Types.Void);
            case "popFront":
            case "popBack":
                return fn([], optionalOf(objType.element));
            case "contains":
                return fn([objType.element], Types.Boolean);
        }
        return undefined;
    }

    // Heap<T>
    if (objType.kind === "Heap") {
        switch (name) {
            case "length": return Types.Int;
            case "isEmpty": return Types.Boolean;
            case "peek":
                return optionalOf(objType.element);
            case "push":
                return fn([objType.element], Types.Void);
            case "pop":
                return fn([], optionalOf(objType.element));
            case "toList":
                return fn([], { kind: "List", element: objType.element });
        }
        return undefined;
    }

    // Map<K, V>
    if (objType.kind === "Map") {
        switch (name) {
            case "length": return Types.Int;
            case "isEmpty": return Types.Boolean;
            case "keys":
                return { kind: "List", element: objType.key };
            case "values":
                return { kind: "List", element: objType.value };
            case "get":
            case "remove":
                return fn([objType.key], optionalOf(objType.value));
            case "set":
                return fn([objType.key, objType.value], Types.Void);
            case "has":
                return fn([objType.key], Types.Boolean);
        }
        return undefined;
    }

    return undefined;
}