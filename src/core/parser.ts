import { Token, TokenType } from "./token.js";
import { Expr, FuncParam, Stmt, TypeNode } from "./ast.js";

enum Precedence {
  LOGIC_OR = 1,
  LOGIC_AND = 2,
  EQUALITY = 3,
  ORDER = 4,
  BITWISE_OR = 5,
  BITWISE_XOR = 6,
  BITWISE_AND = 7,
  SHIFT = 8,
  ADDITIVE = 9,
  MULTIPLICATIVE = 10,
  UNARY = 11,
  IMPLICIT_MUL = 12,
  POWER = 13,
}

interface BinaryOpInfo {
  readonly token: Token;
  readonly tokenCount: 0 | 1 | 2;
  readonly prec: Precedence;
  readonly rightAssoc?: boolean;
}

export class Parser {
  private current = 0;

  constructor(private readonly tokens: readonly Token[]) { }

  // Cursor navigation helpers
  private peek(): Token {
    return this.tokens[this.current];
  }

  private peekNext(): Token {
    return this.tokens[this.current + 1] ?? this.tokens[this.tokens.length - 1];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    const tok = this.peek();
    throw new Error(`Parse error at ${tok.line}:${tok.column} ('${tok.lexeme}'): ${message}`);
  }

  private isAdjacent(first: Token, second: Token): boolean {
    return (
      first.line === second.line &&
      first.column + first.lexeme.length === second.column
    );
  }

  private parseExprWhile<T>(
    parse: () => T,
    separator: TokenType,
    first?: T
  ): T[] {
    const exprs: T[] = first !== undefined ? [first] : [];

    if (first === undefined) {
      exprs.push(parse());
    }

    while (this.match(separator)) {
      exprs.push(parse());
    }
    return exprs;
  }

  public parseProgram(): Stmt[] {
    const stmts: Stmt[] = [];
    while (!this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (
        stmt.kind === "ExprStmt" &&
        !stmt.hasSemicolon &&
        !this.endsWithBlock(stmt.expr) &&
        !this.isAtEnd()
      ) {
        const tok = this.peek();
        throw new Error(`Parse error at ${tok.line}:${tok.column}: Expected ';' after expression.`);
      }
      stmts.push(stmt);
    }
    return stmts;
  }

  private parseStatement(): Stmt {
    if (this.match(TokenType.LET)) {
      return this.parseVarDecl(false);
    }
    if (this.match(TokenType.CONST)) {
      return this.parseVarDecl(true);
    }
    if (this.match(TokenType.IMPORT)) {
      return this.parseImportDecl();
    }
    if (this.match(TokenType.CLASS)) {
      return this.parseClassDecl();
    }
    if (this.match(TokenType.FUNC)) {
      return this.parseFuncDecl();
    }
    if (this.match(TokenType.CONTINUE)) {
      return this.parseContinueStmt();
    }
    if (this.match(TokenType.BREAK)) {
      return this.parseBreakStmt();
    }
    if (this.match(TokenType.RETURN)) {
      return this.parseReturnStmt();
    }
    return this.parseExprStmt();
  }

  private parseImportDecl(): Stmt {
    const path = this.consume(TokenType.STRING_LIT, 'Expected string after import.');
    this.consume(TokenType.SEMICOLON, "Expected ';' after import statement.");
    return { kind: "ImportDecl", path }
  }

  private parseContinueStmt(): Stmt {
    const token = this.previous();
    this.consume(TokenType.SEMICOLON, "Expected ';' after 'continue'.");
    return { kind: "ContinueStmt", token };
  }

  private parseBreakStmt(): Stmt {
    const token = this.previous();
    if (this.match(TokenType.SEMICOLON)) {
      return { kind: "BreakStmt", token };
    }
    const returned = this.parseExpression();
    this.consume(TokenType.SEMICOLON, "Expected ';' after break statement.");
    return { kind: "BreakStmt", returned, token };
  }

  private parseReturnStmt(): Stmt {
    const token = this.previous();
    if (this.match(TokenType.SEMICOLON)) {
      return { kind: "ReturnStmt", token };
    }
    const returned = this.parseExpression();
    this.consume(TokenType.SEMICOLON, "Expected ';' after return statement.");
    return { kind: "ReturnStmt", returned, token };
  }

