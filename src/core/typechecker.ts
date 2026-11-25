import { Expr, Stmt, TypeNode } from "./ast.js";
import { Token, TokenType } from "./token.js";
import { Scope } from "./scope.js";
import { Type, Types, commonType, isAssignable, isInteger, isNumeric, isOrderedNumeric, optionalOf, promoteInteger, promoteNumeric, typeEquals, typeToString, unwrapOptional } from "./types.js";

export class TypeError extends Error {
    constructor(message: string, public readonly token?: Token) {
        const loc = token ? ` at ${token.line}:${token.column}` : "";
        super(`Type error${loc}: ${message}`);
    }
}

export class TypeChecker {
    private scope = new Scope();

    public readonly exprTypes = new Map<Expr, Type>();

    public checkProgram(stmts: readonly Stmt[]): void {
        for (const stmt of stmts) {
            this.checkStmt(stmt);
        }
    }

    private checkStmt(stmt: Stmt): void {
        switch (stmt.kind) {
            case "VarDecl": {
                const expected = stmt.typeAnnotation
                    ? this.resolveTypeNode(stmt.typeAnnotation)
                    : undefined;

                const initType = this.checkExpr(stmt.initializer, expected);

                if (expected && !isAssignable(initType, expected)) {
                    throw new TypeError(
                        `Cannot assign '${typeToString(initType)}' to '${stmt.name.lexeme}' of type '${typeToString(expected)}'.`,
                        stmt.name
                    );
                }

                if (!expected && initType.kind === "Primitive" && initType.name === "None") {
                    throw new TypeError(
                        `Cannot infer type of '${stmt.name.lexeme}' from 'None'; add an explicit type annotation.`,
                        stmt.name
                    );
                }

                const varType = expected ?? initType;
                if (!this.scope.define(stmt.name.lexeme, { type: varType, isConst: stmt.isConst })) {
                    throw new TypeError(`Variable '${stmt.name.lexeme}' is already declared in this scope.`, stmt.name);
                }
                return;
            }

            case "ExprStmt":
                this.checkExpr(stmt.expr);
                return;

            default:
                throw new TypeError(`Type checking for statement '${stmt.kind}' is not implemented yet.`);
        }
    }

    public checkExpr(expr: Expr, expected?: Type): Type {
        const resolved = this.inferExpr(expr, expected);
        this.exprTypes.set(expr, resolved);
        return resolved;
    }

