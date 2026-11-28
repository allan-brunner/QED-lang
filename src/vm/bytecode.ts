import type { QValue } from "./value.js";

export interface SourceLoc {
  readonly line: number,
  readonly column: number;
}

export const NO_LOC: SourceLoc = { line: 1, column: 1 }

export enum NumericTag {
  Int = 0,
  BigInt = 1,
  Float = 2,
  Double = 3,
  Complex = 4,
}

export enum OpCode {
  // Constants and stack
  CONST = 0,          // [u16 constIdx]        push constants[constIdx]
  NONE,               // []                    push None
  VOID,               // []                    push Void
  TRUE,               // []                    push true
  FALSE,              // []                    push false
  POP,                // []                    discard top of stack
  DUP,                // []                    duplicate top of stack

  // Variabls and scopes
  GET_LOCAL,          // [u16 slot]            push stack[frame.base + slot]
  SET_LOCAL,          // [u16 slot]            stack[frame.base + slot] = peek(0)
  GET_GLOBAL,         // [u16 nameIdx]         push globals[name]
  SET_GLOBAL,         // [u16 nameIdx]         globals[name] = peek(0)
  DEFINE_GLOBAL,      // [u16 nameIdx]         globals[name] = pop()
  GET_UPVALUE,        // [u16 upIdx]           push upvalues[upIdx]
  SET_UPVALUE,        // [u16 upIdx]           upvalues[upIdx] = peek(0)
  CLOSE_UPVALUE,      // []                    hoist top stack slot onto heap and pop

  // Arithmetic, linear algebra and bitwise
  ADD,                // []                    pop b, a -> push a + b
  SUB,                // []                    pop b, a -> push a - b
  MUL,                // []                    pop b, a -> push a * b (scalar, dot, matmul)
  DIV,                // []                    pop b, a -> push a / b
  INT_DIV,            // []                    pop b, a -> push a div b
  MOD,                // []                    pop b, a -> push a % b
  POW,                // []                    pop b, a -> push a ** b
  CROSS,              // []                    pop b, a -> push a cross b
  FACTORIAL,          // []                    pop a    -> push a!
  NEG,                // []                    pop a    -> push -a
  POS,                // []                    pop a    -> push +a
  NOT,                // []                    pop a    -> push !a
  BIT_NOT,            // []                    pop a    -> push ~a
  BIT_AND,            // []                    pop b, a -> push a & b
  BIT_OR,             // []                    pop b, a -> push a | b
  BIT_XOR,            // []                    pop b, a -> push a ^ b
  SHL,                // []                    pop b, a -> push a << b
  SHR,                // []                    pop b, a -> push a >> b

  // Comparisons and sets
  EQ,                 // []                    pop b, a -> push a == b
  NEQ,                // []                    pop b, a -> push a != b
  APPROX_EQ,          // []                    pop b, a -> push a ~= b
  LT,                 // []                    pop b, a -> push a < b
  LE,                 // []                    pop b, a -> push a <= b
  GT,                 // []                    pop b, a -> push a > b
  GE,                 // []                    pop b, a -> push a >= b
  IN,                 // []                    pop b, a -> push a in b
  UNION,              // []                    pop b, a -> push a union b
  INTER,              // []                    pop b, a -> push a inter b
  SET_DIFF,           // []                    pop b, a -> push a \ b

  // Numeric coercion
  CAST_NUM,           // [u8 NumericTag]       pop a    -> push widened a

  // Control flow
  JUMP,               // [u16 offset]          ip += offset
  JUMP_IF_FALSE,      // [u16 offset]          if (!pop()) ip += offset
  JUMP_IF_TRUE,       // [u16 offset]          if (pop())  ip += offset
  LOOP,               // [u16 offset]          ip -= offset

