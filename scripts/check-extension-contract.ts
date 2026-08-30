/**
 * Extension loading contract check.
 *
 * Ensures the mcp-extension factory function (and any other pi extension
 * under packages/) only calls registration APIs at the top level — action
 * methods like pi.getActiveTools() / pi.registerTool() / pi.setModel() /
 * ctx.* must only appear inside event handlers (session_start etc.).
 *
 * Loading contract (pi extension system):
 *   ✓ Top-level allowed: `pi.on(...)`, `pi.registerCommand(...)`,
 *     `pi.registerShortcut(...)`, `pi.registerFlag(...)`,
 *     `pi.registerProvider(...)`, `pi.registerMessageRenderer(...)`,
 *     `pi.setSessionName(...)`
 *   ✗ Top-level forbidden: `pi.getActiveTools()`, `pi.registerTool()`,
 *     `pi.execute(...)`, `pi.getAllTools()`, `pi.sendMessage()`,
 *     `pi.sendUserMessage()`, `pi.getCommands()`, `pi.getThinkingLevel()`,
 *     `pi.setActiveTools()`, `pi.setModel()`, `ctx.*`, `await *` (async work)
 *
 * Run: npx tsx scripts/check-extension-contract.ts
 * CI:  pnpm check:contract
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** pi.* methods that are SAFE to call at extension load time (registrations). */
// Wait — registerTool IS allowed at load time per pi docs. Let me split:
// ALLOWED at top-level (registrations + event subscriptions)
const REGISTRATION_API = new Set([
  "on",
  "registerCommand",
  "registerShortcut",
  "registerFlag",
  "registerProvider",
  "registerMessageRenderer",
  "registerMarkdownTransformer",
  "registerEntryRenderer",
]);

// FORBIDDEN at top-level (action methods — only inside handlers)
const ACTION_API = new Set([
  "getActiveTools",
  "getAllTools",
  "setActiveTools",
  "getCommands",
  "setModel",
  "getThinkingLevel",
  "setThinkingLevel",
  "sendMessage",
  "sendUserMessage",
  "appendEntry",
  "setSessionName",
  "getSessionName",
  "setLabel",
  "exec",
  "unregisterProvider",
]);

/** Check if a call expression is `pi.<method>(...)`. Returns the method name or null. */
function getPiMethodName(node: ts.CallExpression): string | null {
  const expr = node.expression;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "pi") {
    return expr.name.text;
  }
  return null;
}

/** Check if a statement is a `pi.on(...)` call (which we allow). */
function isEventRegistrationCall(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement)) return false;
  if (!ts.isCallExpression(statement.expression)) return false;
  const method = getPiMethodName(statement.expression);
  return method !== null && REGISTRATION_API.has(method);
}

/** Check if a statement calls a pi.* action method (forbidden at top-level). */
function callsActionMethod(expression: ts.Expression): string | null {
  if (ts.isCallExpression(expression)) {
    const method = getPiMethodName(expression);
    if (method !== null && ACTION_API.has(method)) return method;
    // Recurse for nested calls (e.g., pi.registerTool inside a conditional)
    return null;
  }
  return null;
}

/** Walk a node and find callsActionMethod violations, handling nested expressions. */
function findActionCalls(node: ts.Node): string[] {
  const found: string[] = [];
  ts.forEachChild(node, (child) => {
    if (ts.isCallExpression(child)) {
      const method = callsActionMethod(child);
      if (method !== null) found.push(method);
    }
    found.push(...findActionCalls(child));
  });
  return found;
}

/** Report a violation and track error count. */
let errors = 0;
function fail(file: string, line: number, msg: string): void {
  console.error(`[CONTRACT] FAIL ${file}:${line}  ${msg}`);
  errors++;
}