    private checkBinary(op: Token, left: Type, right: Type): Type {
        const fail = (): never => {
            throw new TypeError(
                `Operator '${op.lexeme}' cannot be applied to '${typeToString(left)}' and '${typeToString(right)}'.`,
                op
            );
        };

        switch (op.type) {
            // Additive: numbers, vectors, matrices, string concat
            case TokenType.PLUS:
            case TokenType.MINUS: {
                const num = promoteNumeric(left, right);
                if (num) return num;

                if (left.kind === "Vector" && right.kind === "Vector") {
                    return { kind: "Vector", element: promoteNumeric(left.element, right.element)! };
                }
                if (left.kind === "Matrix" && right.kind === "Matrix") {
                    return { kind: "Matrix", element: promoteNumeric(left.element, right.element)! };
                }
                if (
                    op.type === TokenType.PLUS &&
                    left.kind === "Primitive" && left.name === "String" &&
                    right.kind === "Primitive" && right.name === "String"
                ) {
                    return Types.String;
                }
                return fail();
            }

            // Multiplicative: numbers, scalar*vec/mat, mat*vec, mat*mat, dot product
            case TokenType.STAR: {
                const num = promoteNumeric(left, right);
                if (num) return num;

                if (isNumeric(left) && right.kind === "Vector") {
                    return { kind: "Vector", element: promoteNumeric(left, right.element)! };
                }
                if (left.kind === "Vector" && isNumeric(right)) {
                    return { kind: "Vector", element: promoteNumeric(left.element, right)! };
                }
                if (isNumeric(left) && right.kind === "Matrix") {
                    return { kind: "Matrix", element: promoteNumeric(left, right.element)! };
                }
                if (left.kind === "Matrix" && isNumeric(right)) {
                    return { kind: "Matrix", element: promoteNumeric(left.element, right)! };
                }
                if (left.kind === "Matrix" && right.kind === "Vector") {
                    return { kind: "Vector", element: promoteNumeric(left.element, right.element)! };
                }
                if (left.kind === "Vector" && right.kind === "Matrix") {
                    return { kind: "Vector", element: promoteNumeric(left.element, right.element)! };
                }
                if (left.kind === "Matrix" && right.kind === "Matrix") {
                    return { kind: "Matrix", element: promoteNumeric(left.element, right.element)! };
                }
                if (left.kind === "Vector" && right.kind === "Vector") {
                    return promoteNumeric(left.element, right.element)!;
                }
                return fail();
            }

            // True division
            case TokenType.SLASH: {
                const num = promoteNumeric(left, right);
                if (num) return isInteger(num) ? Types.Double : num;

                if (left.kind === "Vector" && isNumeric(right)) {
                    const elem = promoteNumeric(left.element, right)!;
                    return { kind: "Vector", element: isInteger(elem) ? Types.Double : elem };
                }
                if (left.kind === "Matrix" && isNumeric(right)) {
                    const elem = promoteNumeric(left.element, right)!;
                    return { kind: "Matrix", element: isInteger(elem) ? Types.Double : elem };
                }
                return fail();
            }

            // Power: numbers and Matrix ** Int
            case TokenType.STAR_STAR: {
                const num = promoteNumeric(left, right);
                if (num) return num;
                if (left.kind === "Matrix" && isInteger(right)) {
                    return left;
                }
                return fail();
            }

            // Integer-only arithmetic & bitwise
            case TokenType.DIV:
            case TokenType.PERCENT:
            case TokenType.AMP:
            case TokenType.PIPE:
            case TokenType.CARET:
            case TokenType.LESS_LESS:
            case TokenType.GREATER_GREATER:
                return promoteInteger(left, right) ?? fail();

            // Vector cross product
            case TokenType.CROSS: {
                if (left.kind === "Vector" && right.kind === "Vector") {
                    return { kind: "Vector", element: promoteNumeric(left.element, right.element)! };
                }
                return fail();
            }

            // Set algebra
            case TokenType.UNION:
            case TokenType.INTER:
            case TokenType.BACKSLASH:
                if (left.kind === "Set" && right.kind === "Set" && typeEquals(left.element, right.element)) {
                    return left;
                }
                return fail();

            // Ordering
            case TokenType.LESS:
            case TokenType.LESS_EQUAL:
            case TokenType.GREATER:
            case TokenType.GREATER_EQUAL:
                if (isOrderedNumeric(left) && isOrderedNumeric(right)) return Types.Boolean;
                if (
                    left.kind === "Primitive" && left.name === "String" &&
                    right.kind === "Primitive" && right.name === "String"
                ) {
                    return Types.Boolean;
                }
                return fail();

            // Approximate equality (~=)
            case TokenType.TILDE_EQUAL:
                if (
                    (isNumeric(left) && isNumeric(right)) ||
                    (left.kind === "Vector" && right.kind === "Vector") ||
                    (left.kind === "Matrix" && right.kind === "Matrix")
                ) {
                    return Types.Boolean;
                }
                return fail();

            // Exact equality
            case TokenType.EQUAL_EQUAL:
            case TokenType.BANG_EQUAL:
                if (
                    promoteNumeric(left, right) ||
                    (left.kind === "Vector" && right.kind === "Vector") ||
                    (left.kind === "Matrix" && right.kind === "Matrix") ||
                    isAssignable(left, right) ||
                    isAssignable(right, left)
                ) {
                    return Types.Boolean;
                }
                return fail();

            // Logical
            case TokenType.AMP_AMP:
            case TokenType.PIPE_PIPE:
                if (isAssignable(left, Types.Boolean) && isAssignable(right, Types.Boolean)) {
                    return Types.Boolean;
                }
                return fail();

            // Membership (`in`)
            case TokenType.IN:
                if ((right.kind === "List" || right.kind === "Set") && isAssignable(left, right.element)) {
                    return Types.Boolean;
                }
                if (right.kind === "Map" && isAssignable(left, right.key)) return Types.Boolean;
                if (
                    left.kind === "Primitive" && left.name === "String" &&
                    right.kind === "Primitive" && right.name === "String"
                ) {
                    return Types.Boolean;
                }
                return fail();

            default:
                return fail();
        }
    }

