import { Token } from "./token.js";

export type TypeNode =
  | { readonly kind: "NamedType"; readonly name: Token; readonly typeParams?: readonly TypeNode[]; readonly optional: boolean }
  | { readonly kind: "FuncType"; readonly params: readonly TypeNode[]; readonly returnType: TypeNode; readonly optional: boolean }
  ;

export interface FuncParam {
  readonly name: Token;
  readonly typeAnnotation?: TypeNode;
}

export type Stmt =
  | { readonly kind: "ImportDecl"; readonly path: Token }
  | { readonly kind: "ClassDecl"; readonly docComment?: string; readonly identifier: Token; readonly inherits?: Token; readonly members: readonly Stmt[]; }
  | { readonly kind: "FuncDecl"; readonly docComment?: string; readonly identifier: Token; readonly hasParens: boolean; readonly params: readonly FuncParam[]; readonly returnType?: TypeNode; readonly body: Expr; }
  | { readonly kind: "ContinueStmt"; readonly token: Token }
  | { readonly kind: "BreakStmt"; readonly returned?: Expr; readonly token: Token }
  | { readonly kind: "ReturnStmt"; readonly returned?: Expr; readonly token: Token }
  | { readonly kind: "VarDecl"; readonly isConst: boolean; readonly name: Token; readonly typeAnnotation?: TypeNode; readonly initializer: Expr; }
  | { readonly kind: "ExprStmt"; readonly expr: Expr; readonly hasSemicolon: boolean }
  ;

export type Expr =
  // Primary expressions
  | { readonly kind: "IntLit"; readonly value: bigint; readonly token: Token }
  | { readonly kind: "FloatLit"; readonly value: number; readonly token: Token }
  | { readonly kind: "ComplexLit"; readonly real: number; readonly imaginary: number; readonly token: Token }
  | { readonly kind: "StringLit"; readonly value: string; readonly token: Token }
  | { readonly kind: "BooleanLit"; readonly value: boolean; readonly token: Token }
  | { readonly kind: "NoneLit"; readonly token: Token }
  | { readonly kind: "Identifier"; readonly name: string; readonly token: Token }
  | { readonly kind: "Wildcard"; readonly token: Token }
  | { readonly kind: "ThisExpr"; readonly token: Token }
  | { readonly kind: "Grouping"; readonly expr: Expr }
  | { readonly kind: "ListLit"; readonly elements: readonly Expr[]; readonly token: Token }
  | { readonly kind: "ListDynamicLit"; readonly start: Expr; readonly end: Expr; readonly inclusive: boolean; readonly step?: Expr; readonly token: Token }
  | { readonly kind: "VectorLit"; readonly elements: readonly Expr[]; readonly token: Token }
  | { readonly kind: "MatrixLit"; readonly cells: readonly Expr[]; readonly nbRows: number; readonly nbCols: number; readonly token: Token; }
  | { readonly kind: "SetLit"; readonly elements: readonly Expr[]; readonly token: Token }
  | { readonly kind: "MapLit"; readonly entries: readonly { readonly key: Expr; readonly value: Expr }[]; readonly token: Token; }

  // Postfix expressions
  | { readonly kind: "PostfixUnary"; readonly operator: Token; readonly operand: Expr }
  | { readonly kind: "MemberAccess"; readonly object: Expr; readonly name: Token }
  | { readonly kind: "FunctionCall"; readonly object: Expr; readonly args: readonly Expr[]; readonly token: Token }
  | { readonly kind: "Slicing"; readonly object: Expr; readonly start?: Expr; readonly end?: Expr; readonly token: Token }
  | { readonly kind: "Index"; readonly object: Expr; readonly indexes: readonly Expr[]; readonly token: Token }

  // Operator expressions
  | { readonly kind: "Unary"; readonly operator: Token; readonly operand: Expr }
  | { readonly kind: "Binary"; readonly left: Expr; readonly operator: Token; readonly right: Expr }

  // Control flow & block expressions
  | { readonly kind: "Block"; readonly statements: readonly Stmt[]; readonly returnExpr?: Expr; readonly unreachable?: readonly Stmt[]; readonly token: Token }
  | { readonly kind: "If"; readonly condition: Expr; readonly success: Expr; readonly fail?: Expr; readonly token: Token }
  | { readonly kind: "While"; readonly condition: Expr; readonly block: Expr; readonly token: Token }
  | { readonly kind: "For"; readonly identifier: Token; readonly expr: Expr; readonly block: Expr; readonly token: Token }
  | { readonly kind: "Match"; readonly expr: Expr; readonly arms: readonly { readonly patterns: readonly Expr[]; readonly success: Expr }[]; readonly token: Token }

  // Assign expression
  | { readonly kind: "Assign"; readonly target: Expr; readonly value: Expr; readonly token: Token }
  ;
