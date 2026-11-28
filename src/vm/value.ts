import { Chunk } from "./bytecode.js";

export interface UpvalueDesc {
  readonly isLocal: boolean;
  readonly index: number;
}

export interface Upvalue {
  location: number;
  closed?: QValue;
}

export interface FunctionProto {
  readonly name: string;
  readonly arity: number;
  readonly hasParens: boolean;
  readonly chunk: Chunk;
  readonly upvalues: readonly UpvalueDesc[];
}

export interface QClass {
  readonly name: string;
  readonly parent?: QClass;
  readonly methods: Map<string, QValue>;
  fieldInit?: FunctionProto;
}

export type NativeFn = (args: readonly QValue[]) => QValue;

export type QValue =
  | { readonly kind: "Int"; readonly value: number }
  | { readonly kind: "BigInt"; readonly value: bigint }
  | { readonly kind: "Float"; readonly value: number }
  | { readonly kind: "Double"; readonly value: number }
  | { readonly kind: "Complex"; readonly re: number; readonly im: number }
  | { readonly kind: "Boolean"; readonly value: boolean }
  | { readonly kind: "String"; readonly value: string }
  | { readonly kind: "None" }
  | { readonly kind: "Void" }
  | { readonly kind: "Vector"; readonly data: QValue[] }
  | { readonly kind: "Matrix"; readonly rows: number; readonly cols: number; readonly data: QValue[] }
  | { readonly kind: "List"; readonly elements: QValue[] }
  | { readonly kind: "Set"; readonly elements: Map<string, QValue> }
  | { readonly kind: "Map"; readonly entries: Map<string, { key: QValue; value: QValue }> }
  | { readonly kind: "Deque"; readonly elements: QValue[] }
  | { readonly kind: "Heap"; readonly elements: QValue[] }
  | { readonly kind: "Function"; readonly proto: FunctionProto; readonly upvalues?: Upvalue[] }
  | { readonly kind: "NativeFunc"; readonly name: string; readonly fn: NativeFn }
  | { readonly kind: "BoundMethod"; readonly receiver: QValue; readonly method: QValue }
  | { readonly kind: "Class"; readonly klass: QClass }
  | { readonly kind: "Instance"; readonly klass: QClass; readonly fields: Map<string, QValue> };

export const V = {
  int: (value: number): QValue => ({ kind: "Int", value: Math.trunc(value) }),
  bigint: (value: bigint): QValue => ({ kind: "BigInt", value }),
  float: (value: number): QValue => ({ kind: "Float", value: Math.fround(value) }),
  double: (value: number): QValue => ({ kind: "Double", value }),
  complex: (re: number, im: number): QValue => ({ kind: "Complex", re, im }),
  bool: (value: boolean): QValue => ({ kind: "Boolean", value }),
  str: (value: string): QValue => ({ kind: "String", value }),
  none: { kind: "None" } as const satisfies QValue,
  void: { kind: "Void" } as const satisfies QValue,
}
