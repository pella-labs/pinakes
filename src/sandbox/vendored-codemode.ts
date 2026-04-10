/**
 * Vendored utilities from @cloudflare/codemode v0.3.4
 *
 * Source: https://github.com/cloudflare/agents/tree/main/packages/codemode
 * License: MIT (Cloudflare, Inc.)
 *
 * Why vendored, not imported:
 *   The main entry of @cloudflare/codemode imports `RpcTarget` from
 *   `cloudflare:workers`, which is a Workers-runtime-only module. The package
 *   is therefore unusable from a plain Node.js process (like our MCP stdio
 *   server). The four utility functions in this file are pure JS with no
 *   Workers dependency, so we copy them here instead of deep-importing from
 *   the package's internal chunk files (whose hashed names are not part of
 *   any public API and can change on any upstream rebuild).
 *
 *   See `dev-docs/prior-art.md` §5 and `dev-docs/presearch.md` D30 for the
 *   full audit and decision.
 *
 * Exports:
 *   - normalizeCode(code)                 — strip markdown fences + AST-wrap
 *                                            LLM code into an async IIFE
 *   - sanitizeToolName(name)              — tool name → valid JS identifier
 *   - jsonSchemaToType(schema, typeName)  — JSON Schema → TS type alias
 *   - generateTypesFromJsonSchema(tools)  — tool set → TS `declare const`
 *                                            block for LLM prompts
 *
 * Modifications from upstream:
 *   - Added explicit TypeScript types (upstream ships types via a separate
 *     `.d.ts` chunk).
 *   - Combined into a single file instead of upstream's two-chunk layout.
 *   - Reformatted to match our Prettier config (single quotes, semicolons).
 *   - No behavioral changes.
 *
 * Upstream copyright:
 *   MIT License
 *   Copyright (c) Cloudflare, Inc.
 *   https://github.com/cloudflare/agents/blob/main/LICENSE
 */

import * as acorn from 'acorn';
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';

// ============================================================================
// normalize.ts — strip markdown fences + AST-wrap LLM code
// ============================================================================

/**
 * Strip markdown code fences that LLMs commonly wrap code in.
 * Handles ```js, ```javascript, ```typescript, ```ts, or bare ```.
 */
function stripCodeFences(code: string): string {
  const match = code.match(
    /^```(?:js|javascript|typescript|ts|tsx|jsx)?\s*\n([\s\S]*?)```\s*$/
  );
  return match ? match[1]! : code;
}

/**
 * Normalize LLM-generated code into an async IIFE suitable for sandbox
 * execution. Strips markdown fences, parses with acorn, and wraps the
 * code so the final expression is returned from an `async () => { ... }`.
 *
 * Graceful fallback: if acorn fails to parse, wraps the raw source as-is.
 */
export function normalizeCode(code: string): string {
  const trimmed = stripCodeFences(code.trim());
  if (!trimmed.trim()) return 'async () => {}';
  const source = trimmed.trim();
  try {
    const ast = acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    }) as unknown as {
      body: Array<{
        type: string;
        expression?: { type: string; start: number; end: number };
        declaration?: { type: string; id?: { name: string }; start: number; end: number };
        id?: { name: string };
        start: number;
        end: number;
      }>;
    };

    if (ast.body.length === 1 && ast.body[0]!.type === 'ExpressionStatement') {
      if (ast.body[0]!.expression!.type === 'ArrowFunctionExpression') return source;
    }

    if (ast.body.length === 1 && ast.body[0]!.type === 'ExportDefaultDeclaration') {
      const decl = ast.body[0]!.declaration!;
      const inner = source.slice(decl.start, decl.end);
      if (decl.type === 'FunctionDeclaration' && !decl.id) {
        return `async () => {\nreturn (${inner})();\n}`;
      }
      if (decl.type === 'ClassDeclaration' && !decl.id) {
        return `async () => {\nreturn (${inner});\n}`;
      }
      return normalizeCode(inner);
    }

    if (ast.body.length === 1 && ast.body[0]!.type === 'FunctionDeclaration') {
      return `async () => {\n${source}\nreturn ${ast.body[0]!.id?.name ?? 'fn'}();\n}`;
    }

    const last = ast.body[ast.body.length - 1];
    if (last?.type === 'ExpressionStatement') {
      const exprStmt = last;
      return `async () => {\n${source.slice(0, last.start)}return (${source.slice(
        exprStmt.expression!.start,
        exprStmt.expression!.end
      )})\n}`;
    }

    return `async () => {\n${source}\n}`;
  } catch {
    return `async () => {\n${source}\n}`;
  }
}

