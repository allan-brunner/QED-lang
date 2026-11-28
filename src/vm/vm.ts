import { QEDError } from "../core/diagnostics.js";
import { Chunk, NO_LOC, NumericTag, OpCode, SourceLoc } from "./bytecode.js";
import { FunctionProto, QValue, V } from "./value.js";

const APPROX_EPSILON = 1e-9;

export class RuntimeError extends QEDError {
  constructor(message: string, loc: SourceLoc = NO_LOC) {
    super(
      "runtime",
      message,
      loc.line,
      loc.column,
      1,
      `Runtime error at ${loc.line}:${loc.column}: ${message}`
    );
  }
}

export interface VMOptions {
  readonly stdout?: (text: string) => void;
  readonly maxSteps?: number;
}

export function valueToString(v: QValue): string {
  switch (v.kind) {
    case "Int":
    case "Float":
    case "Double":
      return String(v.value);
    case "BigInt":
      return v.value.toString();
    case "Complex": {
      if (v.im === 0) return String(v.re);
      if (v.re === 0) return `${v.im}i`;
      return v.im < 0 ? `${v.re} - ${-v.im}i` : `${v.re} + ${v.im}i`;
    }
    case "Boolean":
      return v.value ? "true" : "false";
    case "String":
      return v.value;
    case "None":
      return "None";
    case "Void":
      return "Void";
    default:
      return `<${v.kind}>`;
  }
}

type NumericValue = Extract<
  QValue,
  { kind: "Int" | "BigInt" | "Float" | "Double" | "Complex" }
>;

const NUM_RANK: Record<NumericValue["kind"], number> = {
  Int: 0,
  BigInt: 1,
  Float: 2,
  Double: 3,
  Complex: 4,
};

function isNumVal(v: QValue): v is NumericValue {
  return (
    v.kind === "Int" ||
    v.kind === "BigInt" ||
    v.kind === "Float" ||
    v.kind === "Double" ||
    v.kind === "Complex"
  );
}

function promotedKind(a: NumericValue, b: NumericValue): NumericValue["kind"] {
  if (
    (a.kind === "BigInt" && b.kind === "Float") ||
    (a.kind === "Float" && b.kind === "BigInt")
  ) {
    return "Double";
  }
  return NUM_RANK[a.kind] >= NUM_RANK[b.kind] ? a.kind : b.kind;
}

function asNumber(v: NumericValue): number {
  switch (v.kind) {
    case "Int":
    case "Float":
    case "Double":
      return v.value;
    case "BigInt":
      return Number(v.value);
    case "Complex":
      return v.re;
  }
}

function asComplex(v: NumericValue): { re: number; im: number } {
  return v.kind === "Complex" ? { re: v.re, im: v.im } : { re: asNumber(v), im: 0 };
}

function asBigInt(v: NumericValue): bigint {
  return v.kind === "BigInt" ? v.value : BigInt(Math.trunc(asNumber(v)));
}

function castNumeric(v: QValue, tag: NumericTag, loc: SourceLoc): QValue {
  if (v.kind === "None") return v;
  if (!isNumVal(v)) {
    throw new RuntimeError(`Cannot convert '${v.kind}' to numeric type.`, loc);
  }
  switch (tag) {
    case NumericTag.Int:
      return V.int(asNumber(v));
    case NumericTag.BigInt:
      return V.bigint(asBigInt(v));
    case NumericTag.Float:
      return V.float(asNumber(v));
    case NumericTag.Double:
      return V.double(asNumber(v));
    case NumericTag.Complex: {
      const c = asComplex(v);
      return V.complex(c.re, c.im);
    }
  }
}

function complexPow(
  a: { re: number; im: number },
  b: { re: number; im: number }
): QValue {
  if (a.re === 0 && a.im === 0) {
    return b.re === 0 && b.im === 0 ? V.complex(1, 0) : V.complex(0, 0);
  }
  const r = Math.hypot(a.re, a.im);
  const theta = Math.atan2(a.im, a.re);
  const lnR = Math.log(r);
  const expRe = b.re * lnR - b.im * theta;
  const expIm = b.re * theta + b.im * lnR;
  const mag = Math.exp(expRe);
  return V.complex(mag * Math.cos(expIm), mag * Math.sin(expIm));
}

