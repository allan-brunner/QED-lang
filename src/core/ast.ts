import { Token, TokenType } from "./token.js";

export type TypeNode =
  | { readonly kind: "NamedType"; readonly name: string; readonly optional: boolean }
  ;

export type Stmt =
  | {
    readonly kind: "VarDecl";
    readonly isConst: boolean;
    readonly name: Token;
    readonly typeAnnotation?: TypeNode;
    readonly initializer: Expr;
  }
  | {
    readonly kind: "ExprStmt";
    readonly expr: Expr;
    readonly value?: Expr;
  }
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
  | { readonly kind: "Grouping"; readonly expr: Expr }
  | { readonly kind: "ListLit"; readonly elements: readonly Expr[]; readonly token: Token }
  | { readonly kind: "VectorLit"; readonly elements: readonly Expr[]; readonly token: Token }
  | {
    readonly kind: "MatrixLit";
    readonly cells: readonly Expr[];
    readonly nbRows: number;
    readonly nbCols: number;
    readonly token: Token;
  }
  | { readonly kind: "SetLit"; readonly elements: readonly Expr[]; readonly token: Token }
  | {
    readonly kind: "MapLit";
    readonly entries: readonly { readonly key: Expr; readonly value: Expr }[];
    readonly token: Token;
  }

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
  | { readonly kind: "Block"; readonly statements: readonly Stmt[]; readonly returnExpr?: Expr; readonly token: Token }
  | { readonly kind: "If"; readonly condition: Expr; readonly success: Expr; readonly fail?: Expr }
  ;
