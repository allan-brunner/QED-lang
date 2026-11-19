import { Expr, Stmt, TypeNode } from "./ast.js";
import { Token, TokenType } from "./token.js";
import { Scope } from "./scope.js";
import { Type, Types, isAssignable, optionalOf, typeToString } from "./types.js";

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

    private inferExpr(expr: Expr, expected?: Type): Type {
        switch (expr.kind) {
            case "IntLit": return Types.Int;
            case "FloatLit": return Types.Float;
            case "ComplexLit": return Types.Complex;
            case "StringLit": return Types.String;
            case "BooleanLit": return Types.Boolean;
            case "NoneLit": return Types.None;
            case "Grouping": return this.checkExpr(expr.expr, expected);

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
                // TODO: Handle MemberAccess and Index assignment targets
                throw new TypeError(`Assignment to '${expr.target.kind}' is not implemented yet.`, expr.token);
            }

            case "Binary": {
                const left = this.checkExpr(expr.left);
                const right = this.checkExpr(expr.right);

                switch (expr.operator.type) {
                    case TokenType.PLUS:
                        if (isAssignable(left, Types.Int) && isAssignable(right, Types.Int)) return Types.Int;
                        if (isAssignable(left, Types.Float) && isAssignable(right, Types.Float)) return Types.Float;
                        if (isAssignable(left, Types.String) && isAssignable(right, Types.String)) return Types.String;
                        throw new TypeError(
                            `Operator '+' cannot be applied to '${typeToString(left)}' and '${typeToString(right)}'.`,
                            expr.operator
                        );

                    case TokenType.EQUAL_EQUAL:
                    case TokenType.BANG_EQUAL:
                        if (!isAssignable(left, right) && !isAssignable(right, left)) {
                            throw new TypeError(
                                `Cannot compare '${typeToString(left)}' and '${typeToString(right)}'.`,
                                expr.operator
                            );
                        }
                        return Types.Boolean;

                    default:
                        throw new TypeError(`Binary operator '${expr.operator.lexeme}' is not implemented yet.`, expr.operator);
                }
            }

            case "Block": {
                if (expr.statements.length === 0 && !expr.returnExpr && !expr.unreachable) {
                    if (expected?.kind === "Map" || expected?.kind === "Set") {
                        return expected;
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
                case TokenType.TYPE_VECTOR: base = { kind: "Vector" }; break;
                case TokenType.TYPE_MATRIX: base = { kind: "Matrix" }; break;

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