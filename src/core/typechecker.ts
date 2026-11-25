import { Expr, Stmt, TypeNode } from "./ast.js";
import { Token, TokenType } from "./token.js";
import { Scope, SymbolEntry } from "./scope.js";
import { Type, Types, commonType, isAssignable, isInteger, isNumeric, isOrdered, isOrderedNumeric, optionalOf, promoteInteger, promoteNumeric, typeEquals, typeToString, unwrapOptional } from "./types.js";
import { BUILTIN_MODULES, lookupBuiltinMember } from "./builtins.js";

export class TypeError extends Error {
    constructor(message: string, public readonly token?: Token) {
        const loc = token ? ` at ${token.line}:${token.column}` : "";
        super(`Type error${loc}: ${message}`);
    }
}

export type ModuleLoader = (importPath: string) => readonly Stmt[] | undefined;

interface ModuleExports {
    readonly symbols: Map<string, SymbolEntry>;
    readonly classes: Map<string, ClassInfo>;
}

export interface TypeCheckerOptions {
    readonly moduleLoader?: ModuleLoader;
    readonly moduleCache?: Map<string, ModuleExports>;
    readonly loadingModules?: Set<string>;
}

interface LoopContext {
    readonly expectedValue?: Type;
    readonly breakTypes: Type[];
    hasBareBreak: boolean;
}

interface FuncContext {
    readonly declaredReturn?: Type;
    readonly inferredReturns: Type[];
}

interface FieldInfo {
    readonly type: Type;
    readonly isConst: boolean;
}

interface MethodInfo {
    readonly params: readonly Type[];
    readonly returnType: Type;
    readonly hasParens: boolean;
}

interface ClassInfo {
    readonly name: string;
    parent?: string;
    readonly fields: Map<string, FieldInfo>;
    readonly methods: Map<string, MethodInfo>;
}

export class TypeChecker {
    private scope = new Scope();

    private readonly moduleLoader?: ModuleLoader;
    private readonly moduleCache: Map<string, ModuleExports>;
    private readonly loadingModules: Set<string>;
    private readonly importedPaths = new Set<string>();

    private readonly loopStack: LoopContext[] = [];
    private readonly funcStack: FuncContext[] = [];

    private readonly classes = new Map<string, ClassInfo>();
    private readonly pendingFuncs = new Set<string>();
    private currentClass?: ClassInfo;

    public readonly exprTypes = new Map<Expr, Type>();

    constructor(options: TypeCheckerOptions = {}) {
        this.moduleLoader = options.moduleLoader;
        this.moduleCache = options.moduleCache ?? new Map();
        this.loadingModules = options.loadingModules ?? new Set();
    }

    public checkProgram(stmts: readonly Stmt[]): void {
        this.hoistDeclarations(stmts);
        for (const stmt of stmts) {
            this.checkStmt(stmt);
        }
    }

    private hoistDeclarations(stmts: readonly Stmt[]): void {
        for (const stmt of stmts) {
            if (stmt.kind === "ImportDecl") {
                this.processImport(stmt);
            }
        }

        for (const stmt of stmts) {
            if (stmt.kind !== "ClassDecl") continue;
            const name = stmt.identifier.lexeme;
            if (this.classes.has(name)) {
                throw new TypeError(`Class '${name}' is already declared.`, stmt.identifier);
            }
            this.classes.set(name, { name, fields: new Map(), methods: new Map() });
        }

        for (const stmt of stmts) {
            if (stmt.kind !== "ClassDecl" || !stmt.inherits) continue;
            const cls = this.classes.get(stmt.identifier.lexeme)!;
            const parentName = stmt.inherits.lexeme;

            if (!this.classes.has(parentName)) {
                throw new TypeError(`Superclass '${parentName}' is not defined.`, stmt.inherits);
            }
            cls.parent = parentName;

            // Cycle detection
            let cursor: string | undefined = parentName;
            while (cursor) {
                if (cursor === cls.name) {
                    throw new TypeError(`Circular inheritance detected involving '${cls.name}'.`, stmt.inherits);
                }
                cursor = this.classes.get(cursor)?.parent;
            }
        }

        for (const stmt of stmts) {
            if (stmt.kind === "FuncDecl") {
                this.hoistFuncSignature(stmt);
            } else if (stmt.kind === "ClassDecl") {
                this.hoistClassMembers(stmt);
            }
        }
    }