export class VM {
  private readonly stack: QValue[] = [];
  private readonly globals = new Map<string, QValue>();
  private readonly stdout: (text: string) => void;
  private readonly maxSteps: number;

  constructor(options: VMOptions = {}) {
    this.stdout = options.stdout ?? ((text) => console.log(text));
    this.maxSteps = options.maxSteps ?? 1_000_000;
  }

  public getGlobal(name: string): QValue | undefined {
    return this.globals.get(name);
  }

  public run(proto: FunctionProto): QValue {
    this.stack.length = 0;
    const chunk: Chunk = proto.chunk;
    let ip = 0;
    let steps = 0;

    const readU8 = (): number => chunk.code[ip++];
    const readU16 = (): number => {
      const val = (chunk.code[ip] << 8) | chunk.code[ip + 1];
      ip += 2;
      return val;
    };
    const readStringConst = (): string => {
      const c = chunk.constants[readU16()];
      if (!c || c.kind !== "String") {
        throw new RuntimeError("Corrupt bytecode: expected string constant.", chunk.locationAt(ip));
      }
      return c.value;
    };

    while (ip < chunk.code.length) {
      if (++steps > this.maxSteps) {
        throw new RuntimeError(`Execution exceeded limit of ${this.maxSteps} instructions.`, chunk.locationAt(ip));
      }

      const opOffset = ip;
      const op = readU8() as OpCode;
      const loc = chunk.locationAt(opOffset);

      switch (op) {
        case OpCode.CONST:
          this.stack.push(chunk.constants[readU16()]);
          break;
        case OpCode.NONE:
          this.stack.push(V.none);
          break;
        case OpCode.VOID:
          this.stack.push(V.void);
          break;
        case OpCode.TRUE:
          this.stack.push(V.bool(true));
          break;
        case OpCode.FALSE:
          this.stack.push(V.bool(false));
          break;
        case OpCode.POP:
          this.stack.pop();
          break;
        case OpCode.DUP:
          this.stack.push(this.stack[this.stack.length - 1]);
          break;

        case OpCode.DEFINE_GLOBAL: {
          const name = readStringConst();
          this.globals.set(name, this.pop(loc));
          break;
        }
        case OpCode.GET_GLOBAL: {
          const name = readStringConst();
          const val = this.globals.get(name);
          if (val === undefined) {
            throw new RuntimeError(`Undefined global '${name}'.`, loc);
          }
          this.stack.push(val);
          break;
        }
        case OpCode.SET_GLOBAL: {
          const name = readStringConst();
          const val = this.peek(0, loc);
          this.globals.set(name, val);
          break;
        }

        case OpCode.CAST_NUM: {
          const tag = readU8() as NumericTag;
          const val = this.pop(loc);
          this.stack.push(castNumeric(val, tag, loc));
          break;
        }

        case OpCode.JUMP: {
          const dist = readU16();
          ip += dist;
          break;
        }
        case OpCode.JUMP_IF_FALSE: {
          const dist = readU16();
          const cond = this.pop(loc);
          if (cond.kind === "Boolean" && !cond.value) {
            ip += dist;
          }
          break;
        }
        case OpCode.JUMP_IF_TRUE: {
          const dist = readU16();
          const cond = this.pop(loc);
          if (cond.kind === "Boolean" && cond.value) {
            ip += dist;
          }
          break;
        }
        case OpCode.LOOP: {
          const dist = readU16();
          ip -= dist;
          break;
        }

        case OpCode.ADD:
        case OpCode.SUB:
        case OpCode.MUL:
        case OpCode.DIV:
        case OpCode.INT_DIV:
        case OpCode.MOD:
        case OpCode.POW:
        case OpCode.BIT_AND:
        case OpCode.BIT_OR:
        case OpCode.BIT_XOR:
        case OpCode.SHL:
        case OpCode.SHR: {
          const b = this.pop(loc);
          const a = this.pop(loc);
          this.stack.push(this.execBinary(op, a, b, loc));
          break;
        }

        case OpCode.NEG: {
          const a = this.pop(loc);
          if (a.kind === "Int") this.stack.push(V.int(-a.value));
          else if (a.kind === "BigInt") this.stack.push(V.bigint(-a.value));
          else if (a.kind === "Float") this.stack.push(V.float(-a.value));
          else if (a.kind === "Double") this.stack.push(V.double(-a.value));
          else if (a.kind === "Complex") this.stack.push(V.complex(-a.re, -a.im));
          else throw new RuntimeError(`Cannot negate '${a.kind}'.`, loc);
          break;
        }

        case OpCode.POS:
          // Unary '+' is a no-op on numerics
          break;

        case OpCode.NOT: {
          const a = this.pop(loc);
          if (a.kind !== "Boolean") {
            throw new RuntimeError(`Expected Boolean for '!'.`, loc);
          }
          this.stack.push(V.bool(!a.value));
          break;
        }

        case OpCode.BIT_NOT: {
          const a = this.pop(loc);
          if (a.kind === "Int") this.stack.push(V.int(~a.value));
          else if (a.kind === "BigInt") this.stack.push(V.bigint(~a.value));
          else throw new RuntimeError(`Expected integer for '~'.`, loc);
          break;
        }

        case OpCode.FACTORIAL: {
          const a = this.pop(loc);
          this.stack.push(this.execFactorial(a, loc));
          break;
        }

        case OpCode.EQ:
        case OpCode.NEQ:
        case OpCode.APPROX_EQ:
        case OpCode.LT:
        case OpCode.LE:
        case OpCode.GT:
        case OpCode.GE: {
          const b = this.pop(loc);
          const a = this.pop(loc);
          this.stack.push(V.bool(this.execCompare(op, a, b, loc)));
          break;
        }

        case OpCode.GET_PROP: {
          const prop = readStringConst();
          const obj = this.pop(loc);
          this.stack.push(this.getBuiltinProp(obj, prop, loc));
          break;
        }

        case OpCode.CALL: {
          const argc = readU8();
          const args = this.stack.splice(this.stack.length - argc, argc);
          const callee = this.pop(loc);
          if (callee.kind === "NativeFunc") {
            this.stack.push(callee.fn(args));
          } else {
            throw new RuntimeError(`Slice 1: cannot call '${callee.kind}' yet.`, loc);
          }
          break;
        }

        case OpCode.IMPORT_BUILTIN: {
          const modName = readStringConst();
          this.loadBuiltinModule(modName, loc);
          break;
        }

        case OpCode.RETURN:
          return this.stack.pop() ?? V.void;

        default:
          throw new RuntimeError(`Opcode '${OpCode[op] ?? op}' not implemented yet.`, loc);
      }
    }

    return V.void;
  }

