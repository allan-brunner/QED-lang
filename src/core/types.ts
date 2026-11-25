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
    | { readonly kind: "Vector"; readonly element: Type }
    | { readonly kind: "Matrix"; readonly element: Type }
    | { readonly kind: "Function"; readonly params: readonly Type[]; readonly returnType: Type }
    | { readonly kind: "Class"; readonly name: string };

const NUMERIC_RANK: Partial<Record<PrimitiveName, number>> = {
    Int: 0,
    BigInt: 1,
    Float: 2,
    Double: 3,
    Complex: 4,
};

export function isNumeric(t: Type): boolean {
    return t.kind === "Primitive" && NUMERIC_RANK[t.name] !== undefined;
}

export function isInteger(t: Type): boolean {
    return t.kind === "Primitive" && (t.name === "Int" || t.name === "BigInt");
}

export function isOrderedNumeric(t: Type): boolean {
    return isNumeric(t) && !(t.kind === "Primitive" && t.name === "Complex");
}

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
        case "Vector": return `Vector<${typeToString(t.element)}>`;
        case "Matrix": return `Matrix<${typeToString(t.element)}>`;
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
        case "Matrix": return typeEquals(a.element, (b as typeof a).element);
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

/**
 * Returns the widened numeric type for any two numeric operands,
 * or `undefined` if either operand is non-numeric.
 */
export function promoteNumeric(a: Type, b: Type): Type | undefined {
    if (a.kind !== "Primitive" || b.kind !== "Primitive") return undefined;
    const rankA = NUMERIC_RANK[a.name];
    const rankB = NUMERIC_RANK[b.name];
    if (rankA === undefined || rankB === undefined) return undefined;

    // Preserve precision when mixing BigInt with 32-bit Float
    if (
        (a.name === "BigInt" && b.name === "Float") ||
        (a.name === "Float" && b.name === "BigInt")
    ) {
        return Types.Double;
    }

    return rankA >= rankB ? a : b;
}

export function promoteInteger(a: Type, b: Type): Type | undefined {
    if (!isInteger(a) || !isInteger(b)) return undefined;
    return promoteNumeric(a, b);
}

export function isAssignable(source: Type, target: Type): boolean {
    if (source.kind === "Primitive" && source.name === "Never") return true;
    if (typeEquals(source, target)) return true;

    // T -> T? and None -> T?
    if (target.kind === "Optional") {
        if (source.kind === "Primitive" && source.name === "None") return true;
        return isAssignable(source, target.inner);
    }

    // Scalar numeric widening
    if (source.kind === "Primitive" && target.kind === "Primitive") {
        const rankS = NUMERIC_RANK[source.name];
        const rankT = NUMERIC_RANK[target.name];
        if (rankS !== undefined && rankT !== undefined && rankS <= rankT) {
            return !(source.name === "BigInt" && target.name === "Float");
        }
    }

    // Element-wise widening for Vectors & Matrices
    if (source.kind === "Vector" && target.kind === "Vector") {
        return isAssignable(source.element, target.element);
    }
    if (source.kind === "Matrix" && target.kind === "Matrix") {
        return isAssignable(source.element, target.element);
    }

    return false;
}