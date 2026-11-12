## Program & top-level declarations
```ebnf
Program        = { Statement } ;

ImportDecl     = "import" STRING ";" ;

ClassDecl      = { DOC_COMMENT } "class" IDENT [ "inherits" IDENT ] "{" { MemberDecl } "}" ;
MemberDecl     = VarDecl | FuncDecl ;

FuncDecl       = { DOC_COMMENT } "func" IDENT [ ParamClause ] [ ":" Type ] Block ;
ParamClause    = "(" [ ParamList ] ")" ;
ParamList      = Param { "," Param } ;
Param          = IDENT ":" Type ;

VarDecl        = ( "let" | "const" ) IDENT [ ":" Type ] "=" Expr ";" ;
```
## Statements & control flow
```ebnf
Statement      = ImportDecl
               | ClassDecl
               | FuncDecl
               | VarDecl
               | IfStmt
               | WhileStmt
               | ForStmt
               | ReturnStmt
               | BreakStmt
               | "continue" ";"
               | ControlFlowExpr
               | AssignOrExprStmt
               | Block ;

Block          = "{" { Statement } [ Expr ] "}" ;

ReturnStmt     = ("return" [ Expr ] ";") | Expr ;
BreakStmt      = "break" [ Expr ] ";" ;
AssignOrExprStmt = Expr [ "=" Expr ] ";" ;
```
## Expressions & operators precedence
```ebnf
Expr           = Ternary ;

Ternary        = LogicOr [ "?" Expr ":" Ternary ] ;
LogicOr        = LogicAnd { "||" LogicAnd } ;
LogicAnd       = LogicNot { "&&" LogicNot } ;
LogicNot       = "!" LogicNot | Comparison ;

Comparison     = BitOr [ CompOp BitOr ] ;
CompOp         = "==" | "!=" | "~=" | "<" | ">" | "<=" | ">=" | "in" ;

BitOr          = BitXor { "|" BitXor } ;
BitXor         = BitAnd { "^" BitAnd } ;
BitAnd         = BitShift { "&" BitShift } ;
BitShift       = Additive { ( "<<" | ">>" ) Additive } ;

Additive       = Multiplicative { ( "+" | "-" | "union" | "\" ) Multiplicative } ;
Multiplicative = Unary { ( "*" | "/" | "div" | "%" | "cross" | "inter" ) Unary } ;

Unary          = ( "-" | "~" ) Unary | Power ;
Power          = Postfix [ "**" Unary ] ;
```
## Postfix, slicing, calls & member access
```ebnf
Postfix        = Primary { PostfixOp } ;
PostfixOp      = "!"                                  (* Factorial *)
               | "(" [ ArgList ] ")"                  (* Function / method call *)
               | "[" IndexOrSlice "]"                 (* Indexing & slicing *)
               | "." IDENT ;                          (* Property or parameterless method *)

ArgList        = Expr { "," Expr } ;

IndexOrSlice   = Expr ":" [ Expr ]                    (* Slice: a[0:5] or a[2:] *)
               | ":" Expr                             (* Slice: a[:5] *)
               | Expr { "," Expr } ;                  (* 1D index a[i] or 2D matrix a[r, c] *)
```
## Primary expressions & literals
```ebnf
Primary        = INT_LIT
               | FLOAT_LIT
               | COMPLEX_LIT
               | STRING
               | "true" | "false" | "None" | "this"
               | IDENT
               | "(" Expr ")"
               | ControlFlowExpr
		       | LambdaExpr
               | ListLit
               | VecMatLit
               | MapOrSetLit ;

ControlFlowExpr = IfExpr 
                | WhileExpr 
				| ForExpr 
				| MatchExpr ;

IfExpr         = "if" Expr Block [ "else" ( IfExpr | Block ) ] ;
WhileExpr      = "while" Expr Block ;
ForExpr        = "for" ( IDENT "in" Expr | "(" IDENT "in" Expr ")" ) Block ;

MatchExpr      = "match" Expr "{" { MatchArm } "}" ;
MatchArm       = Pattern { "|" Pattern } "=>" ( Block [ "," ] | Expr "," ) ;
Pattern        = "_"
               | "None" | "true" | "false"
               | [ "-" ] ( INT_LIT | FLOAT_LIT )
               | STRING
               | IDENT ;

LambdaExpr     = "func" "(" [ ParamList ] ")" [ ":" Type ] Block ;

ListLit        = "[" [ ArgList ] "]" ;

VecMatLit      = "@[" [ Row { ";" Row } ] "]" ;       (* 1 row = vector, 2+ rows = matrix *)
Row            = Expr { "," Expr } ;

MapOrSetLit    = "{" [ CollectionBody ] "}" ;
CollectionBody = Expr ":" Expr { "," Expr ":" Expr }  (* Map: { "a": 1, "b": 2 } *)
               | Expr { "," Expr } ;                  (* Set: { 1, 2, 3 } *)
```
## Type annotation
```ebnf
Type           = BaseType [ "?" ] ;

BaseType       = "None" | "Boolean" | "Int" | "BigInt" | "Float" | "Double"
               | "String" | "Vector" | "Matrix" | "Imaginary"
               | ( "List" | "Set" | "Deque" | "Heap" ) [ "[" Type "]" ]
               | "Map" [ "[" Type "," Type "]" ]
               | "(" [ Type { "," Type } ] ")" "->" Type
               | IDENT ;
```
## Lexical tokens
```ebnf
DOC_COMMENT      = "///" { ANY_CHAR_EXCEPT_NEWLINE } NEWLINE ;
LINE_COMMENT     = "//" { ANY_CHAR_EXCEPT_NEWLINE } NEWLINE ;
BLOCK_COMMENT    = "/*" { ANY_CHAR | BLOCK_COMMENT } "*/" ;

IDENT          = LETTER { LETTER | DIGIT | "_" } ;
INT_LIT        = DIGIT { DIGIT } ;
FLOAT_LIT      = DIGIT { DIGIT } "." DIGIT { DIGIT } [ ( "e" | "E" ) [ "+" | "-" ] DIGIT { DIGIT } ] ;
COMPLEX_LIT    = ( INT_LIT | FLOAT_LIT ) "i" ;
STRING         = '"' { ANY_CHAR_EXCEPT_QUOTE | '\"' } '"' ;
LETTER         = "a".."z" | "A".."Z" | GREEK_UNICODE ;
DIGIT          = "0".."9" ;
```