  private pop(loc: SourceLoc): QValue {
    const v = this.stack.pop();
    if (!v) throw new RuntimeError("VM stack underflow.", loc);
    return v;
  }

  private peek(distance: number, loc: SourceLoc): QValue {
    const idx = this.stack.length - 1 - distance;
    if (idx < 0) throw new RuntimeError("VM stack underflow.", loc);
    return this.stack[idx];
  }

  private loadBuiltinModule(name: string, loc: SourceLoc): void {
    if (name === "io") {
      this.globals.set("print", {
        kind: "NativeFunc",
        name: "print",
        fn: (args) => {
          this.stdout(valueToString(args[0] ?? V.str("")));
          return V.void;
        },
      });
      this.globals.set("println", {
        kind: "NativeFunc",
        name: "println",
        fn: (args) => {
          this.stdout(valueToString(args[0] ?? V.str("")));
          return V.void;
        },
      });
      return;
    }
    throw new RuntimeError(`VM Slice 1: module '${name}' is not wired yet.`, loc);
  }

  private getBuiltinProp(obj: QValue, prop: string, loc: SourceLoc): QValue {
    if (prop === "toString") {
      return V.str(valueToString(obj));
    }

    if (isNumVal(obj)) {
      if (obj.kind === "Complex") {
        switch (prop) {
          case "re": return V.double(obj.re);
          case "im": return V.double(obj.im);
          case "abs": return V.double(Math.hypot(obj.re, obj.im));
          case "arg": return V.double(Math.atan2(obj.im, obj.re));
          case "conj": return V.complex(obj.re, -obj.im);
          case "sqrt": {
            const r = Math.hypot(obj.re, obj.im);
            const re = Math.sqrt((r + obj.re) / 2);
            const im = Math.sign(obj.im || 1) * Math.sqrt((r - obj.re) / 2);
            return V.complex(re, obj.im === 0 && obj.re >= 0 ? 0 : im);
          }
          case "toComplex": return obj;
        }
      } else {
        const n = asNumber(obj);
        switch (prop) {
          case "sqrt":
            if (n < 0) throw new RuntimeError("Cannot take real square root of negative number.", loc);
            return V.double(Math.sqrt(n));
          case "abs":
            if (obj.kind === "BigInt") return V.bigint(obj.value < 0n ? -obj.value : obj.value);
            if (obj.kind === "Int") return V.int(Math.abs(obj.value));
            if (obj.kind === "Float") return V.float(Math.abs(obj.value));
            return V.double(Math.abs(obj.value));
          case "toInt": return V.int(n);
          case "toBigInt": return V.bigint(asBigInt(obj));
          case "toFloat": return V.float(n);
          case "toDouble": return V.double(n);
          case "toComplex": return V.complex(n, 0);
        }
      }
    }

    if (obj.kind === "String") {
      switch (prop) {
        case "length": return V.int(obj.value.length);
        case "isEmpty": return V.bool(obj.value.length === 0);
        case "upper": return V.str(obj.value.toUpperCase());
        case "lower": return V.str(obj.value.toLowerCase());
        case "trim": return V.str(obj.value.trim());
      }
    }

    throw new RuntimeError(`Property '${prop}' not implemented for '${obj.kind}' yet.`, loc);
  }

