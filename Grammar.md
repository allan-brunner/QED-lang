## Program & statements
```ebnf
Program        = { Statement } EOF ;

Statement      = VarDecl
               | ImportDecl
               | ClassDecl
               | FuncDecl
               | ContinueStmt
               | BreakStmt
               | ReturnStmt
               | ExprStmt ;

ImportDecl     = "import" STRING_LIT ";" ;

ClassDecl      = "class" IDENT [ "inherits" IDENT ] "{" { ClassMember } "}" ;
ClassMember    = VarDecl | FuncDecl ;

FuncDecl       = "func" IDENT [ "(" [ FuncParam { "," FuncParam } ] ")" ]
                 [ ":" Type ]
                 ( Block | "=>" Expr ";" ) ;
FuncParam      = IDENT [ ":" Type ] ;

VarDecl        = ( "let" | "const" ) IDENT [ ":" Type ] "=" Expr ";" ;

ContinueStmt   = "continue" ";" ;
BreakStmt      = "break" [ Expr ] ";" ;
ReturnStmt     = "return" [ Expr ] ";" ;

(* Top-level ExprStmts require ";" unless block-ended or at EOF.
   Inside a Block, the first semicolon-less non-block ExprStmt (or trailing
   semicolon-less block-ended ExprStmt) becomes the block's implicit return;
   any statements after a return/break/continue/implicit return are unreachable. *)
ExprStmt       = Expr [ ";" ] ;
```
## Type annotations
```ebnf
Type           = BaseType [ "?" ] ;

BaseType       = "(" [ Type { "," Type } ] ")" "->" Type
               | "(" Type ")"
               | "Map" [ "<" Type "," Type ">" ]
               | ( "List" | "Set" | "Deque" | "Heap" ) [ "<" Type ">" ]
               | PrimitiveType
               | "None"
               | IDENT ;

PrimitiveType  = "Boolean" | "Int" | "BigInt" | "Float" | "Double"
               | "String" | "Vector" | "Matrix" | "Complex" ;
```
## Expressions & operators precedence
```ebnf
Expr           = Assign ;

Assign         = Ternary [ "=" Assign ] ;
Ternary        = LogicOr [ "?" Expr ":" Ternary ] ;

LogicOr        = LogicAnd      { "||" LogicAnd } ;
LogicAnd       = Equality      { "&&" Equality } ;
Equality       = Order         { ( "==" | "!=" | "~=" ) Order } ;
Order          = BitwiseOr     { ( "<" | ">" | "<=" | ">=" | "in" ) BitwiseOr } ;
BitwiseOr      = BitwiseXor    { "|" BitwiseXor } ;
BitwiseXor     = BitwiseAnd    { "^" BitwiseAnd } ;
BitwiseAnd     = Shift         { "&" Shift } ;
Shift          = Additive      { ( "<<" | ">>" ) Additive } ;
Additive       = Multiplicative { ( "+" | "-" | "union" | "\" ) Multiplicative } ;
Multiplicative = Unary         { ( "*" | "/" | "div" | "%" | "cross" | "inter" ) Unary } ;

Unary          = ( "+" | "-" | "!" | "~" ) Unary
               | ImplicitMul ;

ImplicitMul    = Power         [ (* adjacent, when LHS is NumberLit *) Power ] ;
Power          = Postfix       [ "**" Unary ] ;

Postfix        = Primary { PostfixOp } ;
PostfixOp      = "!"
               | "." IDENT
               | "(" [ Expr { "," Expr } ] ")"          (* not on NumberLit *)
               | "[" [ Expr ] ":" [ Expr ] "]"          (* slice *)
               | "[" Expr { "," Expr } "]" ;            (* 1D / 2D index *)
```
## Primary, collection & control-flow expressions
```ebnf
Primary        = INT_LIT | FLOAT_LIT | COMPLEX_LIT | STRING_LIT
               | "true" | "false" | "None" | "this" | "_" | IDENT
               | "(" Expr ")"
               | IfExpr
               | WhileExpr
               | ForExpr
               | MatchExpr
               | ListExpr
               | VecMatExpr
               | BraceExpr ;

Body           = Block | "=>" Expr ;

IfExpr         = "if" Expr Body [ "else" ( IfExpr | Body ) ] ;
WhileExpr      = "while" Expr Body ;
ForExpr        = "for" ( IDENT | "_" ) "in" Expr Body ;

MatchExpr      = "match" Expr "{" [ MatchArm { "," MatchArm } [ "," ] ] "}" ;
MatchArm       = MatchPattern { "|" MatchPattern } "=>" ( Block | Expr ) ;
MatchPattern   = [ "+" | "-" ] Primary ;

(* Lists & dynamic ranges *)
ListExpr       = "[" [ Expr ( ( "to" | "until" ) Expr [ "by" Expr ]
                            | { "," Expr } ) ] "]" ;

(* Vectors (1 row) & rectangular matrices (2+ rows); cells start at Additive *)
VecMatExpr     = "<" [ VecRow { ";" VecRow } ] ">" ;
VecRow         = Additive { "," Additive } ;

(* Context-driven braces:
   - "{}" is an empty Block (resolved as empty Map/Set in type checker when expected)
   - Statement keyword starter -> Block
   - First Expr followed by ":" -> MapLit
   - First Expr followed by "," or "}" -> SetLit
   - Otherwise -> Block starting with that ExprStmt *)
BraceExpr      = Block | MapLit | SetLit ;
Block          = "{" { Statement } "}" ;
MapLit         = "{" Expr ":" Expr { "," Expr ":" Expr } "}" ;
SetLit         = "{" Expr { "," Expr } "}" ;
```
## Lexical specification
```ebnf
INT_LIT        = DIGIT { DIGIT } ;
FLOAT_LIT      = DIGIT { DIGIT } "." DIGIT { DIGIT } [ EXPONENT ]
               | DIGIT { DIGIT } EXPONENT ;
COMPLEX_LIT    = ( INT_LIT | FLOAT_LIT ) "i" (* not followed by IDENT_PART *) ;
EXPONENT       = ( "e" | "E" ) [ "+" | "-" ] DIGIT { DIGIT } ;

STRING_LIT     = '"' { CHAR | '\"' | '\\' | '\n' | '\r' | '\t' | '\0' | '\' NEWLINE } '"' ;

IDENT          = IDENT_START { IDENT_PART } ;   (* excluding reserved keywords *)
IDENT_START    = [a-zA-Z_] | [\u0370-\u03FF] ;  (* ASCII + Greek block *)
IDENT_PART     = IDENT_START | DIGIT ;

(* Angle brackets "<" and ">" are always emitted as single tokens.
   "///" lines attach as docComment to the next emitted token, but only docComment on classes and function declaration are retained;
   "//" line comments and arbitrarily nested "/* ... */" block comments are skipped. *)
```