    private processImport(stmt: Extract<Stmt, { kind: "ImportDecl" }>): void {
        const importPath = stmt.path.lexeme.slice(1, -1);

        if (this.importedPaths.has(importPath)) return;
        this.importedPaths.add(importPath);

        const builtin = BUILTIN_MODULES.get(importPath);
        if (builtin) {
            for (const [name, entry] of builtin) {
                const existing = this.scope.lookup(name);
                if (existing && existing !== entry) {
                    throw new TypeError(
                        `Import '${importPath}' conflicts with existing symbol '${name}'.`,
                        stmt.path
                    );
                }
                if (!existing) {
                    this.scope.define(name, entry);
                }
            }
            return;
        }

        if (!this.moduleLoader) {
            throw new TypeError(`Unknown module '${importPath}'.`, stmt.path);
        }

        if (this.loadingModules.has(importPath)) {
            throw new TypeError(`Circular import detected involving '${importPath}'.`, stmt.path);
        }

        let exports = this.moduleCache.get(importPath);
        if (!exports) {
            const ast = this.moduleLoader(importPath);
            if (!ast) {
                throw new TypeError(`Cannot resolve module '${importPath}'.`, stmt.path);
            }

            this.loadingModules.add(importPath);
            try {
                const child = new TypeChecker({
                    moduleLoader: this.moduleLoader,
                    moduleCache: this.moduleCache,
                    loadingModules: this.loadingModules,
                });
                child.checkProgram(ast);
                exports = {
                    symbols: new Map(child.scope.entries()),
                    classes: new Map(child.classes),
                };
                this.moduleCache.set(importPath, exports);
            } finally {
                this.loadingModules.delete(importPath);
            }
        }

        for (const [name, clsInfo] of exports.classes) {
            const existing = this.classes.get(name);
            if (existing && existing !== clsInfo) {
                throw new TypeError(
                    `Import '${importPath}' conflicts with existing class '${name}'.`,
                    stmt.path
                );
            }
            this.classes.set(name, clsInfo);
        }

        for (const [name, entry] of exports.symbols) {
            const existing = this.scope.lookup(name);
            if (existing && existing !== entry) {
                throw new TypeError(
                    `Import '${importPath}' conflicts with existing symbol '${name}'.`,
                    stmt.path
                );
            }
            if (!existing) {
                this.scope.define(name, entry);
            }
        }
    }

    private resolveFuncParams(stmt: Extract<Stmt, { kind: "FuncDecl" }>): Type[] {
        return stmt.params.map((p) => {
            if (!p.typeAnnotation) {
                throw new TypeError(
                    `Parameter '${p.name.lexeme}' of function '${stmt.identifier.lexeme}' requires a type annotation.`,
                    p.name
                );
            }
            return this.resolveTypeNode(p.typeAnnotation);
        });
    }

    private hoistFuncSignature(stmt: Extract<Stmt, { kind: "FuncDecl" }>): void {
        const name = stmt.identifier.lexeme;
        const params = this.resolveFuncParams(stmt);

        if (!stmt.returnType) {
            this.pendingFuncs.add(name);
            return;
        }

        const fnType: Type = {
            kind: "Function",
            params,
            returnType: this.resolveTypeNode(stmt.returnType),
            hasParens: stmt.hasParens ?? true,
        };

        if (!this.scope.define(name, { type: fnType, isConst: true })) {
            throw new TypeError(`Function '${name}' is already declared in this scope.`, stmt.identifier);
        }
    }

    private hoistClassMembers(stmt: Extract<Stmt, { kind: "ClassDecl" }>): void {
        const cls = this.classes.get(stmt.identifier.lexeme)!;

        for (const member of stmt.members) {
            if (member.kind === "VarDecl" && member.typeAnnotation) {
                const fieldName = member.name.lexeme;
                if (cls.fields.has(fieldName) || cls.methods.has(fieldName)) {
                    throw new TypeError(`Duplicate member '${fieldName}' in class '${cls.name}'.`, member.name);
                }
                cls.fields.set(fieldName, {
                    type: this.resolveTypeNode(member.typeAnnotation),
                    isConst: member.isConst,
                });
            } else if (member.kind === "FuncDecl") {
                const methodName = member.identifier.lexeme;
                if (cls.fields.has(methodName) || cls.methods.has(methodName)) {
                    throw new TypeError(`Duplicate member '${methodName}' in class '${cls.name}'.`, member.identifier);
                }
                const params = this.resolveFuncParams(member);
                const returnType = member.returnType ? this.resolveTypeNode(member.returnType) : Types.Void;
                cls.methods.set(methodName, {
                    params,
                    returnType,
                    hasParens: member.hasParens ?? true,
                });
            }
        }
    }