  private parseClassDecl(): Stmt {
    const docComment = this.previous().docComment;
    const identifier = this.consume(TokenType.IDENT, "Expected identifier after 'class'.");
    let inherits: Token | undefined;
    if (this.match(TokenType.INHERITS)) {
      inherits = this.consume(TokenType.IDENT, "Expected identifier after 'inherits'.");
    }
    this.consume(TokenType.LEFT_BRACE, "Expected '{' after class declaration.");
    if (this.match(TokenType.RIGHT_BRACE)) {
      return { kind: "ClassDecl", identifier, inherits, members: [], docComment };
    }
    let members: Stmt[] = [];
    while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
      if (this.match(TokenType.LET, TokenType.CONST, TokenType.FUNC)) {
        members.push(this.parseMemberDecl());
      } else {
        const tok = this.peek();
        throw new Error(`Parse error at ${tok.line}:${tok.column}: Expected 'let', 'const', or 'func' in class body.`);
      }
    }
    this.consume(TokenType.RIGHT_BRACE, "Expected '}' after class body.");
    return { kind: "ClassDecl", identifier, inherits, members, docComment };
  }

  private parseMemberDecl(): Stmt {
    if (this.previous().type === TokenType.LET) {
      return this.parseVarDecl(false);
    }
    if (this.previous().type === TokenType.CONST) {
      return this.parseVarDecl(true);
    }
    return this.parseFuncDecl();
  }

  private parseFuncDecl(): Stmt {
    const docComment = this.previous().docComment;
    const identifier = this.consume(TokenType.IDENT, "Expected identifier after 'func'.");
    let params: FuncParam[] = [];
    const hasParens = this.match(TokenType.LEFT_PAREN);
    if (hasParens) {
      if (!this.match(TokenType.RIGHT_PAREN)) {
        params = this.parseExprWhile((): FuncParam => {
          const name = this.consume(TokenType.IDENT, "Expected identifier for function parameter name.");
          let typeAnnotation: TypeNode | undefined;
          if (this.match(TokenType.COLON)) {
            typeAnnotation = this.parseType();
          }
          return { name, typeAnnotation }
        }, TokenType.COMMA);
        this.consume(TokenType.RIGHT_PAREN, "Expected ')' after function parameters list.");
      }
    }

    let returnType: TypeNode | undefined;
    if (this.match(TokenType.COLON)) {
      returnType = this.parseType();
    }

    let body;
    if (this.match(TokenType.LEFT_BRACE)) {
      body = this.parseBlock();
    } else {
      this.consume(TokenType.FAT_ARROW, "Expected '{' or '=>' after function declaration.");
      body = this.parseExpression();
      this.consume(TokenType.SEMICOLON, "Expected ';' after function declaration with '=>'.");
    }
    return { kind: "FuncDecl", identifier, hasParens, params, body, returnType, docComment }
  }

  private parseVarDecl(isConst: boolean): Stmt {
    const keyword = isConst ? "const" : "let";
    const name = this.consume(TokenType.IDENT, `Expected identifier after '${keyword}'.`);

    let typeAnnotation: TypeNode | undefined;
    if (this.match(TokenType.COLON)) {
      typeAnnotation = this.parseType();
    }

    this.consume(TokenType.EQUAL, `Expected '=' after variable name in '${keyword}' declaration.`);
    const initializer = this.parseExpression();
    this.consume(TokenType.SEMICOLON, "Expected ';' after variable declaration.");

    return { kind: "VarDecl", isConst, name, typeAnnotation, initializer };
  }

  private matchPrimitiveTypeToken(): boolean {
    return this.match(
      TokenType.TYPE_BIGINT, TokenType.TYPE_INT, TokenType.TYPE_FLOAT,
      TokenType.TYPE_DOUBLE, TokenType.TYPE_COMPLEX, TokenType.TYPE_BOOLEAN,
      TokenType.TYPE_STRING
    );
  }

  private parseType(): TypeNode {
    const base = this.parseBaseType();
    const optional = base.optional || this.match(TokenType.QUESTION);
    return { ...base, optional };
  }

  private parseBaseType(): TypeNode {
    if (this.match(TokenType.LEFT_PAREN)) {
      let params: TypeNode[] = [];
      if (!this.check(TokenType.RIGHT_PAREN)) {
        params = this.parseExprWhile(() => this.parseType(), TokenType.COMMA);
      }
      this.consume(TokenType.RIGHT_PAREN, "Expected ')' after function type parameters.");
      if (params.length === 1 && !this.check(TokenType.THIN_ARROW)) {
        return params[0];
      }
      this.consume(TokenType.THIN_ARROW, "Expected '->' after function type params.");
      const returnType = this.parseType();
      return { kind: "FuncType", params, returnType, optional: false };
    }

    if (this.match(TokenType.TYPE_MAP)) {
      const name = this.previous();
      let typeParams: TypeNode[] = [];
      if (this.match(TokenType.LESS)) {
        const keyType = this.parseType();
        this.consume(TokenType.COMMA, "Expected ',' between Map key and value types.");
        const valueType = this.parseType();
        this.consume(TokenType.GREATER, "Expected '>' after Map type parameters.");
        typeParams = [keyType, valueType];
      }
      return { kind: "NamedType", name, typeParams, optional: false };
    }

    if (this.match(TokenType.TYPE_LIST, TokenType.TYPE_SET, TokenType.TYPE_DEQUE, TokenType.TYPE_HEAP, TokenType.TYPE_VECTOR, TokenType.TYPE_MATRIX)) {
      const name = this.previous();
      let typeParams: TypeNode[] = [];
      if (this.match(TokenType.LESS)) {
        typeParams = [this.parseType()];
        this.consume(TokenType.GREATER, "Expected '>' after type parameter.");
      }
      return { kind: "NamedType", name, typeParams, optional: false };
    }

    if (this.matchPrimitiveTypeToken() || this.match(TokenType.NONE, TokenType.IDENT)) {
      return { kind: "NamedType", name: this.previous(), typeParams: [], optional: false };
    }

    const tok = this.peek();
    throw new Error(`Parse error at ${tok.line}:${tok.column}: Expected a type, got '${tok.lexeme}'.`);
  }

  private isStatementStart(): boolean {
    return (
      this.check(TokenType.LET) ||
      this.check(TokenType.CONST) ||
      this.check(TokenType.FUNC) ||
      this.check(TokenType.CLASS) ||
      this.check(TokenType.IMPORT) ||
      this.check(TokenType.RETURN) ||
      this.check(TokenType.BREAK) ||
      this.check(TokenType.CONTINUE)
    );
  }

  private endsWithBlock(expr: Expr): boolean {
    switch (expr.kind) {
      case "Block":
      case "Match":
        return true;
      case "While":
      case "For":
        return this.endsWithBlock(expr.block);
      case "If":
        return expr.fail
          ? this.endsWithBlock(expr.fail)
          : this.endsWithBlock(expr.success);
      default:
        return false;
    }
  }

  private parseExprStmt(): Stmt {
    const expr = this.parseExpression();
    const hasSemicolon = this.match(TokenType.SEMICOLON);
    return { kind: "ExprStmt", expr, hasSemicolon };
  }

  private parseBlockBody(token: Token, firstStmt?: Stmt): Expr {
    const statements: Stmt[] = [];
    const unreachable: Stmt[] = [];
    let returnExpr: Expr | undefined = undefined;
    let terminated = false;

    const addStatement = (stmt: Stmt) => {
      if (terminated) {
        unreachable.push(stmt);
        return;
      }

      if (
        stmt.kind === "ReturnStmt" ||
        stmt.kind === "BreakStmt" ||
        stmt.kind === "ContinueStmt"
      ) {
        statements.push(stmt);
        terminated = true;
        return;
      }

      if (stmt.kind === "ExprStmt" && !stmt.hasSemicolon && !this.endsWithBlock(stmt.expr)) {
        returnExpr = stmt.expr;
        terminated = true;
        return;
      }

      statements.push(stmt);
    };

    if (firstStmt) {
      addStatement(firstStmt);
    }

    while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
      addStatement(this.parseStatement());
    }

    this.consume(TokenType.RIGHT_BRACE, "Expected '}' after block.");

    if (!terminated && statements.length > 0) {
      const last = statements[statements.length - 1];
      if (last.kind === "ExprStmt" && !last.hasSemicolon) {
        returnExpr = last.expr;
        statements.pop();
      }
    }

    return {
      kind: "Block",
      statements,
      ...(returnExpr !== undefined ? { returnExpr } : {}),
      ...(unreachable.length > 0 ? { unreachable } : {}),
      token,
    };
  }

  private parseBlock(): Expr {
    const token = this.previous();
    return this.parseBlockBody(token);
  }

  public parseExpression(): Expr {
    return this.parseAssignment();
  }

  private parseAssignment(): Expr {
    let expr = this.parseTernary();

    if (this.match(TokenType.EQUAL)) {
      const token = this.previous();
      const value = this.parseAssignment();

      if (
        expr.kind === "Identifier" ||
        expr.kind === "MemberAccess" ||
        expr.kind === "Index"
      ) {
        return { kind: "Assign", target: expr, value, token };
      }

      throw new Error(
        `Parse error at ${token.line}:${token.column}: Invalid assignment target.`
      );
    }

    return expr;
  }

  private parseTernary(): Expr {
    let expr = this.parsePrecedence(Precedence.LOGIC_OR);

    if (this.match(TokenType.QUESTION)) {
      const token = this.previous();
      const success = this.parseExpression();
      this.consume(TokenType.COLON, "Expected ':' after expression.");
      expr = { kind: "If", condition: expr, success, fail: this.parseAssignment(), token };
    }

    return expr;
  }

  private peekBinaryOp(left: Expr): BinaryOpInfo | undefined {
    const first = this.peek();
    const second = this.peekNext();

    // Handle <, <=, <<
    if (first.type === TokenType.LESS) {
      if (second.type === TokenType.EQUAL && this.isAdjacent(first, second)) {
        return {
          token: { ...first, type: TokenType.LESS_EQUAL, lexeme: "<=" },
          tokenCount: 2,
          prec: Precedence.ORDER,
        };
      }
      if (second.type === TokenType.LESS && this.isAdjacent(first, second)) {
        return {
          token: { ...first, type: TokenType.LESS_LESS, lexeme: "<<" },
          tokenCount: 2,
          prec: Precedence.SHIFT,
        };
      }
      return { token: first, tokenCount: 1, prec: Precedence.ORDER };
    }

    // Handle >, >=, >>
    if (first.type === TokenType.GREATER) {
      if (second.type === TokenType.EQUAL && this.isAdjacent(first, second)) {
        return {
          token: { ...first, type: TokenType.GREATER_EQUAL, lexeme: ">=" },
          tokenCount: 2,
          prec: Precedence.ORDER,
        };
      }
      if (second.type === TokenType.GREATER && this.isAdjacent(first, second)) {
        return {
          token: { ...first, type: TokenType.GREATER_GREATER, lexeme: ">>" },
          tokenCount: 2,
          prec: Precedence.SHIFT,
        };
      }
      return { token: first, tokenCount: 1, prec: Precedence.ORDER };
    }

    // Implicit multiplication: 3b, 4i2, 2π, 2(x + 1)
    if (
      (left.kind === "IntLit" || left.kind === "FloatLit" || left.kind === "ComplexLit") &&
      (first.type === TokenType.IDENT || first.type === TokenType.LEFT_PAREN) &&
      this.isAdjacent(left.token, first)
    ) {
      return {
        token: { ...first, type: TokenType.STAR, lexeme: "*" },
        tokenCount: 0,
        prec: Precedence.IMPLICIT_MUL,
      };
    }

    switch (first.type) {
      case TokenType.PIPE_PIPE:
        return { token: first, tokenCount: 1, prec: Precedence.LOGIC_OR };
      case TokenType.AMP_AMP:
        return { token: first, tokenCount: 1, prec: Precedence.LOGIC_AND };
      case TokenType.EQUAL_EQUAL:
      case TokenType.BANG_EQUAL:
      case TokenType.TILDE_EQUAL:
        return { token: first, tokenCount: 1, prec: Precedence.EQUALITY };
      case TokenType.IN:
        return { token: first, tokenCount: 1, prec: Precedence.ORDER };
      case TokenType.PIPE:
        return { token: first, tokenCount: 1, prec: Precedence.BITWISE_OR };
      case TokenType.CARET:
        return { token: first, tokenCount: 1, prec: Precedence.BITWISE_XOR };
      case TokenType.AMP:
        return { token: first, tokenCount: 1, prec: Precedence.BITWISE_AND };
      case TokenType.PLUS:
      case TokenType.MINUS:
      case TokenType.UNION:
      case TokenType.BACKSLASH:
        return { token: first, tokenCount: 1, prec: Precedence.ADDITIVE };
      case TokenType.STAR:
      case TokenType.SLASH:
      case TokenType.DIV:
      case TokenType.PERCENT:
      case TokenType.CROSS:
      case TokenType.INTER:
        return { token: first, tokenCount: 1, prec: Precedence.MULTIPLICATIVE };
      case TokenType.STAR_STAR:
        return { token: first, tokenCount: 1, prec: Precedence.POWER, rightAssoc: true };
      default:
        return undefined;
    }
  }

  private parsePrecedence(minPrec: Precedence): Expr {
    let left = this.parsePrefix();

    while (true) {
      const op = this.peekBinaryOp(left);
      if (!op || op.prec < minPrec) break;

      if (op.tokenCount >= 1) this.advance();
      if (op.tokenCount === 2) this.advance();

      const nextMinPrec = op.rightAssoc ? Precedence.UNARY : op.prec + 1;
      const right = this.parsePrecedence(nextMinPrec);

      left = { kind: "Binary", left, operator: op.token, right };
    }

    return left;
  }

  private parsePrefix(): Expr {
    if (this.match(TokenType.PLUS, TokenType.MINUS, TokenType.BANG, TokenType.TILDE)) {
      const operator = this.previous();
      return { kind: "Unary", operator, operand: this.parsePrecedence(Precedence.UNARY) };
    }

    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match(TokenType.BANG)) {
        expr = { kind: "PostfixUnary", operator: this.previous(), operand: expr };

      } else if (this.match(TokenType.DOT)) {
        const name = this.consume(TokenType.IDENT, "Expected property or method name after '.'.");
        expr = { kind: "MemberAccess", object: expr, name };

      } else if (
        expr.kind !== "IntLit" &&
        expr.kind !== "FloatLit" &&
        expr.kind !== "ComplexLit" &&
        this.match(TokenType.LEFT_PAREN)
      ) {
        const token = this.previous();
        let params: Expr[] = [];
        if (!this.check(TokenType.RIGHT_PAREN)) {
          params = this.parseExprWhile(() => this.parseExpression(), TokenType.COMMA);
        }
        this.consume(TokenType.RIGHT_PAREN, "Expected ')' after arguments.");
        expr = { kind: "FunctionCall", object: expr, args: params, token };

      } else if (this.match(TokenType.LEFT_BRACKET)) {
        const token = this.previous();
        if (this.match(TokenType.COLON)) {
          const end = this.check(TokenType.RIGHT_BRACKET)
            ? undefined
            : this.parseExpression();
          this.consume(TokenType.RIGHT_BRACKET, "Expected ']' after slice.");
          expr = { kind: "Slicing", object: expr, end, token };
        } else {
          const first = this.parseExpression();
          if (this.match(TokenType.COLON)) {
            const end = this.check(TokenType.RIGHT_BRACKET)
              ? undefined
              : this.parseExpression();
            this.consume(TokenType.RIGHT_BRACKET, "Expected ']' after slice.");
            expr = { kind: "Slicing", object: expr, start: first, end, token };
          } else {
            const indexes = this.parseExprWhile(() => this.parseExpression(), TokenType.COMMA, first);
            this.consume(TokenType.RIGHT_BRACKET, "Expected ']' after index.");
            expr = { kind: "Index", object: expr, indexes, token };
          }
        }
      } else {
        break;
      }
    }

    return expr;
  }

  private parseMapEntries(): { readonly key: Expr; readonly value: Expr } {
    const key = this.parseExpression();
    this.consume(TokenType.COLON, "Expected ':' after map key.");
    const value = this.parseExpression();
    return { key, value };
  }

  private parseVecRows(): Expr[] {
    return this.parseExprWhile(
      () => this.parsePrecedence(Precedence.ADDITIVE),
      TokenType.COMMA
    );
  }

  private parseIfExpr(): Expr {
    const token = this.previous();
    const condition = this.parseExpression();

    let success: Expr;
    if (this.match(TokenType.LEFT_BRACE)) {
      success = this.parseBlock();
    } else {
      this.consume(TokenType.FAT_ARROW, "Expected '{' or '=>' after if condition.");
      success = this.parseExpression();
    }

    let fail: Expr | undefined;
    if (this.match(TokenType.ELSE)) {
      if (this.match(TokenType.IF)) {
        fail = this.parseIfExpr();
      } else if (this.match(TokenType.LEFT_BRACE)) {
        fail = this.parseBlock();
      } else {
        this.consume(TokenType.FAT_ARROW, "Expected '{', 'if', or '=>' after 'else'.");
        fail = this.parseExpression();
      }
    }

    return { kind: "If", condition, success, fail, token };
  }

  private parseMatchPattern(): Expr {
    if (this.match(TokenType.MINUS, TokenType.PLUS)) {
      const operator = this.previous();
      return { kind: "Unary", operator, operand: this.parsePrimary() };
    }
    return this.parsePrimary();
  }

  private parseMatchArm(): { patterns: Expr[]; success: Expr } {
    const patterns = this.parseExprWhile(() => this.parseMatchPattern(), TokenType.PIPE);
    this.consume(TokenType.FAT_ARROW, "Expected '=>' after pattern.");
    const success = this.match(TokenType.LEFT_BRACE)
      ? this.parseBlock()
      : this.parseExpression();
    return { patterns, success };
  }

  private decodeStringLiteral(token: Token): string {
    const raw = token.lexeme.slice(1, -1);
    let out = "";

    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== "\\") {
        out += raw[i];
        continue;
      }

      i++;
      const esc = raw[i];
      switch (esc) {
        case "\"": out += "\""; break;
        case "\\": out += "\\"; break;
        case "n": out += "\n"; break;
        case "r": out += "\r"; break;
        case "t": out += "\t"; break;
        case "0": out += "\0"; break;
        case "\n": break;
        case "\r":
          if (raw[i + 1] === "\n") i++;
          break;
        default:
          throw new Error(
            `Parse error at ${token.line}:${token.column}: Invalid escape sequence '\\${esc}'.`
          );
      }
    }

    return out;
  }

  private parsePrimary(): Expr {
    if (this.match(TokenType.INT_LIT)) {
      const token = this.previous();
      return { kind: "IntLit", value: BigInt(token.lexeme), token };
    }

    if (this.match(TokenType.FLOAT_LIT)) {
      const token = this.previous();
      return { kind: "FloatLit", value: Number(token.lexeme), token };
    }

    if (this.match(TokenType.COMPLEX_LIT)) {
      const token = this.previous();
      const imaginary = token.lexeme.slice(0, -1);
      return { kind: "ComplexLit", real: 0, imaginary: Number(imaginary), token };
    }

    if (this.match(TokenType.STRING_LIT)) {
      const token = this.previous();
      return { kind: "StringLit", value: this.decodeStringLiteral(token), token };
    }

    if (this.match(TokenType.TRUE) || this.match(TokenType.FALSE)) {
      const token = this.previous();
      return { kind: "BooleanLit", value: token.type === TokenType.TRUE, token };
    }

    if (this.match(TokenType.NONE)) {
      const token = this.previous();
      return { kind: "NoneLit", token };
    }

    if (this.match(
      TokenType.TYPE_LIST,
      TokenType.TYPE_SET,
      TokenType.TYPE_MAP,
      TokenType.TYPE_DEQUE,
      TokenType.TYPE_HEAP
    )) {
      const token = this.previous();
      if (!this.check(TokenType.LEFT_PAREN)) {
        throw new Error(
          `Parse error at ${token.line}:${token.column}: Expected '(' after collection constructor '${token.lexeme}'.`
        );
      }
      return { kind: "Identifier", name: token.lexeme, token };
    }

    if (this.match(TokenType.IDENT)) {
      const token = this.previous();
      return { kind: "Identifier", name: token.lexeme, token };
    }

    if (this.match(TokenType.UNDERLINE)) {
      const token = this.previous();
      return { kind: "Wildcard", token };
    }

    if (this.match(TokenType.THIS)) {
      const token = this.previous();
      return { kind: "ThisExpr", token };
    }

    if (this.match(TokenType.LEFT_PAREN)) {
      const expr = this.parseExpression();
      this.consume(TokenType.RIGHT_PAREN, "Expected ')' after expression.");
      return { kind: "Grouping", expr };
    }

    if (this.match(TokenType.IF)) {
      return this.parseIfExpr();
    }

    if (this.match(TokenType.WHILE)) {
      const token = this.previous();
      const condition = this.parseExpression();
      let block: Expr;
      if (this.match(TokenType.LEFT_BRACE)) {
        block = this.parseBlock()
      } else {
        this.consume(TokenType.FAT_ARROW, "Expected '{' or '=>' after while loop condition.");
        block = this.parseExpression();
      };
      return { kind: "While", condition, block, token };
    }

    if (this.match(TokenType.FOR)) {
      const token = this.previous();
      if (!this.match(TokenType.IDENT, TokenType.UNDERLINE)) {
        const tok = this.peek();
        throw new Error(`Parse error at ${tok.line}:${tok.column}: Expected identifier or '_' after 'for'.`);
      }
      const identifier = this.previous();

      this.consume(TokenType.IN, "Expected 'in' after identifier in for expression.");
      const expr = this.parseExpression();
      let block: Expr;
      if (this.match(TokenType.LEFT_BRACE)) {
        block = this.parseBlock()
      } else {
        this.consume(TokenType.FAT_ARROW, "Expected '{' or '=>' after for loop condition.");
        block = this.parseExpression();
      };
      return { kind: "For", identifier, expr, block, token };
    }

    if (this.match(TokenType.MATCH)) {
      const token = this.previous();
      const expr = this.parseExpression();
      this.consume(TokenType.LEFT_BRACE, "Expected '{' for match.");
      const arms: { readonly patterns: readonly Expr[]; readonly success: Expr }[] = [];
      while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
        arms.push(this.parseMatchArm());
        if (!this.match(TokenType.COMMA)) break;
      }
      this.consume(TokenType.RIGHT_BRACE, "Expected '}' after match body.");
      return { kind: "Match", expr, arms, token };
    }

    if (this.match(TokenType.LEFT_BRACKET)) {
      const token = this.previous();
      let elements: Expr[] = [];
      if (!this.match(TokenType.RIGHT_BRACKET)) {
        const first = this.parseExpression();
        if (this.match(TokenType.TO, TokenType.UNTIL)) {
          const inclusive = this.previous().type === TokenType.TO;
          const last = this.parseExpression();
          const step = this.match(TokenType.BY) ? this.parseExpression() : undefined;
          this.consume(TokenType.RIGHT_BRACKET, "Expected ']' after list.");
          return { kind: "ListDynamicLit", start: first, end: last, inclusive, step, token };
        } else {
          elements = this.parseExprWhile(() => this.parseExpression(), TokenType.COMMA, first);
        }
        this.consume(TokenType.RIGHT_BRACKET, "Expected ']' after list.");
      }
      return { kind: "ListLit", elements, token };
    }

    if (this.match(TokenType.LESS)) {
      const token = this.previous();
      if (this.match(TokenType.GREATER)) {
        return { kind: "VectorLit", elements: [], token };
      }

      const rows = this.parseExprWhile(() => this.parseVecRows(), TokenType.SEMICOLON);
      this.consume(TokenType.GREATER, "Expected '>' after vector or matrix literal.");

      if (rows.length === 1) {
        return { kind: "VectorLit", elements: rows[0], token };
      }

      const nbRows = rows.length;
      const nbCols = rows[0].length;

      for (let r = 1; r < nbRows; r++) {
        if (rows[r].length !== nbCols) {
          throw new Error(
            `Parse error at ${token.line}:${token.column}: Matrix row ${r + 1} has ${rows[r].length} columns, expected ${nbCols}.`
          );
        }
      }

      return {
        kind: "MatrixLit",
        cells: rows.flat(),
        nbRows,
        nbCols,
        token,
      };
    }

    if (this.match(TokenType.LEFT_BRACE)) {
      const token = this.previous();

      if (this.match(TokenType.RIGHT_BRACE)) {
        return { kind: "Block", statements: [], token };
      }

      if (this.isStatementStart()) {
        return this.parseBlockBody(token);
      }

      const first = this.parseExpression();

      if (this.match(TokenType.COLON)) {
        const firstValue = this.parseExpression();
        const entries = [{ key: first, value: firstValue }];

        while (this.match(TokenType.COMMA)) {
          entries.push(this.parseMapEntries());
        }

        this.consume(TokenType.RIGHT_BRACE, "Expected '}' after map.");
        return { kind: "MapLit", entries, token };

      } else if (this.check(TokenType.COMMA) || this.check(TokenType.RIGHT_BRACE)) {
        const elements = [first];

        while (this.match(TokenType.COMMA)) {
          elements.push(this.parseExpression());
        }

        this.consume(TokenType.RIGHT_BRACE, "Expected '}' after set.");
        return { kind: "SetLit", elements, token };

      } else {
        const hasSemicolon = this.match(TokenType.SEMICOLON);
        const firstStmt: Stmt = { kind: "ExprStmt", expr: first, hasSemicolon };
        return this.parseBlockBody(token, firstStmt);
      }
    }

    const tok = this.peek();
    throw new Error(`Unexpected token '${tok.lexeme}' at ${tok.line}:${tok.column}`);
  }
}
