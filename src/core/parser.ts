import { Token, TokenType } from "./token";
import { Expr, Stmt } from "./ast";

export class Parser {
  private current = 0;

  constructor(private readonly tokens: readonly Token[]) { }

  // Cursor nagivation helpers

  private peek(): Token {
    return this.tokens[this.current];
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
    const tok = this.peek()
    throw new Error(`Parse error at ${tok.line}:${tok.column} ('${tok.lexeme}'): ${message}`);
  }

  private parseBinaryLeft(
    nextHigher: () => Expr,
    ...operators: TokenType[]
  ): Expr {
    let expr = nextHigher();

    while (this.match(...operators)) {
      const operator = this.previous();
      const right = nextHigher();
      expr = { kind: "Binary", left: expr, operator, right };
    }

    return expr;
  }

  private parseExprWhile<T>(
    parse: () => T,
    separator: TokenType,
    first?: T
  ): T[] {
    let exprs: T[] = first !== undefined ? [first] : [];

    if (first === undefined) {
      exprs.push(parse());
    }

    while (this.match(separator)) { exprs.push(parse()); }
    return exprs;
  }

  public parseExpression(): Expr {
    return this.parseTernary();
  }

  // Grammar rules
  private parseTernary(): Expr {
    let expr = this.parseLogicOr();

    if (this.match(TokenType.QUESTION)) {
      const tempExpr = this.parseExpression();
      this.consume(TokenType.COLON, "Expected ':' after expression.");
      expr = { kind: "If", condition: expr, success: tempExpr, fail: this.parseTernary() };
    }

    return expr;
  }

  private parseLogicOr(): Expr {
    return this.parseBinaryLeft(
      () => this.parseLogicAnd(),
      TokenType.PIPE_PIPE
    )
  }

  private parseLogicAnd(): Expr {
    return this.parseBinaryLeft(
      () => this.parseLogicNot(),
      TokenType.AMP_AMP
    )
  }

  private parseLogicNot(): Expr {
    if (this.match(TokenType.BANG)) {
      return { kind: "Unary", operator: this.previous(), operand: this.parseLogicNot() };
    }
    return this.parseComparisonEqual();
  }

  private parseComparisonEqual(): Expr {
    return this.parseBinaryLeft(
      () => this.parseComparisonOrder(),
      TokenType.EQUAL_EQUAL, TokenType.BANG_EQUAL, TokenType.TILDE_EQUAL
    );
  }

  private parseComparisonOrder(): Expr {
    return this.parseBinaryLeft(
      () => this.parseBitwiseOr(),
      TokenType.LESS, TokenType.GREATER, TokenType.LESS_EQUAL, TokenType.GREATER_EQUAL, TokenType.IN
    );
  }

  private parseBitwiseOr(): Expr {
    return this.parseBinaryLeft(() => this.parseBitwiseXor(), TokenType.PIPE);
  }

  private parseBitwiseXor(): Expr {
    return this.parseBinaryLeft(() => this.parseBitwiseAnd(), TokenType.CARET);
  }

  private parseBitwiseAnd(): Expr {
    return this.parseBinaryLeft(() => this.parseShift(), TokenType.AMP);
  }

  private parseShift(): Expr {
    return this.parseBinaryLeft(
      () => this.parseAdditive(),
      TokenType.LESS_LESS, TokenType.GREATER_GREATER
    );
  }

  private parseAdditive(): Expr {
    return this.parseBinaryLeft(
      () => this.parseMultiplicative(),
      TokenType.PLUS, TokenType.MINUS, TokenType.UNION, TokenType.BACKSLASH
    );
  }

  private parseMultiplicative(): Expr {
    return this.parseBinaryLeft(
      () => this.parseUnary(),
      TokenType.STAR, TokenType.SLASH, TokenType.DIV, TokenType.PERCENT, TokenType.CROSS, TokenType.INTER
    )
  }