  // Collections, vectors and matrices
  BUILD_LIST,         // [u16 count]           pop count items -> push List
  BUILD_RANGE,        // [u8 flags]            bit0=inclusive, bit1=hasStep -> push List
  BUILD_SET,          // [u16 count]           pop count items -> push Set
  BUILD_MAP,          // [u16 pairCount]       pop 2*pairCount -> push Map
  BUILD_VEC,          // [u16 count]           pop count items -> push Vector
  BUILD_MAT,          // [u16 rows, u16 cols]  pop rows*cols   -> push Matrix
  INDEX_GET,          // [u8 idxCount]         pop idxs..., obj -> push slot
  INDEX_SET,          // [u8 idxCount]         pop val, idxs..., obj -> push val
  SLICE,              // [u8 flags]            bit0=hasStart, bit1=hasEnd -> push slice
  ITER_INIT,          // []                    pop iterable -> push Iterator
  ITER_NEXT,          // [u16 jumpOffset]      peek Iterator -> push next OR jump if done

  // Functions and classes
  CLOSURE,            // [u16 protoIdx]        push Function capturing upvalues
  CALL,               // [u8 argCount]         call callee with argCount args
  RETURN,             // []                    return top of stack from current frame
  CLASS,              // [u16 nameIdx]         push new Class
  INHERIT,            // []                    attach superclass (peek(1)) to subclass (peek(0))
  METHOD,             // [u16 nameIdx]         pop fn -> attach to class at peek(0)
  FIELD_INIT,         // [u16 protoIdx]        attach field initializer proto to class at peek(0)
  GET_PROP,           // [u16 nameIdx]         pop obj -> push field / bound method / builtin prop
  SET_PROP,           // [u16 nameIdx]         pop val, obj -> obj.name = val, push val
  INVOKE,             // [u16 nameIdx, u8 argc] invoke obj.name(args...) directly
  IMPORT_BUILTIN,     // [u16 modNameIdx]      load built-in module symbols into globals
}

export type OperandFormat =
  | "none"
  | "u8"
  | "u16"
  | "const16"
  | "jump16"
  | "loop16"
  | "u16_u16"
  | "const16_u8";

export interface OpCodeMeta {
  readonly name: string;
  readonly operands: OperandFormat;
}