  private execFactorial(v: QValue, loc: SourceLoc): QValue {
    if (v.kind === "Int") {
      if (v.value < 0) throw new RuntimeError("Factorial is undefined for negative integers.", loc);
      let acc = 1;
      for (let i = 2; i <= v.value; i++) acc *= i;
      return V.int(acc);
    }
    if (v.kind === "BigInt") {
      if (v.value < 0n) throw new RuntimeError("Factorial is undefined for negative integers.", loc);
      let acc = 1n;
      for (let i = 2n; i <= v.value; i++) acc *= i;
      return V.bigint(acc);
    }
    throw new RuntimeError(`Factorial requires an integer, got '${v.kind}'.`, loc);
  }

  private execBinary(op: OpCode, a: QValue, b: QValue, loc: SourceLoc): QValue {
    if (op === OpCode.ADD && a.kind === "String" && b.kind === "String") {
      return V.str(a.value + b.value);
    }

    if (!isNumVal(a) || !isNumVal(b)) {
      throw new RuntimeError(`Operator '${OpCode[op]}' not supported for '${a.kind}' and '${b.kind}'.`, loc);
    }

    // Integer-only operators
    if (
      op === OpCode.INT_DIV ||
      op === OpCode.MOD ||
      op === OpCode.BIT_AND ||
      op === OpCode.BIT_OR ||
      op === OpCode.BIT_XOR ||
      op === OpCode.SHL ||
      op === OpCode.SHR
    ) {
      if (a.kind === "BigInt" || b.kind === "BigInt") {
        const x = asBigInt(a);
        const y = asBigInt(b);
        switch (op) {
          case OpCode.INT_DIV:
            if (y === 0n) throw new RuntimeError("Division by zero.", loc);
            return V.bigint(x / y);
          case OpCode.MOD:
            if (y === 0n) throw new RuntimeError("Modulo by zero.", loc);
            return V.bigint(x % y);
          case OpCode.BIT_AND: return V.bigint(x & y);
          case OpCode.BIT_OR: return V.bigint(x | y);
          case OpCode.BIT_XOR: return V.bigint(x ^ y);
          case OpCode.SHL: return V.bigint(x << y);
          case OpCode.SHR: return V.bigint(x >> y);
        }
      }

      const x = asNumber(a);
      const y = asNumber(b);
      switch (op) {
        case OpCode.INT_DIV:
          if (y === 0) throw new RuntimeError("Division by zero.", loc);
          return V.int(Math.trunc(x / y));
        case OpCode.MOD:
          if (y === 0) throw new RuntimeError("Modulo by zero.", loc);
          return V.int(x % y);
        case OpCode.BIT_AND: return V.int(x & y);
        case OpCode.BIT_OR: return V.int(x | y);
        case OpCode.BIT_XOR: return V.int(x ^ y);
        case OpCode.SHL: return V.int(x << y);
        case OpCode.SHR: return V.int(x >> y);
      }
    }

    const target = promotedKind(a, b);

    if (op === OpCode.DIV) {
      if (target === "Complex") {
        const ca = asComplex(a);
        const cb = asComplex(b);
        const denom = cb.re * cb.re + cb.im * cb.im;
        if (denom === 0) throw new RuntimeError("Division by zero.", loc);
        return V.complex(
          (ca.re * cb.re + ca.im * cb.im) / denom,
          (ca.im * cb.re - ca.re * cb.im) / denom
        );
      }
      const x = asNumber(a);
      const y = asNumber(b);
      if (y === 0) throw new RuntimeError("Division by zero.", loc);
      return target === "Float" ? V.float(x / y) : V.double(x / y);
    }

    if (target === "Complex") {
      const ca = asComplex(a);
      const cb = asComplex(b);
      switch (op) {
        case OpCode.ADD: return V.complex(ca.re + cb.re, ca.im + cb.im);
        case OpCode.SUB: return V.complex(ca.re - cb.re, ca.im - cb.im);
        case OpCode.MUL: return V.complex(ca.re * cb.re - ca.im * cb.im, ca.re * cb.im + ca.im * cb.re);
        case OpCode.POW: return complexPow(ca, cb);
      }
    }

    if (target === "BigInt") {
      const x = asBigInt(a);
      const y = asBigInt(b);
      switch (op) {
        case OpCode.ADD: return V.bigint(x + y);
        case OpCode.SUB: return V.bigint(x - y);
        case OpCode.MUL: return V.bigint(x * y);
        case OpCode.POW:
          if (y < 0n) throw new RuntimeError("BigInt exponent cannot be negative.", loc);
          return V.bigint(x ** y);
      }
    }

    const x = asNumber(a);
    const y = asNumber(b);
    const res =
      op === OpCode.ADD ? x + y
        : op === OpCode.SUB ? x - y
          : op === OpCode.MUL ? x * y
            : x ** y;

    if (target === "Int") return V.int(res);
    if (target === "Float") return V.float(res);
    return V.double(res);
  }

