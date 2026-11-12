export enum TokenType {
    // Single-character delimiters & punctuation
    LEFT_PAREN = "LEFT_PAREN",       // (
    RIGHT_PAREN = "RIGHT_PAREN",     // )
    LEFT_BRACE = "LEFT_BRACE",       // {
    RIGHT_BRACE = "RIGHT_BRACE",     // }
    LEFT_BRACKET = "LEFT_BRACKET",   // [
    RIGHT_BRACKET = "RIGHT_BRACKET", // ]
    COMMA = "COMMA",                 // ,
    DOT = "DOT",                     // .
    SEMICOLON = "SEMICOLON",         // ;
    COLON = "COLON",                 // :
    QUESTION = "QUESTION",           // ?
    UNDERLINE = "UNDERLINE",         // _

    // Multi-character delimiters & arrows
    AT_BRACKET = "AT_BRACKET",       // @[
    THIN_ARROW = "THIN_ARROW",       // ->
    FAT_ARROW = "FAT_ARROW",         // =>

    // Mathematical & symbolic operators
    PLUS = "PLUS",                   // +
    MINUS = "MINUS",                 // -
    STAR = "STAR",                   // *
    STAR_STAR = "STAR_STAR",         // **
    SLASH = "SLASH",                 // /
    PERCENT = "PERCENT",             // %
    BANG = "BANG",                   // !
    BACKSLASH = "BACKSLASH",         // \

    // Bitwise operators
    AMP = "AMP",                     // &
    PIPE = "PIPE",                   // |
    CARET = "CARET",                 // ^
    TILDE = "TILDE",                 // ~
    LESS_LESS = "LESS_LESS",         // <<
    GREATER_GREATER = "GREATER_GREATER", // >>

    // Comparison & logical operators
    EQUAL = "EQUAL",                 // =
    EQUAL_EQUAL = "EQUAL_EQUAL",     // ==
    BANG_EQUAL = "BANG_EQUAL",       // !=
    TILDE_EQUAL = "TILDE_EQUAL",     // ~=
    LESS = "LESS",                   // <
    LESS_EQUAL = "LESS_EQUAL",       // <=
    GREATER = "GREATER",             // >
    GREATER_EQUAL = "GREATER_EQUAL", // >=
    AMP_AMP = "AMP_AMP",             // &&
    PIPE_PIPE = "PIPE_PIPE",         // ||

    // Word operators
    DIV = "DIV",                     // div
    CROSS = "CROSS",                 // cross
    INTER = "INTER",                 // inter
    UNION = "UNION",                 // union
    IN = "IN",                       // in
    NOT = "NOT",                     // not

    // Declaration & control-flow keywords
    IMPORT = "IMPORT",
    CLASS = "CLASS",
    INHERITS = "INHERITS",
    FUNC = "FUNC",
    LET = "LET",
    CONST = "CONST",
    RETURN = "RETURN",
    BREAK = "BREAK",
    CONTINUE = "CONTINUE",
    IF = "IF",
    ELSE = "ELSE",
    WHILE = "WHILE",
    FOR = "FOR",
    MATCH = "MATCH",
    TRUE = "TRUE",
    FALSE = "FALSE",
    NONE = "NONE",
    THIS = "THIS",

    // Built-in type keywords
    TYPE_BOOLEAN = "TYPE_BOOLEAN",
    TYPE_INT = "TYPE_INT",
    TYPE_BIGINT = "TYPE_BIGINT",
    TYPE_FLOAT = "TYPE_FLOAT",
    TYPE_DOUBLE = "TYPE_DOUBLE",
    TYPE_STRING = "TYPE_STRING",
    TYPE_VECTOR = "TYPE_VECTOR",
    TYPE_MATRIX = "TYPE_MATRIX",
    TYPE_COMPLEX = "TYPE_COMPLEX",
    TYPE_LIST = "TYPE_LIST",
    TYPE_SET = "TYPE_SET",
    TYPE_DEQUE = "TYPE_DEQUE",
    TYPE_HEAP = "TYPE_HEAP",
    TYPE_MAP = "TYPE_MAP",

    // Literals & identifiers
    IDENT = "IDENT",
    INT_LIT = "INT_LIT",
    FLOAT_LIT = "FLOAT_LIT",
    COMPLEX_LIT = "COMPLEX_LIT",
    STRING_LIT = "STRING_LIT",

    EOF = "EOF",
}

export interface Token {
    readonly type: TokenType;
    readonly lexeme: string;
    readonly line: number;
    readonly column: number;
    readonly docComment?: string;
}

export const KEYWORDS: Readonly<Record<string, TokenType>> = {
    // Word operators
    div: TokenType.DIV,
    cross: TokenType.CROSS,
    inter: TokenType.INTER,
    union: TokenType.UNION,
    in: TokenType.IN,
    not: TokenType.NOT,

    // Keywords
    import: TokenType.IMPORT,
    class: TokenType.CLASS,
    inherits: TokenType.INHERITS,
    func: TokenType.FUNC,
    let: TokenType.LET,
    const: TokenType.CONST,
    return: TokenType.RETURN,
    break: TokenType.BREAK,
    continue: TokenType.CONTINUE,
    if: TokenType.IF,
    else: TokenType.ELSE,
    while: TokenType.WHILE,
    for: TokenType.FOR,
    match: TokenType.MATCH,
    true: TokenType.TRUE,
    false: TokenType.FALSE,
    None: TokenType.NONE,
    this: TokenType.THIS,
    _: TokenType.UNDERLINE,

    // Types
    Boolean: TokenType.TYPE_BOOLEAN,
    Int: TokenType.TYPE_INT,
    BigInt: TokenType.TYPE_BIGINT,
    Float: TokenType.TYPE_FLOAT,
    Double: TokenType.TYPE_DOUBLE,
    String: TokenType.TYPE_STRING,
    Vector: TokenType.TYPE_VECTOR,
    Matrix: TokenType.TYPE_MATRIX,
    Complex: TokenType.TYPE_COMPLEX,
    List: TokenType.TYPE_LIST,
    Set: TokenType.TYPE_SET,
    Deque: TokenType.TYPE_DEQUE,
    Heap: TokenType.TYPE_HEAP,
    Map: TokenType.TYPE_MAP,
};