  private parseUnary(): Expr {
    if (this.match(TokenType.PLUS, TokenType.MINUS, TokenType.TILDE)) {
      const operator = this.previous();
      return { kind: "Unary", operator, operand: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): Expr {
    let expr = this.parsePostfix();

    if (this.match(TokenType.STAR_STAR)) {
      expr = { kind: "Binary", left: expr, operator: this.previous(), right: this.parseUnary() };
    }

    return expr;
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match(TokenType.BANG)) {
        expr = { kind: "PostfixUnary", operator: this.previous(), operand: expr };

      } else if (this.match(TokenType.DOT)) {
        const name = this.consume(TokenType.IDENT, "Expected property or method name after '.'.");
        expr = { kind: "MemberAccess", object: expr, name };

      } else if (this.match(TokenType.LEFT_PAREN)) {
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
            this.consume(TokenType.RIGHT_BRACKET, "Expected ']' after slice.");
            expr = { kind: "Index", object: expr, indexes, token };
          }
        }
      } else {
        break;
      }
    }

    return expr;
  }

  private parseMapEntries(): { readonly key: Expr, readonly value: Expr } {
    const key = this.parseExpression();
    this.consume(TokenType.COLON, "Expected ':' after map key.");
    const value = this.parseExpression();
    return { key, value };
  }

  private parseVecRows(): Expr[] {
    return this.parseExprWhile(
      () => this.parseExpression(),
      TokenType.COMMA
    );
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
      return { kind: "ComplexLit", real: Number("0"), imaginary: Number(imaginary), token }
    }

    if (this.match(TokenType.STRING_LIT)) {
      const token = this.previous();
      return { kind: "StringLit", value: token.lexeme.slice(1, -1), token }
    }

    if (this.match(TokenType.TRUE) || this.match(TokenType.FALSE)) {
      const token = this.previous();
      return { kind: "BooleanLit", value: token.type === TokenType.TRUE, token }
    }

    if (this.match(TokenType.NONE)) {
      const token = this.previous();
      return { kind: "NoneLit", token }
    }

    if (this.match(TokenType.IDENT)) {
      const token = this.previous();
      return { kind: "Identifier", name: token.lexeme, token }
    }

    if (this.match(TokenType.LEFT_PAREN)) {
      const expr = this.parseExpression();
      this.consume(TokenType.RIGHT_PAREN, "Expected ')' after expression.");
      return { kind: "Grouping", expr };
    }

    if (this.match(TokenType.LEFT_BRACKET)) {
      const token = this.previous();
      const elements = this.check(TokenType.RIGHT_BRACKET)
        ? []
        : this.parseExprWhile(() => this.parseExpression(), TokenType.COMMA);
      this.consume(TokenType.RIGHT_BRACKET, "Expected ']' after list.");
      return { kind: "ListLit", elements, token };
    }

    if (this.match(TokenType.AT_BRACKET)) {
      const token = this.previous();
      if (this.match(TokenType.RIGHT_BRACKET)) {
        return { kind: "VectorLit", elements: [], token };
      }

      const rows = this.parseExprWhile(() => this.parseVecRows(), TokenType.SEMICOLON);
      this.consume(TokenType.RIGHT_BRACKET, "Expected ']' after vector or matrix literal.");

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
        token
      };
    }

    if (this.match(TokenType.LEFT_BRACE)) {
      const token = this.previous();

      if (this.match(TokenType.RIGHT_BRACE)) {
        return { kind: "Block", statements: [], returnExpr: undefined, token }
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
      } else {
        const elements = [first];

        while (this.match(TokenType.COMMA)) {
          elements.push(this.parseExpression());
        }

        this.consume(TokenType.RIGHT_BRACE, "Expected '}' after set.");
        return { kind: "SetLit", elements, token };
      }
    }

    const tok = this.peek();
    throw new Error(`Unexpected token '${tok.lexeme}' at ${tok.line}:${tok.column}`);
  }
}