export const OPCODE_INFO: Readonly<Record<OpCode, OpCodeMeta>> = {
  [OpCode.CONST]: { name: "CONST", operands: "const16" },
  [OpCode.NONE]: { name: "NONE", operands: "none" },
  [OpCode.VOID]: { name: "VOID", operands: "none" },
  [OpCode.TRUE]: { name: "TRUE", operands: "none" },
  [OpCode.FALSE]: { name: "FALSE", operands: "none" },
  [OpCode.POP]: { name: "POP", operands: "none" },
  [OpCode.DUP]: { name: "DUP", operands: "none" },

  [OpCode.GET_LOCAL]: { name: "GET_LOCAL", operands: "u16" },
  [OpCode.SET_LOCAL]: { name: "SET_LOCAL", operands: "u16" },
  [OpCode.GET_GLOBAL]: { name: "GET_GLOBAL", operands: "const16" },
  [OpCode.SET_GLOBAL]: { name: "SET_GLOBAL", operands: "const16" },
  [OpCode.DEFINE_GLOBAL]: { name: "DEFINE_GLOBAL", operands: "const16" },
  [OpCode.GET_UPVALUE]: { name: "GET_UPVALUE", operands: "u16" },
  [OpCode.SET_UPVALUE]: { name: "SET_UPVALUE", operands: "u16" },
  [OpCode.CLOSE_UPVALUE]: { name: "CLOSE_UPVALUE", operands: "none" },

  [OpCode.ADD]: { name: "ADD", operands: "none" },
  [OpCode.SUB]: { name: "SUB", operands: "none" },
  [OpCode.MUL]: { name: "MUL", operands: "none" },
  [OpCode.DIV]: { name: "DIV", operands: "none" },
  [OpCode.INT_DIV]: { name: "INT_DIV", operands: "none" },
  [OpCode.MOD]: { name: "MOD", operands: "none" },
  [OpCode.POW]: { name: "POW", operands: "none" },
  [OpCode.CROSS]: { name: "CROSS", operands: "none" },
  [OpCode.FACTORIAL]: { name: "FACTORIAL", operands: "none" },
  [OpCode.NEG]: { name: "NEG", operands: "none" },
  [OpCode.POS]: { name: "POS", operands: "none" },
  [OpCode.NOT]: { name: "NOT", operands: "none" },
  [OpCode.BIT_NOT]: { name: "BIT_NOT", operands: "none" },
  [OpCode.BIT_AND]: { name: "BIT_AND", operands: "none" },
  [OpCode.BIT_OR]: { name: "BIT_OR", operands: "none" },
  [OpCode.BIT_XOR]: { name: "BIT_XOR", operands: "none" },
  [OpCode.SHL]: { name: "SHL", operands: "none" },
  [OpCode.SHR]: { name: "SHR", operands: "none" },

  [OpCode.EQ]: { name: "EQ", operands: "none" },
  [OpCode.NEQ]: { name: "NEQ", operands: "none" },
  [OpCode.APPROX_EQ]: { name: "APPROX_EQ", operands: "none" },
  [OpCode.LT]: { name: "LT", operands: "none" },
  [OpCode.LE]: { name: "LE", operands: "none" },
  [OpCode.GT]: { name: "GT", operands: "none" },
  [OpCode.GE]: { name: "GE", operands: "none" },
  [OpCode.IN]: { name: "IN", operands: "none" },
  [OpCode.UNION]: { name: "UNION", operands: "none" },
  [OpCode.INTER]: { name: "INTER", operands: "none" },
  [OpCode.SET_DIFF]: { name: "SET_DIFF", operands: "none" },

  [OpCode.CAST_NUM]: { name: "CAST_NUM", operands: "u8" },

  [OpCode.JUMP]: { name: "JUMP", operands: "jump16" },
  [OpCode.JUMP_IF_FALSE]: { name: "JUMP_IF_FALSE", operands: "jump16" },
  [OpCode.JUMP_IF_TRUE]: { name: "JUMP_IF_TRUE", operands: "jump16" },
  [OpCode.LOOP]: { name: "LOOP", operands: "loop16" },

  [OpCode.BUILD_LIST]: { name: "BUILD_LIST", operands: "u16" },
  [OpCode.BUILD_RANGE]: { name: "BUILD_RANGE", operands: "u8" },
  [OpCode.BUILD_SET]: { name: "BUILD_SET", operands: "u16" },
  [OpCode.BUILD_MAP]: { name: "BUILD_MAP", operands: "u16" },
  [OpCode.BUILD_VEC]: { name: "BUILD_VEC", operands: "u16" },
  [OpCode.BUILD_MAT]: { name: "BUILD_MAT", operands: "u16_u16" },
  [OpCode.INDEX_GET]: { name: "INDEX_GET", operands: "u8" },
  [OpCode.INDEX_SET]: { name: "INDEX_SET", operands: "u8" },
  [OpCode.SLICE]: { name: "SLICE", operands: "u8" },
  [OpCode.ITER_INIT]: { name: "ITER_INIT", operands: "none" },
  [OpCode.ITER_NEXT]: { name: "ITER_NEXT", operands: "jump16" },

  [OpCode.CLOSURE]: { name: "CLOSURE", operands: "const16" },
  [OpCode.CALL]: { name: "CALL", operands: "u8" },
  [OpCode.RETURN]: { name: "RETURN", operands: "none" },
  [OpCode.CLASS]: { name: "CLASS", operands: "const16" },
  [OpCode.INHERIT]: { name: "INHERIT", operands: "none" },
  [OpCode.METHOD]: { name: "METHOD", operands: "const16" },
  [OpCode.FIELD_INIT]: { name: "FIELD_INIT", operands: "const16" },
  [OpCode.GET_PROP]: { name: "GET_PROP", operands: "const16" },
  [OpCode.SET_PROP]: { name: "SET_PROP", operands: "const16" },
  [OpCode.INVOKE]: { name: "INVOKE", operands: "const16_u8" },
  [OpCode.IMPORT_BUILTIN]: { name: "IMPORT_BUILTIN", operands: "const16" },
}