    private checkStmt(stmt: Stmt): void {
        switch (stmt.kind) {
            case "VarDecl": {
                const expected = stmt.typeAnnotation
                    ? this.resolveTypeNode(stmt.typeAnnotation)
                    : undefined;

                const initType = this.checkExpr(stmt.initializer, expected);

                if (expected && !isAssignable(initType, expected, this.isSubclass)) {
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

            case "ContinueStmt": {
                if (this.loopStack.length === 0) {
                    throw new TypeError("'continue' can only be used inside a loop.", stmt.token);
                }
                return;
            }

            case "BreakStmt": {
                const loop = this.loopStack[this.loopStack.length - 1];
                if (!loop) {
                    throw new TypeError("'break' can only be used inside a loop.", stmt.token);
                }

                if (!stmt.returned) {
                    loop.hasBareBreak = true;
                    return;
                }

                const valType = this.checkExpr(stmt.returned, loop.expectedValue);
                if (loop.expectedValue && !isAssignable(valType, loop.expectedValue, this.isSubclass)) {
                    throw new TypeError(
                        `Cannot break with '${typeToString(valType)}'; expected '${typeToString(loop.expectedValue)}'.`,
                        stmt.token
                    );
                }
                loop.breakTypes.push(valType);
                return;
            }

            case "ReturnStmt": {
                const fn = this.funcStack[this.funcStack.length - 1];
                if (!fn) {
                    throw new TypeError("'return' can only be used inside a function.", stmt.token);
                }

                const retType = stmt.returned
                    ? this.checkExpr(stmt.returned, fn.declaredReturn)
                    : Types.Void;

                if (fn.declaredReturn) {
                    if (!isAssignable(retType, fn.declaredReturn, this.isSubclass)) {
                        throw new TypeError(
                            `Cannot return '${typeToString(retType)}' from function returning '${typeToString(fn.declaredReturn)}'.`,
                            stmt.token
                        );
                    }
                } else {
                    fn.inferredReturns.push(retType);
                }
                return;
            }

            case "FuncDecl": {
                this.checkFuncBody(stmt, false);
                return;
            }

            case "ClassDecl": {
                const cls = this.classes.get(stmt.identifier.lexeme)!;
                const prevClass = this.currentClass;
                this.currentClass = cls;

                try {
                    for (const member of stmt.members) {
                        if (member.kind !== "VarDecl") continue;

                        if (member.typeAnnotation) {
                            const expected = cls.fields.get(member.name.lexeme)!.type;
                            const initType = this.checkExpr(member.initializer, expected);
                            if (!isAssignable(initType, expected, this.isSubclass)) {
                                throw new TypeError(
                                    `Cannot assign '${typeToString(initType)}' to field '${member.name.lexeme}' of type '${typeToString(expected)}'.`,
                                    member.name
                                );
                            }
                        } else {
                            const fieldName = member.name.lexeme;
                            if (cls.fields.has(fieldName) || cls.methods.has(fieldName)) {
                                throw new TypeError(`Duplicate member '${fieldName}' in class '${cls.name}'.`, member.name);
                            }
                            const initType = this.checkExpr(member.initializer);
                            if (initType.kind === "Primitive" && initType.name === "None") {
                                throw new TypeError(
                                    `Cannot infer type of field '${fieldName}' from 'None'; add an explicit type annotation.`,
                                    member.name
                                );
                            }
                            cls.fields.set(fieldName, { type: initType, isConst: member.isConst });
                        }
                    }

                    for (const member of stmt.members) {
                        if (member.kind === "FuncDecl") {
                            this.checkFuncBody(member, true);
                        }
                    }
                } finally {
                    this.currentClass = prevClass;
                }
                return;
            }

            case "ImportDecl": {
                if (this.scope.parent !== undefined) {
                    throw new TypeError("'import' statements are only allowed at the top level.", stmt.path);
                }
                return;
            }

            default: {
                const _exhaustive: never = stmt;
                throw new TypeError(`Unhandled statement kind: ${(_exhaustive as Stmt).kind}`);
            }
        }
    }

    private checkFuncBody(stmt: Extract<Stmt, { kind: "FuncDecl" }>, isMethod: boolean): void {
        const name = stmt.identifier.lexeme;
        const paramTypes = this.resolveFuncParams(stmt);
        const declaredReturn = stmt.returnType ? this.resolveTypeNode(stmt.returnType) : undefined;

        const prevScope = this.scope;
        this.scope = new Scope(prevScope);
        const fnCtx: FuncContext = { declaredReturn, inferredReturns: [] };
        this.funcStack.push(fnCtx);

        let bodyType: Type;
        try {
            stmt.params.forEach((param, i) => {
                if (!this.scope.define(param.name.lexeme, { type: paramTypes[i], isConst: true })) {
                    throw new TypeError(`Duplicate parameter '${param.name.lexeme}'.`, param.name);
                }
            });

            bodyType = this.checkExpr(stmt.body, declaredReturn);
        } finally {
            this.funcStack.pop();
            this.scope = prevScope;
        }

        if (declaredReturn) {
            if (!isAssignable(bodyType, declaredReturn, this.isSubclass)) {
                throw new TypeError(
                    `Function '${name}' declared return type '${typeToString(declaredReturn)}', but body evaluates to '${typeToString(bodyType)}'.`,
                    stmt.identifier
                );
            }
            return;
        }

        const allReturns = [...fnCtx.inferredReturns];
        if (!(bodyType.kind === "Primitive" && bodyType.name === "Never")) {
            allReturns.push(bodyType);
        }

        let inferred: Type = Types.Void;
        if (allReturns.length > 0) {
            inferred = allReturns[0];
            for (let i = 1; i < allReturns.length; i++) {
                const merged = commonType(inferred, allReturns[i], this.isSubclass);
                if (!merged) {
                    throw new TypeError(
                        `Incompatible return types in function '${name}': '${typeToString(inferred)}' and '${typeToString(allReturns[i])}'.`,
                        stmt.identifier
                    );
                }
                inferred = merged;
            }
        }

        if (isMethod && this.currentClass) {
            this.currentClass.methods.set(name, {
                params: paramTypes,
                returnType: inferred,
                hasParens: stmt.hasParens ?? true,
            });
        } else {
            this.pendingFuncs.delete(name);
            this.scope.define(name, {
                type: { kind: "Function", params: paramTypes, returnType: inferred, hasParens: stmt.hasParens ?? true },
                isConst: true,
            });
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
                    isAssignable(left, right, this.isSubclass) ||
                    isAssignable(right, left, this.isSubclass)
                ) {
                    return Types.Boolean;
                }
                return fail();

            // Logical
            case TokenType.AMP_AMP:
            case TokenType.PIPE_PIPE:
                if (isAssignable(left, Types.Boolean, this.isSubclass) && isAssignable(right, Types.Boolean, this.isSubclass)) {
                    return Types.Boolean;
                }
                return fail();

            // Membership
            case TokenType.IN:
                if ((right.kind === "List" || right.kind === "Set" || right.kind === "Deque" || right.kind === "Heap")
                    && isAssignable(left, right.element, this.isSubclass)) {
                    return Types.Boolean;
                }
                if (right.kind === "Map" && isAssignable(left, right.key, this.isSubclass)) return Types.Boolean;
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
                if (!isAssignable(elType, expectedElem, this.isSubclass)) {
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
                const merged = commonType(acc, elType, this.isSubclass);
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

    private checkCallArgs(
        args: readonly Expr[],
        expectedParams: readonly Type[],
        label: string,
        token: Token
    ): void {
        if (args.length !== expectedParams.length) {
            throw new TypeError(
                `Expected ${expectedParams.length} argument(s) for '${label}', got ${args.length}.`,
                token
            );
        }
        for (let i = 0; i < args.length; i++) {
            const argType = this.checkExpr(args[i], expectedParams[i]);
            if (!isAssignable(argType, expectedParams[i], this.isSubclass)) {
                throw new TypeError(
                    `Argument ${i + 1} of '${label}': cannot assign '${typeToString(argType)}' to '${typeToString(expectedParams[i])}'.`,
                    token
                );
            }
        }
    }

    private makeUnaryCollection(
        kind: "List" | "Set" | "Deque" | "Heap",
        element: Type
    ): Type {
        switch (kind) {
            case "List": return { kind: "List", element };
            case "Set": return { kind: "Set", element };
            case "Deque": return { kind: "Deque", element };
            case "Heap": return { kind: "Heap", element };
        }
    }

    private checkCollectionConstructor(
        expr: Extract<Expr, { kind: "FunctionCall" }>,
        expected?: Type
    ): Type | undefined {
        if (expr.object.kind !== "Identifier") return undefined;
        const name = expr.object.name;
        if (this.scope.lookup(name) || this.classes.has(name)) return undefined;

        if (name === "Map") {
            const target = unwrapOptional(expected);
            if (expr.args.length === 0) {
                if (target?.kind === "Map") return target;
                throw new TypeError("Cannot infer types of empty 'Map()'; add a type annotation.", expr.token);
            }
            if (expr.args.length === 1) {
                const src = this.checkExpr(expr.args[0], target?.kind === "Map" ? target : undefined);
                if (src.kind !== "Map") {
                    throw new TypeError(`'Map()' expects a Map argument, got '${typeToString(src)}'.`, expr.token);
                }
                return src;
            }
            throw new TypeError(`'Map()' takes at most 1 argument, got ${expr.args.length}.`, expr.token);
        }

        if (name === "List" || name === "Set" || name === "Deque" || name === "Heap") {
            const target = unwrapOptional(expected);
            const expectedElem = target?.kind === name ? target.element : undefined;

            if (expr.args.length === 0) {
                if (expectedElem) return this.makeUnaryCollection(name, expectedElem);
                throw new TypeError(
                    `Cannot infer element type of empty '${name}()'; add a type annotation.`,
                    expr.token
                );
            }

            if (expr.args.length === 1) {
                const expectedArg: Type | undefined =
                    expectedElem && expr.args[0].kind === "ListLit"
                        ? { kind: "List", element: expectedElem }
                        : undefined;
                const srcType = this.checkExpr(expr.args[0], expectedArg);
                const elemType = this.getIterableElementType(srcType, expr.token);

                if (name === "Heap" && !isOrdered(elemType)) {
                    throw new TypeError(
                        `Heap element type must be orderable, got '${typeToString(elemType)}'.`,
                        expr.token
                    );
                }

                return this.makeUnaryCollection(name, elemType);
            }

            throw new TypeError(`'${name}()' takes at most 1 argument, got ${expr.args.length}.`, expr.token);
        }

        return undefined;
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
                        if (!isAssignable(k, expectedKey, this.isSubclass)) {
                            throw new TypeError(
                                `Map key of type '${typeToString(k)}' is not assignable to '${typeToString(expectedKey)}'.`,
                                expr.token
                            );
                        }
                    } else if (!keyType) {
                        keyType = k;
                    } else {
                        const mergedK = commonType(keyType, k, this.isSubclass);
                        if (!mergedK) {
                            throw new TypeError(
                                `Incompatible Map key types: '${typeToString(keyType)}' and '${typeToString(k)}'.`,
                                expr.token
                            );
                        }
                        keyType = mergedK;
                    }

                    if (expectedVal) {
                        if (!isAssignable(v, expectedVal, this.isSubclass)) {
                            throw new TypeError(
                                `Map value of type '${typeToString(v)}' is not assignable to '${typeToString(expectedVal)}'.`,
                                expr.token
                            );
                        }
                    } else if (!valType) {
                        valType = v;
                    } else {
                        const mergedV = commonType(valType, v, this.isSubclass);
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
                    if (this.pendingFuncs.has(expr.name)) {
                        throw new TypeError(
                            `Function '${expr.name}' is referenced before its return type is inferred; add an explicit return type.`,
                            expr.token
                        );
                    }
                    throw new TypeError(`Undefined identifier '${expr.name}'.`, expr.token);
                }
                if (entry.type.kind === "Function" && entry.type.hasParens === false) {
                    return entry.type.returnType;
                }
                return entry.type;
            }

            case "ThisExpr": {
                if (!this.currentClass) {
                    throw new TypeError("'this' can only be used inside a class method.", expr.token);
                }
                return { kind: "Class", name: this.currentClass.name };
            }

            case "MemberAccess": {
                const objType = this.checkExpr(expr.object);
                const prop = expr.name.lexeme;

                if (objType.kind === "Class") {
                    const field = this.lookupField(objType.name, prop);
                    if (field) return field.type;

                    const method = this.lookupMethod(objType.name, prop);
                    if (method) {
                        return method.hasParens
                            ? { kind: "Function", params: method.params, returnType: method.returnType, hasParens: true }
                            : method.returnType;
                    }

                    throw new TypeError(`Class '${objType.name}' has no field or method '${prop}'.`, expr.name);
                }

                const builtin = lookupBuiltinMember(objType, prop);
                if (builtin) return builtin;

                throw new TypeError(`Type '${typeToString(objType)}' has no property or method '${prop}'.`, expr.name);
            }

            case "FunctionCall": {
                const builtCollection = this.checkCollectionConstructor(expr, expected);
                if (builtCollection) return builtCollection;
                if (
                    expr.object.kind === "Identifier" &&
                    !this.scope.lookup(expr.object.name) &&
                    this.classes.has(expr.object.name)
                ) {
                    const clsName = expr.object.name;
                    const initMethod = this.lookupMethod(clsName, "init");
                    const expectedParams = initMethod ? initMethod.params : [];
                    this.checkCallArgs(expr.args, expectedParams, clsName, expr.token);
                    return { kind: "Class", name: clsName };
                }

                const callee = this.checkExpr(expr.object);
                if (callee.kind !== "Function") {
                    throw new TypeError(`Cannot call value of non-function type '${typeToString(callee)}'.`, expr.token);
                }

                this.checkCallArgs(expr.args, callee.params, "function", expr.token);
                return callee.returnType;
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
                    if (!isAssignable(valueType, entry.type, this.isSubclass)) {
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
                    if (!isAssignable(valueType, slotType, this.isSubclass)) {
                        throw new TypeError(
                            `Cannot assign '${typeToString(valueType)}' to '${typeToString(slotType)}'.`,
                            expr.token
                        );
                    }
                    return valueType;
                }

                if (expr.target.kind === "MemberAccess") {
                    const objType = this.checkExpr(expr.target.object);
                    if (objType.kind !== "Class") {
                        throw new TypeError(`Cannot assign to property of non-class type '${typeToString(objType)}'.`, expr.token);
                    }
                    const prop = expr.target.name.lexeme;
                    const field = this.lookupField(objType.name, prop);
                    if (!field) {
                        throw new TypeError(`Class '${objType.name}' has no mutable field '${prop}'.`, expr.target.name);
                    }
                    if (field.isConst) {
                        throw new TypeError(`Cannot reassign constant field '${prop}'.`, expr.token);
                    }
                    const valueType = this.checkExpr(expr.value, field.type);
                    if (!isAssignable(valueType, field.type, this.isSubclass)) {
                        throw new TypeError(
                            `Cannot assign '${typeToString(valueType)}' to '${typeToString(field.type)}'.`,
                            expr.token
                        );
                    }
                    return valueType;
                }
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
                        if (isAssignable(operand, Types.Boolean, this.isSubclass)) return Types.Boolean;
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

                if (objType.kind === "List" || objType.kind === "Deque") {
                    if (idxTypes.length !== 1 || !isInteger(idxTypes[0])) {
                        throw new TypeError(`${objType.kind} indexing requires a single integer index.`, expr.token);
                    }
                    return objType.element;
                }

                if (objType.kind === "Map") {
                    if (idxTypes.length !== 1 || !isAssignable(idxTypes[0], objType.key, this.isSubclass)) {
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

                    const last = expr.statements[expr.statements.length - 1];
                    if (
                        last?.kind === "ReturnStmt" ||
                        last?.kind === "BreakStmt" ||
                        last?.kind === "ContinueStmt"
                    ) {
                        return Types.Never;
                    }

                    return expr.returnExpr ? this.checkExpr(expr.returnExpr, expected) : Types.Void;
                } finally {
                    this.scope = prevScope;
                }
            }

            case "If": {
                const condType = this.checkExpr(expr.condition, Types.Boolean);
                if (!isAssignable(condType, Types.Boolean, this.isSubclass)) {
                    throw new TypeError(
                        `Condition of 'if' must be Boolean, got '${typeToString(condType)}'.`,
                        expr.token
                    );
                }

                const successType = this.checkExpr(expr.success, expected);
                if (!expr.fail) return Types.Void;

                const failType = this.checkExpr(expr.fail, expected ?? successType);
                const merged = commonType(successType, failType, this.isSubclass);
                if (!merged) {
                    throw new TypeError(
                        `Incompatible 'if' branch types: '${typeToString(successType)}' vs '${typeToString(failType)}'.`,
                        expr.token
                    );
                }
                return merged;
            }

            case "While": {
                const condType = this.checkExpr(expr.condition, Types.Boolean);
                if (!isAssignable(condType, Types.Boolean, this.isSubclass)) {
                    throw new TypeError(
                        `Condition of 'while' must be Boolean, got '${typeToString(condType)}'.`,
                        expr.token
                    );
                }

                const loop: LoopContext = {
                    expectedValue: unwrapOptional(expected),
                    breakTypes: [],
                    hasBareBreak: false,
                };
                this.loopStack.push(loop);
                try {
                    this.checkExpr(expr.block);
                } finally {
                    this.loopStack.pop();
                }

                return this.resolveLoopType(loop, expr.token);
            }

            case "For": {
                const iterableType = this.checkExpr(expr.expr);
                const elemType = this.getIterableElementType(iterableType, expr.token);

                const prevScope = this.scope;
                this.scope = new Scope(prevScope);
                const loop: LoopContext = {
                    expectedValue: unwrapOptional(expected),
                    breakTypes: [],
                    hasBareBreak: false,
                };
                this.loopStack.push(loop);

                try {
                    if (expr.identifier.type !== TokenType.UNDERLINE) {
                        this.scope.define(expr.identifier.lexeme, { type: elemType, isConst: true });
                    }
                    this.checkExpr(expr.block);
                } finally {
                    this.loopStack.pop();
                    this.scope = prevScope;
                }

                return this.resolveLoopType(loop, expr.token);
            }

            case "Match": {
                const subjectType = this.checkExpr(expr.expr);
                if (expr.arms.length === 0) return Types.Void;

                let resultType: Type | undefined;

                for (const arm of expr.arms) {
                    for (const pat of arm.patterns) {
                        if (pat.kind === "Wildcard") {
                            this.exprTypes.set(pat, subjectType);
                            continue;
                        }

                        const patType = this.checkExpr(pat, subjectType);
                        if (!isAssignable(patType, subjectType, this.isSubclass)) {
                            throw new TypeError(
                                `Pattern of type '${typeToString(patType)}' cannot match value of type '${typeToString(subjectType)}'.`,
                                expr.token
                            );
                        }
                    }

                    const armType = this.checkExpr(arm.success, expected);
                    if (!resultType) {
                        resultType = armType;
                    } else {
                        const merged = commonType(resultType, armType, this.isSubclass);
                        if (!merged) {
                            throw new TypeError(
                                `Incompatible 'match' arm types: '${typeToString(resultType)}' and '${typeToString(armType)}'.`,
                                expr.token
                            );
                        }
                        resultType = merged;
                    }
                }

                if (!resultType) return Types.Void;

                const exhaustive = this.isMatchExhaustive(subjectType, expr.arms);
                if (!exhaustive) {
                    if (
                        resultType.kind === "Primitive" &&
                        (resultType.name === "Void" || resultType.name === "Never")
                    ) {
                        return Types.Void;
                    }
                    throw new TypeError(
                        "Non-exhaustive 'match' expression producing a value; add a wildcard '_' arm.",
                        expr.token
                    );
                }

                return resultType;
            }

            case "Wildcard": {
                throw new TypeError(
                    "Wildcard '_' can only be used in 'match' patterns or 'for' loop bindings.",
                    expr.token
                );
            }

            default: {
                const _exhaustive: never = expr;
                throw new TypeError(`Unhandled expression kind: ${(_exhaustive as Expr).kind}`);
            }
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

                case TokenType.TYPE_DEQUE:
                    if (params.length !== 1) throw new TypeError("Deque requires 1 type parameter.", node.name);
                    base = { kind: "Deque", element: this.resolveTypeNode(params[0]) };
                    break;

                case TokenType.TYPE_HEAP: {
                    if (params.length !== 1) throw new TypeError("Heap requires 1 type parameter.", node.name);
                    const elem = this.resolveTypeNode(params[0]);
                    if (!isOrdered(elem)) {
                        throw new TypeError(
                            `Heap element type must be orderable, got '${typeToString(elem)}'.`,
                            node.name
                        );
                    }
                    base = { kind: "Heap", element: elem };
                    break;
                }

                case TokenType.TYPE_MAP:
                    if (params.length !== 2) throw new TypeError("Map requires 2 type parameters.", node.name);
                    base = {
                        kind: "Map",
                        key: this.resolveTypeNode(params[0]),
                        value: this.resolveTypeNode(params[1]),
                    };
                    break;

                case TokenType.IDENT:
                    if (!this.classes.has(node.name.lexeme)) throw new TypeError(`Unknown type '${node.name.lexeme}'.`, node.name);
                    base = { kind: "Class", name: node.name.lexeme };
                    break;

                default:
                    throw new TypeError(`Unknown type '${node.name.lexeme}'.`, node.name);
            }
        }

        return node.optional ? optionalOf(base) : base;
    }

    private resolveLoopType(loop: LoopContext, token: Token): Type {
        if (loop.breakTypes.length === 0) {
            return Types.Void;
        }

        if (loop.hasBareBreak) {
            throw new TypeError(
                "Cannot mix bare 'break;' and 'break <value>;' in the same loop.",
                token
            );
        }

        let merged = loop.breakTypes[0];
        for (let i = 1; i < loop.breakTypes.length; i++) {
            const next = commonType(merged, loop.breakTypes[i], this.isSubclass);
            if (!next) {
                throw new TypeError(
                    `Incompatible 'break' value types in loop: '${typeToString(merged)}' and '${typeToString(loop.breakTypes[i])}'.`,
                    token
                );
            }
            merged = next;
        }

        return optionalOf(merged);
    }

    private getIterableElementType(iterable: Type, token: Token): Type {
        switch (iterable.kind) {
            case "List":
            case "Set":
            case "Deque":
            case "Heap":
            case "Vector":
                return iterable.element;
            case "Matrix":
                return { kind: "Vector", element: iterable.element };
            case "Map":
                return iterable.key;
            case "Primitive":
                if (iterable.name === "String") return Types.String;
                break;
        }

        throw new TypeError(
            `Type '${typeToString(iterable)}' is not iterable in a 'for' loop.`,
            token
        );
    }

    private isMatchExhaustive(
        subjectType: Type,
        arms: readonly { readonly patterns: readonly Expr[]; readonly success: Expr }[]
    ): boolean {
        let hasTrue = false;
        let hasFalse = false;

        for (const arm of arms) {
            for (const pat of arm.patterns) {
                if (pat.kind === "Wildcard") return true;
                if (pat.kind === "BooleanLit") {
                    if (pat.value) hasTrue = true;
                    else hasFalse = true;
                }
            }
        }

        return (
            subjectType.kind === "Primitive" &&
            subjectType.name === "Boolean" &&
            hasTrue &&
            hasFalse
        );
    }

    private isSubclass = (sub: string, sup: string): boolean => {
        let curr = this.classes.get(sub)?.parent;
        while (curr) {
            if (curr === sup) return true;
            curr = this.classes.get(curr)?.parent;
        }
        return false;
    };

    private lookupField(className: string, fieldName: string): FieldInfo | undefined {
        let curr: string | undefined = className;
        while (curr) {
            const cls = this.classes.get(curr);
            const field = cls?.fields.get(fieldName);
            if (field) return field;
            curr = cls?.parent;
        }
        return undefined;
    }

    private lookupMethod(className: string, methodName: string): MethodInfo | undefined {
        let curr: string | undefined = className;
        while (curr) {
            const cls = this.classes.get(curr);
            const method = cls?.methods.get(methodName);
            if (method) return method;
            curr = cls?.parent;
        }
        return undefined;
    }
}