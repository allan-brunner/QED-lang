import { Expr, Stmt, TypeNode } from "../core/ast.js";
import { Token, TokenType } from "../core/token.js";
import { Chunk, NO_LOC, NumericTag, OpCode, SourceLoc } from "../vm/bytecode.js";
import { FunctionProto, V } from "../vm/value.js";

function locOf(token?: Token): SourceLoc {
  return token ? { line: token.line, column: token.column } : NO_LOC;
}

export class Compiler {
  private readonly chunk = new Chunk();

  public compileProgram(stmts: readonly Stmt[], returnLastExpr = false): FunctionProto {
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];
      const isLast = i === stmts.length - 1;

      if (returnLastExpr && isLast && stmt.kind === "ExprStmt") {
        this.compileExpr(stmt.expr);
        this.chunk.emitOp(OpCode.RETURN, NO_LOC);
        return {
          name: "<repl>",
          arity: 0,
          hasParens: true,
          chunk: this.chunk,
          upvalues: [],
        };
      }

      this.compileStmt(stmt);
    }

    this.chunk.emitOp(OpCode.VOID, NO_LOC);
    this.chunk.emitOp(OpCode.RETURN, NO_LOC);

    return {
      name: returnLastExpr ? "<repl>" : "<script>",
      arity: 0,
      hasParens: true,
      chunk: this.chunk,
      upvalues: [],
    };
  }

  public compileStmt(stmt: Stmt): void {
    switch (stmt.kind) {
      case "ImportDecl": {
        const path = stmt.path.lexeme.slice(1, -1);
        const nameIdx = this.chunk.addConstant(V.str(path));
        this.chunk.emitOpU16(OpCode.IMPORT_BUILTIN, nameIdx, locOf(stmt.path));
        return;
      }

      case "VarDecl": {
        const loc = locOf(stmt.name);
        this.compileExpr(stmt.initializer);
        this.emitNumericCastIfNeeded(stmt.typeAnnotation, loc);
        const nameIdx = this.chunk.addConstant(V.str(stmt.name.lexeme));
        this.chunk.emitOpU16(OpCode.DEFINE_GLOBAL, nameIdx, loc);
        return;
      }

      case "ExprStmt": {
        this.compileExpr(stmt.expr);
        this.chunk.emitOp(OpCode.POP, NO_LOC);
        return;
      }

      default:
        throw new Error(`Statement '${stmt.kind}' is not implemented yet.`);
    }
  }

  private emitNumericCastIfNeeded(typeNode: TypeNode | undefined, loc: SourceLoc): void {
    if (!typeNode || typeNode.kind !== "NamedType") return;
    switch (typeNode.name.type) {
      case TokenType.TYPE_BIGINT:
        this.chunk.emitOpU8(OpCode.CAST_NUM, NumericTag.BigInt, loc);
        break;
      case TokenType.TYPE_FLOAT:
        this.chunk.emitOpU8(OpCode.CAST_NUM, NumericTag.Float, loc);
        break;
      case TokenType.TYPE_DOUBLE:
        this.chunk.emitOpU8(OpCode.CAST_NUM, NumericTag.Double, loc);
        break;
      case TokenType.TYPE_COMPLEX:
        this.chunk.emitOpU8(OpCode.CAST_NUM, NumericTag.Complex, loc);
        break;
    }
  }

  private compileExpr(expr: Expr): void {
    switch (expr.kind) {
      case "IntLit":
        this.chunk.emitConstant(V.int(Number(expr.value)), locOf(expr.token));
        return;

      case "FloatLit":
        this.chunk.emitConstant(V.float(expr.value), locOf(expr.token));
        return;

      case "ComplexLit":
        this.chunk.emitConstant(V.complex(expr.real, expr.imaginary), locOf(expr.token));
        return;

      case "StringLit":
        this.chunk.emitConstant(V.str(expr.value), locOf(expr.token));
        return;

      case "BooleanLit":
        this.chunk.emitOp(expr.value ? OpCode.TRUE : OpCode.FALSE, locOf(expr.token));
        return;

      case "NoneLit":
        this.chunk.emitOp(OpCode.NONE, locOf(expr.token));
        return;

      case "Grouping":
        this.compileExpr(expr.expr);
        return;

      case "Identifier": {
        const nameIdx = this.chunk.addConstant(V.str(expr.name));
        this.chunk.emitOpU16(OpCode.GET_GLOBAL, nameIdx, locOf(expr.token));
        return;
      }

      case "Assign": {
        if (expr.target.kind !== "Identifier") {
          throw new Error(`Compiler Slice 1: assignment target '${expr.target.kind}' not implemented yet.`);
        }
        this.compileExpr(expr.value);
        const nameIdx = this.chunk.addConstant(V.str(expr.target.name));
        this.chunk.emitOpU16(OpCode.SET_GLOBAL, nameIdx, locOf(expr.token));
        return;
      }

      case "Unary": {
        this.compileExpr(expr.operand);
        const loc = locOf(expr.operator);
        switch (expr.operator.type) {
          case TokenType.MINUS: this.chunk.emitOp(OpCode.NEG, loc); return;
          case TokenType.PLUS: this.chunk.emitOp(OpCode.POS, loc); return;
          case TokenType.BANG: this.chunk.emitOp(OpCode.NOT, loc); return;
          case TokenType.TILDE: this.chunk.emitOp(OpCode.BIT_NOT, loc); return;
          default:
            throw new Error(`Unhandled unary operator '${expr.operator.lexeme}'.`);
        }
      }

      case "PostfixUnary": {
        this.compileExpr(expr.operand);
        if (expr.operator.type === TokenType.BANG) {
          this.chunk.emitOp(OpCode.FACTORIAL, locOf(expr.operator));
          return;
        }
        throw new Error(`Unhandled postfix operator '${expr.operator.lexeme}'.`);
      }

      case "Binary": {
        const loc = locOf(expr.operator);

        if (expr.operator.type === TokenType.AMP_AMP) {
          this.compileExpr(expr.left);
          this.chunk.emitOp(OpCode.DUP, loc);
          const endJump = this.chunk.emitJump(OpCode.JUMP_IF_FALSE, loc);
          this.chunk.emitOp(OpCode.POP, loc);
          this.compileExpr(expr.right);
          this.chunk.patchJump(endJump);
          return;
        }

        if (expr.operator.type === TokenType.PIPE_PIPE) {
          this.compileExpr(expr.left);
          this.chunk.emitOp(OpCode.DUP, loc);
          const endJump = this.chunk.emitJump(OpCode.JUMP_IF_TRUE, loc);
          this.chunk.emitOp(OpCode.POP, loc);
          this.compileExpr(expr.right);
          this.chunk.patchJump(endJump);
          return;
        }

        this.compileExpr(expr.left);
        this.compileExpr(expr.right);
        this.emitBinaryOp(expr.operator);
        return;
      }

      case "MemberAccess": {
        this.compileExpr(expr.object);
        const nameIdx = this.chunk.addConstant(V.str(expr.name.lexeme));
        this.chunk.emitOpU16(OpCode.GET_PROP, nameIdx, locOf(expr.name));
        return;
      }

      case "FunctionCall": {
        this.compileExpr(expr.object);
        for (const arg of expr.args) {
          this.compileExpr(arg);
        }
        this.chunk.emitOpU8(OpCode.CALL, expr.args.length, locOf(expr.token));
        return;
      }

      default:
        throw new Error(`Compiler Slice 1: expression '${expr.kind}' is not implemented yet.`);
    }
  }

  private emitBinaryOp(op: Token): void {
    const loc = locOf(op);
    switch (op.type) {
      case TokenType.PLUS: this.chunk.emitOp(OpCode.ADD, loc); return;
      case TokenType.MINUS: this.chunk.emitOp(OpCode.SUB, loc); return;
      case TokenType.STAR: this.chunk.emitOp(OpCode.MUL, loc); return;
      case TokenType.SLASH: this.chunk.emitOp(OpCode.DIV, loc); return;
      case TokenType.DIV: this.chunk.emitOp(OpCode.INT_DIV, loc); return;
      case TokenType.PERCENT: this.chunk.emitOp(OpCode.MOD, loc); return;
      case TokenType.STAR_STAR: this.chunk.emitOp(OpCode.POW, loc); return;
      case TokenType.AMP: this.chunk.emitOp(OpCode.BIT_AND, loc); return;
      case TokenType.PIPE: this.chunk.emitOp(OpCode.BIT_OR, loc); return;
      case TokenType.CARET: this.chunk.emitOp(OpCode.BIT_XOR, loc); return;
      case TokenType.LESS_LESS: this.chunk.emitOp(OpCode.SHL, loc); return;
      case TokenType.GREATER_GREATER: this.chunk.emitOp(OpCode.SHR, loc); return;
      case TokenType.EQUAL_EQUAL: this.chunk.emitOp(OpCode.EQ, loc); return;
      case TokenType.BANG_EQUAL: this.chunk.emitOp(OpCode.NEQ, loc); return;
      case TokenType.TILDE_EQUAL: this.chunk.emitOp(OpCode.APPROX_EQ, loc); return;
      case TokenType.LESS: this.chunk.emitOp(OpCode.LT, loc); return;
      case TokenType.LESS_EQUAL: this.chunk.emitOp(OpCode.LE, loc); return;
      case TokenType.GREATER: this.chunk.emitOp(OpCode.GT, loc); return;
      case TokenType.GREATER_EQUAL: this.chunk.emitOp(OpCode.GE, loc); return;
      default:
        throw new Error(`Operator '${op.lexeme}' is not implemented yet.`);
    }
  }
}