export class Chunk {
  public readonly code: number[] = [];
  public readonly constants: QValue[] = [];
  public readonly locations: SourceLoc[] = [];

  public emit(byte: number, loc: SourceLoc = NO_LOC): number {
    if (byte < 0 || byte > 0xff) {
      throw new RangeError(`Byte operand out of range (0..255): ${byte}`);
    }
    const offset = this.code.length;
    this.code.push(byte & 0xff);
    this.locations.push(loc);
    return offset;
  }

  public emitOp(op: OpCode, loc: SourceLoc = NO_LOC): number {
    return this.emit(op, loc);
  }

  public emitU8(value: number, loc: SourceLoc = NO_LOC): void {
    this.emit(value, loc);
  }

  public emitU16(value: number, loc: SourceLoc = NO_LOC): void {
    if (value < 0 || value > 0xffff) {
      throw new RangeError(`u16 operand out of range (0..65535): ${value}`);
    }
    this.emit((value >> 8) & 0xff, loc);
    this.emit(value & 0xff, loc);
  }

  public emitOpU8(op: OpCode, operand: number, loc: SourceLoc = NO_LOC): void {
    this.emitOp(op, loc);
    this.emitU8(operand, loc);
  }

  public emitOpU16(op: OpCode, operand: number, loc: SourceLoc = NO_LOC): void {
    this.emitOp(op, loc);
    this.emitU16(operand, loc);
  }

  public addConstant(value: QValue): number {
    const idx = this.constants.length;
    if (idx > 0xffff) {
      throw new RangeError("Too many constants in a single chunk (max 65535).");
    }
    this.constants.push(value);
    return idx;
  }

  public emitConstant(value: QValue, loc: SourceLoc = NO_LOC): number {
    const idx = this.addConstant(value);
    this.emitOpU16(OpCode.CONST, idx, loc);
    return idx;
  }

  /**
   * Emits a forward jump with a 2-byte placeholder and returns the patch offset.
   * Call `patchJump(offset)` once the target instruction position is known.
   */
  public emitJump(op: OpCode, loc: SourceLoc = NO_LOC): number {
    this.emitOp(op, loc);
    const patchOffset = this.code.length;
    this.emit(0xff, loc);
    this.emit(0xff, loc);
    return patchOffset;
  }

  public patchJump(patchOffset: number): void {
    const distance = this.code.length - patchOffset - 2;
    if (distance < 0 || distance > 0xffff) {
      throw new RangeError(`Jump distance out of range: ${distance}`);
    }
    this.code[patchOffset] = (distance >> 8) & 0xff;
    this.code[patchOffset + 1] = distance & 0xff;
  }

  /**
   * Emits a backward `LOOP` jump back to `loopStart`.
   */
  public emitLoop(loopStart: number, loc: SourceLoc = NO_LOC): void {
    this.emitOp(OpCode.LOOP, loc);
    const distance = this.code.length - loopStart + 2;
    if (distance < 0 || distance > 0xffff) {
      throw new RangeError(`Loop body too large: ${distance}`);
    }
    this.emitU16(distance, loc);
  }

  public readU8(offset: number): number {
    return this.code[offset];
  }

  public readU16(offset: number): number {
    return (this.code[offset] << 8) | this.code[offset + 1];
  }

  public locationAt(offset: number): SourceLoc {
    return this.locations[offset] ?? NO_LOC;
  }
}