    private checkHomogeneousElements(
        elements: readonly Expr[],
        expectedElem: Type | undefined,
        kind: "List" | "Set",
        token: Token
    ): Type {
        // Contextual mode: validate each element directly against the expected element type
        if (expectedElem) {
            for (const el of elements) {
                const elType = this.checkExpr(el, expectedElem);
                if (!isAssignable(elType, expectedElem)) {
                    throw new TypeError(
                        `${kind} element of type '${typeToString(elType)}' is not assignable to '${typeToString(expectedElem)}'.`,
                        token
                    );
                }
            }
            return expectedElem;
        }

        // Inference mode: fold elements with commonType()
        let acc: Type | undefined;
        for (const el of elements) {
            const elType = this.checkExpr(el);
            if (!acc) {
                acc = elType;
            } else {
                const merged = commonType(acc, elType);
                if (!merged) {
                    throw new TypeError(
                        `Incompatible ${kind} element types: '${typeToString(acc)}' and '${typeToString(elType)}'.`,
                        token
                    );
                }
                acc = merged;
            }
        }
        return acc!;
    }

    private promoteNumericCells(cells: readonly Expr[], kind: "Vector" | "Matrix", token: Token): Type {
        let acc: Type | undefined;
        for (const cell of cells) {
            const cellType = this.checkExpr(cell);
            if (!isNumeric(cellType)) {
                throw new TypeError(
                    `${kind} elements must be numeric, got '${typeToString(cellType)}'.`,
                    token
                );
            }
            acc = acc ? promoteNumeric(acc, cellType)! : cellType;
        }
        return acc!;
    }