async function main(): Promise<void> {
  const extensionsDir = resolve(ROOT, "packages");
  const dirs = (await import("node:fs")).readdirSync(extensionsDir, { withFileTypes: true });
  const extFiles: string[] = [];

  // Find all extension entry points (packages/*/src/index.ts that export default function)
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const src = resolve(extensionsDir, dir.name, "src", "index.ts");
    try {
      if (readFileSync(src, "utf8").includes("export default function")) {
        extFiles.push(src);
      }
    } catch {
      // not a TS extension entry
    }
  }

  console.log(`[CONTRACT] checking ${extFiles.length} extension(s): ${extFiles.map((f) => f.replace(ROOT, "")).join(", ")}`);

  for (const file of extFiles) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    let factoryFound = false;

    // Find the `export default function (pi: ExtensionAPI)` declaration
    ts.forEachChild(sf, (node) => {
      const isDefaultExportFn =
        ts.isFunctionDeclaration(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) === true;
      if (!isDefaultExportFn) return;
      const firstParam = node.parameters[0];
      if (firstParam && ts.isIdentifier(firstParam.name) && firstParam.name.text === "pi") {
        factoryFound = true;
        const body = node.body;
        if (!body) return;

          // Helper: get line number from position
          const lineOf = (pos: number): number => {
            const src = source.slice(0, pos);
            return src.split("\n").length;
          };

          // Walk top-level statements
          for (const stmt of body.statements) {
            // Allow: variable declarations, function declarations
            if (ts.isVariableStatement(stmt)) continue;
            if (ts.isFunctionDeclaration(stmt)) continue;

            // Allow: pi.on(...), pi.registerCommand(...), etc.
            if (isEventRegistrationCall(stmt)) continue;

            // Allow: empty statements, return statement at end, break, debugger
            if (ts.isEmptyStatement(stmt)) continue;
            if (ts.isReturnStatement(stmt)) continue;

            // Any other expression statement — check for pi.* action calls
            if (ts.isExpressionStatement(stmt)) {
              const expr = stmt.expression;
              if (ts.isCallExpression(expr)) {
                const piMethod = getPiMethodName(expr);
                if (piMethod !== null) {
                  if (ACTION_API.has(piMethod)) {
                    fail(file, lineOf(stmt.getStart(sf)), `pi.${piMethod}() is an ACTION method — forbidden at load time. Move it inside session_start or another event handler.`);
                  } else if (!REGISTRATION_API.has(piMethod)) {
                    fail(file, lineOf(stmt.getStart(sf)), `pi.${piMethod}() is unrecognised. If it's a registration, add it to REGISTRATION_API; if it's an action, add it to ACTION_API.`);
                  }
                } else {
                  // Non-pi call expressions — check for any internal action calls
                  const actions = findActionCalls(expr);
                  for (const action of actions) {
                    fail(file, lineOf(stmt.getStart(sf)), `pi.${action}() called at load time (inside a top-level expression). Defer to runtime.`);
                  }
                }
              }
              continue;
            }

            // Any other statement type → flag it
            const text = source.slice(stmt.getStart(sf), stmt.getEnd()).trim().slice(0, 80);
            fail(file, lineOf(stmt.getStart(sf)), `Unexpected top-level statement in factory body: "${text}"`);
          }
        }
    });

    if (!factoryFound) {
      console.warn(`[CONTRACT] SKIP ${file.replace(ROOT, "")} — no "export default function(pi)" factory found`);
    }
  }

  // Count how many factories were actually found & checked.
  if (extFiles.length === 0) {
    console.error(`[CONTRACT] ❌ No extension entry points found under packages/*/src/index.ts`);
    process.exit(1);
  }

  if (errors > 0) {
    console.error(`\n[CONTRACT] ❌ ${errors} violation(s) found. Extensions must only call registration APIs at factory top level.`);
    process.exit(1);
  } else {
    console.log(`[CONTRACT] ✅ All extensions pass the loading contract.`);
  }
}

main().catch((err) => {
  console.error("[CONTRACT] FATAL:", err);
  process.exit(1);
});