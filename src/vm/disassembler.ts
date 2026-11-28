import { Chunk, OPCODE_INFO, OpCode } from "./bytecode.js";
import { QValue } from "./value.js";

export function formatConstant(v: QValue): string {
  switch (v.kind) {
    case "Int": return `${v.value} (Int)`;
    case "BigInt": return `${v.value}n (BigInt)`;
    case "Float": return `${v.value}f`;
    case "Double": return `${v.value}d`;
    case "Complex": return `${v.re}+${v.im}i`;
    case "Boolean": return String(v.value);
    case "String": return JSON.stringify(v.value);
    case "None": return "None";
    case "Void": return "Void";
    case "Function": return `<fn ${v.proto.name}>`;
    case "NativeFunc": return `<native ${v.name}>`;
    case "Class": return `<class ${v.klass.name}>`;
    default: return `<${v.kind}>`;
  }
}

export function disassembleChunk(chunk: Chunk, name = "<script>"): string {
  const lines: string[] = [`== ${name} ==`];
  let offset = 0;

  while (offset < chunk.code.length) {
    const start = offset;
    const op = chunk.code[offset++] as OpCode;
    const meta = OPCODE_INFO[op];
    const loc = chunk.locationAt(start);
    const addr = String(start).padStart(4, "0");
    const pos = `${String(loc.line).padStart(3, " ")}:${String(loc.column).padEnd(2, " ")}`;

    if (!meta) {
      lines.push(`${addr}  ${pos}  UNKNOWN(${op})`);
      continue;
    }

    const opName = meta.name.padEnd(16, " ");

    switch (meta.operands) {
      case "none":
        lines.push(`${addr}  ${pos}  ${opName}`);
        break;

      case "u8": {
        const arg = chunk.readU8(offset);
        offset += 1;
        lines.push(`${addr}  ${pos}  ${opName} ${arg}`);
        break;
      }

      case "u16": {
        const arg = chunk.readU16(offset);
        offset += 2;
        lines.push(`${addr}  ${pos}  ${opName} ${arg}`);
        break;
      }

      case "const16": {
        const idx = chunk.readU16(offset);
        offset += 2;
        const val = chunk.constants[idx];
        lines.push(`${addr}  ${pos}  ${opName} #${idx} (${val ? formatConstant(val) : "?"})`);
        break;
      }

      case "jump16": {
        const dist = chunk.readU16(offset);
        offset += 2;
        const target = offset + dist;
        lines.push(`${addr}  ${pos}  ${opName} ${start} -> ${target}`);
        break;
      }

      case "loop16": {
        const dist = chunk.readU16(offset);
        offset += 2;
        const target = offset - dist;
        lines.push(`${addr}  ${pos}  ${opName} ${start} -> ${target}`);
        break;
      }

      case "u16_u16": {
        const a = chunk.readU16(offset);
        const b = chunk.readU16(offset + 2);
        offset += 4;
        lines.push(`${addr}  ${pos}  ${opName} ${a}, ${b}`);
        break;
      }

      case "const16_u8": {
        const idx = chunk.readU16(offset);
        const argc = chunk.readU8(offset + 2);
        offset += 3;
        const val = chunk.constants[idx];
        lines.push(`${addr}  ${pos}  ${opName} #${idx} (${val ? formatConstant(val) : "?"}), argc=${argc}`);
        break;
      }
    }
  }

  return lines.join("\n");
}