    private inferExpr(expr: Expr, expected?: Type): Type {
        switch (expr.kind) {
            case "IntLit": return Types.Int;
            case "FloatLit": return Types.Float;
            case "ComplexLit": return Types.Complex;
            case "StringLit": return Types.String;
            case "BooleanLit": return Types.Boolean;
            case "NoneLit": return Types.None;
            case "Grouping": return this.checkExpr(expr.expr, expected);

            case "VectorLit": {
                if (expr.elements.length === 0) {
                    if (expected?.kind === "Vector") return expected;
                    return { kind: "Vector", element: Types.Double };
                }
                const element = this.promoteNumericCells(expr.elements, "Vector", expr.token);
                return { kind: "Vector", element };
            }

            case "MatrixLit": {
                const element = this.promoteNumericCells(expr.cells, "Matrix", expr.token);
                return { kind: "Matrix", element };
            }

            case "ListLit": {
                const target = unwrapOptional(expected);
                const expectedElem = target?.kind === "List" ? target.element : undefined;

                if (expr.elements.length === 0) {
                    if (expectedElem) return { kind: "List", element: expectedElem };
                    throw new TypeError(
                        "Cannot infer element type of empty list '[]'; add a type annotation.",
                        expr.token
                    );
                }

                const element = this.checkHomogeneousElements(expr.elements, expectedElem, "List", expr.token);
                return { kind: "List", element };
            }

            case "ListDynamicLit": {
                const startType = this.checkExpr(expr.start);
                const endType = this.checkExpr(expr.end);
                const stepType = expr.step ? this.checkExpr(expr.step) : undefined;

                if (
                    !isOrderedNumeric(startType) ||
                    !isOrderedNumeric(endType) ||
                    (stepType && !isOrderedNumeric(stepType))
                ) {
                    throw new TypeError(
                        "Dynamic list bounds and step must be real numeric types (Int, BigInt, Float, Double)."
                    );
                }

                let element = promoteNumeric(startType, endType)!;
                if (stepType) {
                    element = promoteNumeric(element, stepType)!;
                }
                return { kind: "List", element };
            }

            case "SetLit": {
                const target = unwrapOptional(expected);
                const expectedElem = target?.kind === "Set" ? target.element : undefined;

                const element = this.checkHomogeneousElements(expr.elements, expectedElem, "Set", expr.token);
                return { kind: "Set", element };
            }

            case "MapLit": {
                const target = unwrapOptional(expected);
                const expectedKey = target?.kind === "Map" ? target.key : undefined;
                const expectedVal = target?.kind === "Map" ? target.value : undefined;

                let keyType: Type | undefined = expectedKey;
                let valType: Type | undefined = expectedVal;

                for (const entry of expr.entries) {
                    const k = this.checkExpr(entry.key, expectedKey);
                    const v = this.checkExpr(entry.value, expectedVal);

                    if (expectedKey) {
                        if (!isAssignable(k, expectedKey)) {
                            throw new TypeError(
                                `Map key of type '${typeToString(k)}' is not assignable to '${typeToString(expectedKey)}'.`,
                                expr.token
                            );
                        }
                    } else if (!keyType) {
                        keyType = k;
                    } else {
                        const mergedK = commonType(keyType, k);
                        if (!mergedK) {
                            throw new TypeError(
                                `Incompatible Map key types: '${typeToString(keyType)}' and '${typeToString(k)}'.`,
                                expr.token
                            );
                        }
                        keyType = mergedK;
                    }

                    if (expectedVal) {
                        if (!isAssignable(v, expectedVal)) {
                            throw new TypeError(
                                `Map value of type '${typeToString(v)}' is not assignable to '${typeToString(expectedVal)}'.`,
                                expr.token
                            );
                        }
                    } else if (!valType) {
                        valType = v;
                    } else {
                        const mergedV = commonType(valType, v);
                        if (!mergedV) {
                            throw new TypeError(
                                `Incompatible Map value types: '${typeToString(valType)}' and '${typeToString(v)}'.`,
                                expr.token
                            );
                        }
                        valType = mergedV;
                    }
                }

                return { kind: "Map", key: keyType!, value: valType! };
            }

            case "Identifier": {
                const entry = this.scope.lookup(expr.name);
                if (!entry) {
                    throw new TypeError(`Undefined identifier '${expr.name}'.`, expr.token);
                }
                return entry.type;
            }

            case "Assign": {
                if (expr.target.kind === "Identifier") {
                    const entry = this.scope.lookup(expr.target.name);
                    if (!entry) {
                        throw new TypeError(`Undefined variable '${expr.target.name}'.`, expr.target.token);
                    }
                    if (entry.isConst) {
                        throw new TypeError(`Cannot reassign constant '${expr.target.name}'.`, expr.token);
                    }
                    const valueType = this.checkExpr(expr.value, entry.type);
                    if (!isAssignable(valueType, entry.type)) {
                        throw new TypeError(
                            `Cannot assign '${typeToString(valueType)}' to '${typeToString(entry.type)}'.`,
                            expr.token
                        );
                    }
                    return valueType;
                }
                if (expr.target.kind === "Index") {
                    const objType = this.checkExpr(expr.target.object);
                    if (objType.kind === "Primitive" && objType.name === "String") {
                        throw new TypeError("Cannot mutate a String by index.", expr.token);
                    }
                    const slotType = this.checkExpr(expr.target);
                    const valueType = this.checkExpr(expr.value, slotType);
                    if (!isAssignable(valueType, slotType)) {
                        throw new TypeError(
                            `Cannot assign '${typeToString(valueType)}' to '${typeToString(slotType)}'.`,
                            expr.token
                        );
                    }
                    return valueType;
                }
                // TODO: Handle MemberAccess and Index assignment targets
                throw new TypeError(`Assignment to '${expr.target.kind}' is not implemented yet.`, expr.token);
            }

            case "Binary": {
                const left = this.checkExpr(expr.left);
                const right = this.checkExpr(expr.right);
                return this.checkBinary(expr.operator, left, right);
            }

            case "Unary": {
                const operand = this.checkExpr(expr.operand);
                switch (expr.operator.type) {
                    case TokenType.PLUS:
                    case TokenType.MINUS:
                        if (isNumeric(operand) || operand.kind === "Vector" || operand.kind === "Matrix") {
                            return operand;
                        }
                        break;
                    case TokenType.BANG:
                        if (isAssignable(operand, Types.Boolean)) return Types.Boolean;
                        break;
                    case TokenType.TILDE:
                        if (isInteger(operand)) return operand;
                        break;
                }
                throw new TypeError(
                    `Unary operator '${expr.operator.lexeme}' cannot be applied to '${typeToString(operand)}'.`,
                    expr.operator
                );
            }

            case "PostfixUnary": {
                const operand = this.checkExpr(expr.operand);
                if (expr.operator.type === TokenType.BANG && isInteger(operand)) {
                    return operand;
                }
                throw new TypeError(
                    `Postfix operator '${expr.operator.lexeme}' cannot be applied to '${typeToString(operand)}'.`,
                    expr.operator
                );
            }

            case "Index": {
                const objType = this.checkExpr(expr.object);
                const idxTypes = expr.indexes.map((i) => this.checkExpr(i));

                if (objType.kind === "List") {
                    if (idxTypes.length !== 1 || !isInteger(idxTypes[0])) {
                        throw new TypeError("List indexing requires a single integer index.", expr.token);
                    }
                    return objType.element;
                }

                if (objType.kind === "Map") {
                    if (idxTypes.length !== 1 || !isAssignable(idxTypes[0], objType.key)) {
                        throw new TypeError(
                            `Map key must be assignable to '${typeToString(objType.key)}'.`,
                            expr.token
                        );
                    }
                    return objType.value;
                }

                if (objType.kind === "Primitive" && objType.name === "String") {
                    if (idxTypes.length !== 1 || !isInteger(idxTypes[0])) {
                        throw new TypeError("String indexing requires a single integer index.", expr.token);
                    }
                    return Types.String;
                }

                if (objType.kind === "Vector") {
                    if (idxTypes.length !== 1 || !isInteger(idxTypes[0])) {
                        throw new TypeError("Vector indexing requires a single integer index.", expr.token);
                    }
                    return objType.element;
                }

                if (objType.kind === "Matrix") {
                    if (idxTypes.length === 1 && isInteger(idxTypes[0])) {
                        return { kind: "Vector", element: objType.element };
                    }
                    if (idxTypes.length === 2 && isInteger(idxTypes[0]) && isInteger(idxTypes[1])) {
                        return objType.element;
                    }
                    throw new TypeError("Matrix indexing requires 1 or 2 integer indexes.", expr.token);
                }

                throw new TypeError(`Cannot index into type '${typeToString(objType)}'.`, expr.token);
            }

            case "Slicing": {
                const objType = this.checkExpr(expr.object);
                if (expr.start && !isInteger(this.checkExpr(expr.start))) {
                    throw new TypeError("Slice start index must be an integer.", expr.token);
                }
                if (expr.end && !isInteger(this.checkExpr(expr.end))) {
                    throw new TypeError("Slice end index must be an integer.", expr.token);
                }

                if (
                    objType.kind === "List" ||
                    objType.kind === "Vector" ||
                    (objType.kind === "Primitive" && objType.name === "String")
                ) {
                    return objType;
                }

                throw new TypeError(`Cannot slice type '${typeToString(objType)}'.`, expr.token);
            }

            case "Block": {
                const target = unwrapOptional(expected);

                if (expr.statements.length === 0 && !expr.returnExpr && !expr.unreachable) {
                    if (target?.kind === "Map" || target?.kind === "Set") {
                        return target;
                    }
                    return Types.Void;
                }

                if (expr.unreachable && expr.unreachable.length > 0) {
                    throw new TypeError("Unreachable code detected in block.", expr.token);
                }

                const prevScope = this.scope;
                this.scope = new Scope(prevScope);
                try {
                    for (const stmt of expr.statements) {
                        this.checkStmt(stmt);
                    }
                    return expr.returnExpr ? this.checkExpr(expr.returnExpr, expected) : Types.Void;
                } finally {
                    this.scope = prevScope;
                }
            }

            case "If": {
                const condType = this.checkExpr(expr.condition, Types.Boolean);
                if (!isAssignable(condType, Types.Boolean)) {
                    throw new TypeError(`Condition of 'if' must be Boolean, got '${typeToString(condType)}'.`);
                }

                const successType = this.checkExpr(expr.success, expected);
                if (!expr.fail) return Types.Void;

                const failType = this.checkExpr(expr.fail, expected ?? successType);
                if (isAssignable(failType, successType)) return successType;
                if (isAssignable(successType, failType)) return failType;

                throw new TypeError(
                    `Incompatible 'if' branch types: '${typeToString(successType)}' vs '${typeToString(failType)}'.`
                );
            }

            default:
                throw new TypeError(`Type checking for expression '${expr.kind}' is not implemented yet.`);
        }
    }