  private execCompare(op: OpCode, a: QValue, b: QValue, loc: SourceLoc): boolean {
    if (op === OpCode.APPROX_EQ) {
      if (!isNumVal(a) || !isNumVal(b)) {
        throw new RuntimeError(`Cannot apply '~=' to '${a.kind}' and '${b.kind}'.`, loc);
      }
      const ca = asComplex(a);
      const cb = asComplex(b);
      return Math.hypot(ca.re - cb.re, ca.im - cb.im) <= APPROX_EPSILON;
    }

    if (op === OpCode.EQ || op === OpCode.NEQ) {
      let equal = false;
      if (a.kind === "None" && b.kind === "None") {
        equal = true;
      } else if (isNumVal(a) && isNumVal(b)) {
        if (a.kind === "BigInt" && b.kind === "BigInt") {
          equal = a.value === b.value;
        } else if (a.kind === "Complex" || b.kind === "Complex") {
          const ca = asComplex(a);
          const cb = asComplex(b);
          equal = ca.re === cb.re && ca.im === cb.im;
        } else {
          equal = asNumber(a) === asNumber(b);
        }
      } else if (a.kind === "String" && b.kind === "String") {
        equal = a.value === b.value;
      } else if (a.kind === "Boolean" && b.kind === "Boolean") {
        equal = a.value === b.value;
      }
      return op === OpCode.EQ ? equal : !equal;
    }

    if (a.kind === "String" && b.kind === "String") {
      switch (op) {
        case OpCode.LT: return a.value < b.value;
        case OpCode.LE: return a.value <= b.value;
        case OpCode.GT: return a.value > b.value;
        case OpCode.GE: return a.value >= b.value;
      }
    }

    if (isNumVal(a) && isNumVal(b)) {
      if (a.kind === "BigInt" && b.kind === "BigInt") {
        switch (op) {
          case OpCode.LT: return a.value < b.value;
          case OpCode.LE: return a.value <= b.value;
          case OpCode.GT: return a.value > b.value;
          case OpCode.GE: return a.value >= b.value;
        }
      }
      const x = asNumber(a);
      const y = asNumber(b);
      switch (op) {
        case OpCode.LT: return x < y;
        case OpCode.LE: return x <= y;
        case OpCode.GT: return x > y;
        case OpCode.GE: return x >= y;
      }
    }

    throw new RuntimeError(`Cannot compare '${a.kind}' and '${b.kind}'.`, loc);
  }
}