// ============================================================================
// utils.ts — identifier sanitization + string escaping helpers
// ============================================================================

const JS_RESERVED = new Set([
  'abstract', 'arguments', 'await', 'boolean', 'break', 'byte', 'case',
  'catch', 'char', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'double', 'else', 'enum', 'eval', 'export', 'extends',
  'false', 'final', 'finally', 'float', 'for', 'function', 'goto', 'if',
  'implements', 'import', 'in', 'instanceof', 'int', 'interface', 'let',
  'long', 'native', 'new', 'null', 'package', 'private', 'protected',
  'public', 'return', 'short', 'static', 'super', 'switch', 'synchronized',
  'this', 'throw', 'throws', 'transient', 'true', 'try', 'typeof',
  'undefined', 'var', 'void', 'volatile', 'while', 'with', 'yield',
]);

/**
 * Sanitize a tool name into a valid JavaScript identifier.
 * Replaces hyphens, dots, and spaces with `_`, strips other invalid chars,
 * prefixes digit-leading names with `_`, and appends `_` to JS reserved words.
 */
export function sanitizeToolName(name: string): string {
  if (!name) return '_';
  let sanitized = name.replace(/[-.\s]/g, '_');
  sanitized = sanitized.replace(/[^a-zA-Z0-9_$]/g, '');
  if (!sanitized) return '_';
  if (/^[0-9]/.test(sanitized)) sanitized = '_' + sanitized;
  if (JS_RESERVED.has(sanitized)) sanitized = sanitized + '_';
  return sanitized;
}

function toPascalCase(str: string): string {
  return str
    .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

/**
 * Escape a character as a unicode escape sequence if it is a control character.
 */
function escapeControlChar(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code <= 31 || code === 127) return '\\u' + code.toString(16).padStart(4, '0');
  return ch;
}

/**
 * Quote a property name if needed.
 * Escapes backslashes, quotes, and control characters.
 */
function quoteProp(name: string): string {
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
    let escaped = '';
    for (const ch of name) {
      if (ch === '\\') escaped += '\\\\';
      else if (ch === '"') escaped += '\\"';
      else if (ch === '\n') escaped += '\\n';
      else if (ch === '\r') escaped += '\\r';
      else if (ch === '\t') escaped += '\\t';
      else if (ch === '\u2028') escaped += '\\u2028';
      else if (ch === '\u2029') escaped += '\\u2029';
      else escaped += escapeControlChar(ch);
    }
    return `"${escaped}"`;
  }
  return name;
}

/**
 * Escape a string for use inside a double-quoted TypeScript string literal.
 */
function escapeStringLiteral(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\u2028') out += '\\u2028';
    else if (ch === '\u2029') out += '\\u2029';
    else out += escapeControlChar(ch);
  }
  return out;
}

/**
 * Escape a string for use inside a JSDoc comment.
 * Prevents premature comment closure from star-slash sequences.
 */