    private resolveTypeNode(node: TypeNode): Type {
        let base: Type;

        if (node.kind === "FuncType") {
            base = {
                kind: "Function",
                params: node.params.map((p) => this.resolveTypeNode(p)),
                returnType: this.resolveTypeNode(node.returnType),
            };
        } else {
            const params = node.typeParams ?? [];
            switch (node.name.type) {
                case TokenType.TYPE_INT: base = Types.Int; break;
                case TokenType.TYPE_BIGINT: base = Types.BigInt; break;
                case TokenType.TYPE_FLOAT: base = Types.Float; break;
                case TokenType.TYPE_DOUBLE: base = Types.Double; break;
                case TokenType.TYPE_COMPLEX: base = Types.Complex; break;
                case TokenType.TYPE_BOOLEAN: base = Types.Boolean; break;
                case TokenType.TYPE_STRING: base = Types.String; break;
                case TokenType.NONE: base = Types.None; break;
                case TokenType.TYPE_VECTOR:
                case TokenType.TYPE_MATRIX: {
                    const kind = node.name.type === TokenType.TYPE_VECTOR ? "Vector" : "Matrix";
                    if (params.length === 0) {
                        base = { kind, element: Types.Double };
                    } else if (params.length === 1) {
                        const elem = this.resolveTypeNode(params[0]);
                        if (!isNumeric(elem)) {
                            throw new TypeError(
                                `${kind} element type must be numeric, got '${typeToString(elem)}'.`,
                                node.name
                            );
                        }
                        base = { kind, element: elem };
                    } else {
                        throw new TypeError(`${kind} takes at most 1 type parameter.`, node.name);
                    }
                    break;
                }

                case TokenType.TYPE_LIST:
                    if (params.length !== 1) throw new TypeError("List requires 1 type parameter.", node.name);
                    base = { kind: "List", element: this.resolveTypeNode(params[0]) };
                    break;

                case TokenType.TYPE_SET:
                    if (params.length !== 1) throw new TypeError("Set requires 1 type parameter.", node.name);
                    base = { kind: "Set", element: this.resolveTypeNode(params[0]) };
                    break;

                case TokenType.TYPE_MAP:
                    if (params.length !== 2) throw new TypeError("Map requires 2 type parameters.", node.name);
                    base = {
                        kind: "Map",
                        key: this.resolveTypeNode(params[0]),
                        value: this.resolveTypeNode(params[1]),
                    };
                    break;

                case TokenType.IDENT:
                    // TODO: Verify class exists in a class registry
                    base = { kind: "Class", name: node.name.lexeme };
                    break;

                default:
                    throw new TypeError(`Unknown type '${node.name.lexeme}'.`, node.name);
            }
        }

        return node.optional ? optionalOf(base) : base;
    }
}