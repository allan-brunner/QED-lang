export type PrimitiveName =
    | "Int"
    | "BigInt"
    | "Float"
    | "Double"
    | "Complex"
    | "Boolean"
    | "String"
    | "None"
    | "Void"
    | "Never";

export type Type =
    | { readonly kind: "Primitive"; readonly name: PrimitiveName }
    | { readonly kind: "Optional"; readonly inner: Type }
    | { readonly kind: "List"; readonly element: Type }
    | { readonly kind: "Set"; readonly element: Type }
    | { readonly kind: "Map"; readonly key: Type; readonly value: Type }
    | { readonly kind: "Vector" }
    | { readonly kind: "Matrix" }
    | { readonly kind: "Function"; readonly params: readonly Type[]; readonly returnType: Type }
    | { readonly kind: "Class"; readonly name: string };

// Singleton helpers for common primitives
export const Types = {
    Int: { kind: "Primitive", name: "Int" },
    BigInt: { kind: "Primitive", name: "BigInt" },
    Float: { kind: "Primitive", name: "Float" },
    Double: { kind: "Primitive", name: "Double" },
    Complex: { kind: "Primitive", name: "Complex" },
    Boolean: { kind: "Primitive", name: "Boolean" },
    String: { kind: "Primitive", name: "String" },
    None: { kind: "Primitive", name: "None" },
    Void: { kind: "Primitive", name: "Void" },
    Never: { kind: "Primitive", name: "Never" },
} as const satisfies Record<PrimitiveName, Type>;

export const optionalOf = (inner: Type): Type =>
    inner.kind === "Optional" ? inner : { kind: "Optional", inner };

export function typeToString(t: Type): string {
    switch (t.kind) {
        case "Primitive": return t.name;
        case "Optional": return `${typeToString(t.inner)}?`;
        case "List": return `List<${typeToString(t.element)}>`;
        case "Set": return `Set<${typeToString(t.element)}>`;
        case "Map": return `Map<${typeToString(t.key)}, ${typeToString(t.value)}>`;
        case "Vector": return "Vector";
        case "Matrix": return "Matrix";
        case "Class": return t.name;
        case "Function":
            return `(${t.params.map(typeToString).join(", ")}) -> ${typeToString(t.returnType)}`;
    }
}

export function typeEquals(a: Type, b: Type): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case "Primitive": return a.name === (b as typeof a).name;
        case "Optional": return typeEquals(a.inner, (b as typeof a).inner);
        case "List":
        case "Set": return typeEquals(a.element, (b as typeof a).element);
        case "Map": {
            const bm = b as typeof a;
            return typeEquals(a.key, bm.key) && typeEquals(a.value, bm.value);
        }
        case "Vector":
        case "Matrix": return true;
        case "Class": return a.name === (b as typeof a).name;
        case "Function": {
            const bf = b as typeof a;
            return (
                a.params.length === bf.params.length &&
                a.params.every((p, i) => typeEquals(p, bf.params[i])) &&
                typeEquals(a.returnType, bf.returnType)
            );
        }
    }
}

export function isAssignable(source: Type, target: Type): boolean {
    if (source.kind === "Primitive" && source.name === "Never") return true;
    if (typeEquals(source, target)) return true;

    // T -> T? and None -> T?
    if (target.kind === "Optional") {
        if (source.kind === "Primitive" && source.name === "None") return true;
        return isAssignable(source, target.inner);
    }

    // TODO: Add numeric widening (e.g., Int -> Float -> Double -> Complex)
    // and class inheritance checks here later.
    return false;
}