function escapeJsDoc(text: string): string {
  return text.replace(/\*\//g, '*\\/');
}

// ============================================================================
// json-schema-types.ts — JSON Schema → TypeScript type generation
// ============================================================================

interface JsonSchemaContext {
  root: JSONSchema7 | JSONSchema7Definition;
  depth: number;
  seen: Set<JSONSchema7 | JSONSchema7Definition>;
  maxDepth: number;
}

/**
 * Resolve an internal JSON Pointer $ref (e.g. #/definitions/Foo) against the
 * root schema. Returns null for external URLs or unresolvable paths.
 */
function resolveRef(
  ref: string,
  root: JSONSchema7 | JSONSchema7Definition
): JSONSchema7 | JSONSchema7Definition | null {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return null;
  const segments = ref
    .slice(2)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root;
  for (const seg of segments) {
    if (current === null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[seg];
    if (current === undefined) return null;
  }
  if (typeof current === 'boolean') return current;
  if (current === null || typeof current !== 'object') return null;
  return current as JSONSchema7;
}

/**
 * Apply OpenAPI 3.0 `nullable: true` to a type result.
 */
function applyNullable(result: string, schema: JSONSchema7 & { nullable?: boolean }): string {
  if (result !== 'unknown' && result !== 'never' && schema?.nullable === true) {
    return `${result} | null`;
  }
  return result;
}

/**
 * Convert a JSON Schema to a TypeScript type string.
 * This is a direct conversion without going through Zod.
 */
function jsonSchemaToTypeString(
  schema: JSONSchema7 | JSONSchema7Definition,
  indent: string,
  ctx: JsonSchemaContext
): string {
  if (typeof schema === 'boolean') return schema ? 'unknown' : 'never';
  if (ctx.depth >= ctx.maxDepth) return 'unknown';
  if (ctx.seen.has(schema)) return 'unknown';
  ctx.seen.add(schema);
  const nextCtx: JsonSchemaContext = { ...ctx, depth: ctx.depth + 1 };

  try {
    const s = schema as JSONSchema7 & { nullable?: boolean; prefixItems?: JSONSchema7[] };

    if (s.$ref) {
      const resolved = resolveRef(s.$ref, ctx.root);
      if (!resolved) return 'unknown';
      return applyNullable(jsonSchemaToTypeString(resolved, indent, nextCtx), s);
    }
    if (s.anyOf) {
      return applyNullable(
        s.anyOf.map((sub) => jsonSchemaToTypeString(sub, indent, nextCtx)).join(' | '),
        s
      );
    }
    if (s.oneOf) {
      return applyNullable(
        s.oneOf.map((sub) => jsonSchemaToTypeString(sub, indent, nextCtx)).join(' | '),
        s
      );
    }
    if (s.allOf) {
      return applyNullable(
        s.allOf.map((sub) => jsonSchemaToTypeString(sub, indent, nextCtx)).join(' & '),
        s
      );
    }
    if (s.enum) {
      if (s.enum.length === 0) return 'never';
      return applyNullable(
        s.enum
          .map((v) => {
            if (v === null) return 'null';
            if (typeof v === 'string') return '"' + escapeStringLiteral(v) + '"';
            if (typeof v === 'object') return JSON.stringify(v) ?? 'unknown';
            return String(v);
          })
          .join(' | '),
        s
      );
    }
    if (s.const !== undefined) {
      return applyNullable(
        s.const === null
          ? 'null'
          : typeof s.const === 'string'
            ? '"' + escapeStringLiteral(s.const) + '"'
            : typeof s.const === 'object'
              ? (JSON.stringify(s.const) ?? 'unknown')
              : String(s.const),
        s
      );
    }

    const type = s.type;
    if (type === 'string') return applyNullable('string', s);
    if (type === 'number' || type === 'integer') return applyNullable('number', s);
    if (type === 'boolean') return applyNullable('boolean', s);
    if (type === 'null') return 'null';

    if (type === 'array') {
      const prefixItems = s.prefixItems;
      if (Array.isArray(prefixItems)) {
        return applyNullable(
          `[${prefixItems.map((sub) => jsonSchemaToTypeString(sub, indent, nextCtx)).join(', ')}]`,
          s
        );
      }
      if (Array.isArray(s.items)) {
        return applyNullable(
          `[${s.items.map((sub) => jsonSchemaToTypeString(sub, indent, nextCtx)).join(', ')}]`,
          s
        );
      }
      if (s.items) {
        return applyNullable(
          `${jsonSchemaToTypeString(s.items as JSONSchema7Definition, indent, nextCtx)}[]`,
          s
        );
      }
      return applyNullable('unknown[]', s);
    }

    if (type === 'object' || s.properties) {
      const props = s.properties || {};
      const required = new Set(s.required || []);
      const lines: string[] = [];
      for (const [propName, propSchema] of Object.entries(props)) {
        if (typeof propSchema === 'boolean') {
          const boolType = propSchema ? 'unknown' : 'never';
          const optionalMark = required.has(propName) ? '' : '?';
          lines.push(`${indent}    ${quoteProp(propName)}${optionalMark}: ${boolType};`);
          continue;
        }
        const isRequired = required.has(propName);
        const propType = jsonSchemaToTypeString(propSchema, indent + '    ', nextCtx);
        const desc = (propSchema as JSONSchema7).description;
        const format = (propSchema as JSONSchema7).format;
        if (desc || format) {
          const descText = desc ? escapeJsDoc(desc.replace(/\r?\n/g, ' ')) : undefined;
          const formatTag = format ? `@format ${escapeJsDoc(format)}` : undefined;
          if (descText && formatTag) {
            lines.push(`${indent}    /**`);
            lines.push(`${indent}     * ${descText}`);
            lines.push(`${indent}     * ${formatTag}`);
            lines.push(`${indent}     */`);
          } else {
            lines.push(`${indent}    /** ${descText ?? formatTag} */`);
          }
        }
        const quotedName = quoteProp(propName);
        const optionalMark = isRequired ? '' : '?';
        lines.push(`${indent}    ${quotedName}${optionalMark}: ${propType};`);
      }
      if (s.additionalProperties) {
        const valueType =
          s.additionalProperties === true
            ? 'unknown'
            : jsonSchemaToTypeString(s.additionalProperties, indent + '    ', nextCtx);
        lines.push(`${indent}    [key: string]: ${valueType};`);
      }
      if (lines.length === 0) {
        if (s.additionalProperties === false) return applyNullable('{}', s);
        return applyNullable('Record<string, unknown>', s);
      }
      return applyNullable(`{\n${lines.join('\n')}\n${indent}}`, s);
    }

    if (Array.isArray(type)) {
      return applyNullable(
        type
          .map((t) => {
            if (t === 'string') return 'string';
            if (t === 'number' || t === 'integer') return 'number';
            if (t === 'boolean') return 'boolean';
            if (t === 'null') return 'null';
            if (t === 'array') return 'unknown[]';
            if (t === 'object') return 'Record<string, unknown>';
            return 'unknown';
          })
          .join(' | '),
        s
      );
    }

    return 'unknown';
  } finally {
    ctx.seen.delete(schema);
  }
}

/**
 * Convert a JSON Schema to a TypeScript type declaration.
 */
export function jsonSchemaToType(schema: JSONSchema7, typeName: string): string {
  return `type ${typeName} = ${jsonSchemaToTypeString(schema, '', {
    root: schema,
    depth: 0,
    seen: new Set(),
    maxDepth: 20,
  })}`;
}

/**
 * Extract field descriptions from a JSON Schema's properties.
 */
function extractJsonSchemaDescriptions(schema: JSONSchema7): Record<string, string> {
  const descriptions: Record<string, string> = {};
  if (schema.properties) {
    for (const [fieldName, propSchema] of Object.entries(schema.properties)) {
      if (
        propSchema &&
        typeof propSchema === 'object' &&
        (propSchema as JSONSchema7).description
      ) {
        descriptions[fieldName] = (propSchema as JSONSchema7).description!;
      }
    }
  }
  return descriptions;
}

/**
 * A tool descriptor using plain JSON Schema (no Zod or AI SDK dependency).
 */
export interface JsonSchemaToolDescriptor {
  description?: string;
  inputSchema: JSONSchema7;
  outputSchema?: JSONSchema7;
}

export type JsonSchemaToolDescriptors = Record<string, JsonSchemaToolDescriptor>;

/**
 * Generate TypeScript type definitions from tool descriptors with JSON Schema.
 * These types can be included in tool descriptions to help LLMs write correct
 * code against our `kg.*` bindings.
 *
 * This function has NO dependency on the AI SDK or Zod — it works purely with
 * JSON Schema objects.
 */
export function generateTypesFromJsonSchema(tools: JsonSchemaToolDescriptors): string {
  let availableTools = '';
  let availableTypes = '';
  for (const [toolName, tool] of Object.entries(tools)) {
    const safeName = sanitizeToolName(toolName);
    const typeName = toPascalCase(safeName);
    try {
      const inputType = jsonSchemaToType(tool.inputSchema, `${typeName}Input`);
      const outputType = tool.outputSchema
        ? jsonSchemaToType(tool.outputSchema, `${typeName}Output`)
        : `type ${typeName}Output = unknown`;
      availableTypes += `\n${inputType.trim()}`;
      availableTypes += `\n${outputType.trim()}`;
      const paramLines = (() => {
        try {
          const paramDescs = extractJsonSchemaDescriptions(tool.inputSchema);
          return Object.entries(paramDescs).map(
            ([fieldName, desc]) => `@param input.${fieldName} - ${desc}`
          );
        } catch {
          return [];
        }
      })();
      const jsdocLines: string[] = [];
      if (tool.description?.trim()) {
        jsdocLines.push(escapeJsDoc(tool.description.trim().replace(/\r?\n/g, ' ')));
      } else {
        jsdocLines.push(escapeJsDoc(toolName));
      }
      for (const pd of paramLines) jsdocLines.push(escapeJsDoc(pd.replace(/\r?\n/g, ' ')));
      const jsdocBody = jsdocLines.map((l) => `\t * ${l}`).join('\n');
      availableTools += `\n\t/**\n${jsdocBody}\n\t */`;
      availableTools += `\n\t${safeName}: (input: ${typeName}Input) => Promise<${typeName}Output>;`;
      availableTools += '\n';
    } catch {
      availableTypes += `\ntype ${typeName}Input = unknown`;
      availableTypes += `\ntype ${typeName}Output = unknown`;
      availableTools += `\n\t/**\n\t * ${escapeJsDoc(toolName)}\n\t */`;
      availableTools += `\n\t${safeName}: (input: ${typeName}Input) => Promise<${typeName}Output>;`;
      availableTools += '\n';
    }
  }
  availableTools = `\ndeclare const codemode: {${availableTools}}`;
  return `
${availableTypes}
${availableTools}
  `.trim();
}

// ============================================================================
// Executor interface (shape only — the actual QuickJS implementation will
// live in `src/sandbox/executor.ts` and implement this type)
// ============================================================================

export interface ExecuteResult {
  result: unknown;
  error?: string;
  logs?: string[];
}

export interface ResolvedProvider {
  name: string;
  fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
  positionalArgs?: boolean;
}

/**
 * An executor runs LLM-generated code in a sandbox, making the provided
 * tool functions callable under their namespace inside the sandbox.
 *
 * Implementations should never throw — errors are returned in
 * `ExecuteResult.error`.
 *
 * Our Phase 1+ implementation will be a QuickJS-backed class in
 * `src/sandbox/executor.ts`.
 */
export interface Executor {
  execute(
    code: string,
    providersOrFns:
      | ResolvedProvider[]
      | Record<string, (...args: unknown[]) => Promise<unknown>>
  ): Promise<ExecuteResult>;
}
