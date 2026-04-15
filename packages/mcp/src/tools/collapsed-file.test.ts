import { describe, expect, it } from "vitest";
import type { DiagnosticsSession } from "@featuretype/language-server";
import type { FoldingRange } from "vscode-languageserver-protocol";
import {
  COLLAPSED_FILE_KINDS,
  getCollapsedFile,
} from "./collapsed-file.js";

function createSessionMock(
  rootDir: string,
  options: {
    fileContent?: string;
    foldingRanges?: FoldingRange[];
  } = {},
): DiagnosticsSession {
  return {
    rootDir,
    tsdk: `${rootDir}/node_modules/typescript/lib`,
    getFileContent: () => options.fileContent ?? "",
    getFileFoldingRanges: async () => options.foldingRanges ?? [],
  } as unknown as DiagnosticsSession;
}

describe("getCollapsedFile", () => {
  it("collapses larger top-level code ranges while leaving non-selected kinds untouched", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        "import {",
        "  alpha,",
        "  beta,",
        '} from "./shared.js";',
        "",
        "const before = 1;",
        "",
        "export function readValue() {",
        "  const value = {",
        "    nested: true,",
        "  };",
        "",
        "  const items = [1, 2, 3];",
        "  const doubled = items.map((item) => item * 2);",
        "",
        "  if (value.nested) {",
        "    return doubled.join(\",\");",
        "  }",
        "",
        "  return value;",
        "}",
        "",
        "export const after = 2;",
        "export const finalValue = before + after;",
        "export const summary = String(finalValue);",
        "export const done = true;",
        "",
      ].join("\n"),
      foldingRanges: [
        { startLine: 0, endLine: 2, kind: "imports" },
        { startLine: 7, endLine: 18 },
        { startLine: 8, endLine: 9 },
      ],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/example.ts",
    });

    expect(snapshot.appliedKinds).toEqual(["code"]);
    expect(snapshot.collapsedRangeCount).toBe(1);
    expect(snapshot.ranges).toMatchObject([
      {
        startLine: 7,
        endLine: 18,
        hiddenLineCount: 11,
        kind: "code",
        collapsedText: "... // collapsed readValue body (11 lines)",
      },
    ]);
    expect(snapshot.text).toContain("import {\n  alpha,\n  beta,\n} from");
    expect(snapshot.text).toContain(
      "export function readValue() {\n  ... // collapsed readValue body (11 lines)\n  return value;\n}",
    );
    expect(snapshot.text).not.toContain("nested: true");
  });

  it("keeps import groups verbatim even when imports are requested", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        "import {",
        "  alpha,",
        "  beta,",
        '} from "./shared.js";',
        "",
        "export const value = alpha + beta;",
      ].join("\n"),
      foldingRanges: [{ startLine: 0, endLine: 2, kind: "imports" }],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/example.ts",
      kinds: [...COLLAPSED_FILE_KINDS.filter((kind) => kind === "imports")],
      lineNumbers: true,
    });

    expect(snapshot.collapsedRangeCount).toBe(0);
    expect(snapshot.text).toContain("1 │ import {");
    expect(snapshot.text).toContain("2 │   alpha,");
    expect(snapshot.text).toContain('4 │ } from "./shared.js";');
  });

  it("keeps grouped imports fully visible when imports are requested", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        "import {",
        "  alpha,",
        "  beta,",
        '} from "./alpha.js";',
        'import type { Gamma } from "./gamma.js";',
        "import {",
        "  delta,",
        "  epsilon,",
        '} from "./delta.js";',
        "",
        "export const value = alpha + delta;",
      ].join("\n"),
      foldingRanges: [{ startLine: 0, endLine: 8, kind: "imports" }],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/example.ts",
      kinds: ["imports"],
      lineNumbers: true,
    });

    expect(snapshot.collapsedRangeCount).toBe(0);
    expect(snapshot.text).toContain("1 │ import {");
    expect(snapshot.text).toContain("2 │   alpha,");
    expect(snapshot.text).toContain('4 │ } from "./alpha.js";');
    expect(snapshot.text).toContain('5 │ import type { Gamma } from "./gamma.js";');
    expect(snapshot.text).toContain("6 │ import {");
    expect(snapshot.text).toContain("7 │   delta,");
    expect(snapshot.text).toContain('9 │ } from "./delta.js";');
  });

  it("preserves original source line numbers after collapsing code", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        "import {",
        "  alpha,",
        "  beta,",
        '} from "./shared.js";',
        "",
        "const before = 1;",
        "",
        "export function readValue() {",
        "  const value = {",
        "    nested: true,",
        "  };",
        "",
        "  const items = [1, 2, 3];",
        "  const doubled = items.map((item) => item * 2);",
        "",
        "  if (value.nested) {",
        "    return doubled.join(\",\");",
        "  }",
        "",
        "  return value;",
        "}",
        "",
        "export const done = true;",
        "export const finalValue = before + done;",
        "",
      ].join("\n"),
      foldingRanges: [{ startLine: 7, endLine: 18 }],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/example.ts",
      lineNumbers: true,
    });

    expect(snapshot.text).toContain(" 8 │ export function readValue() {");
    expect(snapshot.text).toContain(" 9 │   ... // collapsed readValue body (11 lines)");
    expect(snapshot.text).toContain("20 │   return value;");
    expect(snapshot.text).toContain("21 │ }");
    expect(snapshot.text).toContain("23 │ export const done = true;");
  });

  it("does not collapse small code definitions by default", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        "export type AuthSession = {",
        "  userId: string;",
        "  token: string;",
        "};",
        "",
        "export function isAuthenticated(session: AuthSession | null): boolean {",
        "  return Boolean(session?.token);",
        "}",
      ].join("\n"),
      foldingRanges: [
        { startLine: 0, endLine: 2 },
        { startLine: 5, endLine: 6 },
      ],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/auth-session.ts",
      lineNumbers: true,
    });

    expect(snapshot.collapsedRangeCount).toBe(0);
    expect(snapshot.text).toContain("1 │ export type AuthSession = {");
    expect(snapshot.text).toContain("2 │   userId: string;");
    expect(snapshot.text).toContain("3 │   token: string;");
    expect(snapshot.text).toContain("6 │ export function isAuthenticated(session: AuthSession | null): boolean {");
    expect(snapshot.text).toContain("7 │   return Boolean(session?.token);");
  });

  it("keeps larger exported type definitions visible by default", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        "export interface DashboardSummary {",
        "  id: string;",
        "  title: string;",
        "  description: string;",
        "  tags: string[];",
        "  createdAt: string;",
        "  updatedAt: string;",
        "  owner: {",
        "    id: string;",
        "    name: string;",
        "  };",
        "}",
        "",
        "export type DashboardLoadState =",
        "  | { status: \"idle\" }",
        "  | { status: \"loading\" }",
        "  | { status: \"ready\"; summary: DashboardSummary }",
        "  | { status: \"error\"; message: string };",
        "",
        "export const READY_STATUS = \"ready\";",
        "export const EMPTY_SUMMARY_ID = \"root\";",
        "export const EMPTY_TITLE = \"All dashboards\";",
        "export const EMPTY_DESCRIPTION = \"\";",
      ].join("\n"),
      foldingRanges: [
        { startLine: 0, endLine: 10 },
        { startLine: 7, endLine: 9 },
        { startLine: 13, endLine: 17 },
      ],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/shapes.ts",
      lineNumbers: true,
    });

    expect(snapshot.collapsedRangeCount).toBe(0);
    expect(snapshot.text).toContain("1 │ export interface DashboardSummary {");
    expect(snapshot.text).toContain("8 │   owner: {");
    expect(snapshot.text).toContain("14 │ export type DashboardLoadState =");
    expect(snapshot.text).toContain("17 │   | { status: \"ready\"; summary: DashboardSummary }");
  });

  it("keeps small files raw even when fold ranges are available", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        "import { parseValue } from \"./parse-value.js\";",
        "",
        "export function readValue(input: string): string {",
        "  return parseValue(input);",
        "}",
        "",
      ].join("\n"),
      foldingRanges: [{ startLine: 2, endLine: 4 }],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/tiny.ts",
      lineNumbers: true,
    });

    expect(snapshot.collapsedRangeCount).toBe(0);
    expect(snapshot.text).toContain("1 │ import { parseValue } from \"./parse-value.js\";");
    expect(snapshot.text).toContain("3 │ export function readValue(input: string): string {");
    expect(snapshot.text).toContain("4 │   return parseValue(input);");
  });

  it("keeps medium single-body modules raw when collapsing would only produce one blob", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        'import { useRouter } from "@tanstack/react-router";',
        'import { useCurrentUser } from "@/providers/current-user";',
        "",
        "export function useAuth() {",
        "  const router = useRouter();",
        "  const currentUser = useCurrentUser();",
        "  const isAuthenticated = currentUser !== null;",
        "  const displayName = currentUser?.displayName ?? null;",
        "  const hasLogin = (currentUser?.login ?? \"\").length > 0;",
        "",
        "  return {",
        "    currentUser,",
        "    displayName,",
        "    hasLogin,",
        "    isAuthenticated,",
        "    navigateToSignIn: () => {",
        "      void router.navigate({ to: \"/signin\" });",
        "    },",
        "    navigateToSettings: () => {",
        "      void router.navigate({ to: \"/settings\" });",
        "    },",
        "  };",
        "}",
        "",
        "export const authLabel = \"auth\";",
        "export const authEnabled = true;",
        "export const authStatus = authEnabled ? authLabel : \"disabled\";",
        "",
      ].join("\n"),
      foldingRanges: [{ startLine: 3, endLine: 22 }],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/use-auth.ts",
      lineNumbers: true,
    });

    expect(snapshot.collapsedRangeCount).toBe(0);
    expect(snapshot.text).toContain("4 │ export function useAuth() {");
    expect(snapshot.text).toContain("11 │   return {");
    expect(snapshot.text).toContain("17 │       void router.navigate({ to: \"/signin\" });");
    expect(snapshot.text).not.toContain("collapsed useAuth body");
  });

  it("preserves one nested layer inside a monolithic top-level function", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        "import { useCallback, useEffect, useMemo, useState } from \"react\";",
        "",
        "export function DashboardPage() {",
        "  const [search, setSearch] = useState(\"\");",
        "  const [topic, setTopic] = useState<string | null>(null);",
        "",
        "  useEffect(() => {",
        "    const controller = new AbortController();",
        "    const requestId = search.length + (topic?.length ?? 0);",
        "    const shouldTrack = requestId > 0;",
        "    if (shouldTrack) {",
        "      void controller.signal;",
        "    }",
        "    return () => controller.abort();",
        "  }, [search, topic]);",
        "",
        "  const onSelectTopic = useCallback((nextTopic: string | null) => {",
        "    setTopic(nextTopic);",
        "    setSearch(nextTopic ?? \"\");",
        "    const nextValue = nextTopic ?? \"all\";",
        "    const isReset = nextTopic === null;",
        "    return isReset ? nextValue : `${nextValue}!`;",
        "  }, []);",
        "",
        "  const summary = useMemo(() => {",
        "    const topicLabel = topic ?? \"all\";",
        "    const searchLabel = search || \"empty\";",
        "    const uppercaseLabel = searchLabel.toUpperCase();",
        "    const summaryValue = `${uppercaseLabel}:${topicLabel}`;",
        "    return summaryValue;",
        "  }, [search, topic]);",
        "",
        "  return (",
        "    <section>",
        "      <div>{summary}</div>",
        "      <button onClick={() => onSelectTopic(null)}>Reset</button>",
        "      <span>{search}</span>",
        "    </section>",
        "  );",
        "}",
        "",
        "export const footer = \"done\";",
        "export const caption = footer.toUpperCase();",
        "export const stable = true;",
        "",
      ].join("\n"),
      foldingRanges: [
        { startLine: 2, endLine: 38 },
        { startLine: 6, endLine: 14 },
        { startLine: 16, endLine: 22 },
        { startLine: 24, endLine: 30 },
        { startLine: 32, endLine: 38 },
      ],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/dashboard-page.tsx",
      lineNumbers: true,
    });

    expect(snapshot.collapsedRangeCount).toBe(3);
    expect(snapshot.text).toContain(" 3 │ export function DashboardPage() {");
    expect(snapshot.text).toContain(" 7 │   useEffect(() => {");
    expect(snapshot.text).toContain(" 8 │     ... // collapsed useEffect callback (8 lines)");
    expect(snapshot.text).toContain("17 │   const onSelectTopic = useCallback((nextTopic: string | null) => {");
    expect(snapshot.text).toContain("18 │     ... // collapsed onSelectTopic callback (6 lines)");
    expect(snapshot.text).toContain("25 │   const summary = useMemo(() => {");
    expect(snapshot.text).toContain("26 │     ... // collapsed summary memo (6 lines)");
    expect(snapshot.text).toContain("33 │   return (");
    expect(snapshot.text).toContain("34 │     <section>");
    expect(snapshot.text).toContain("42 │ export const footer = \"done\";");
  });

  it("uses clearer labels for control-flow folds", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        "export function renderState(isReady: boolean) {",
        "  if (!isReady) {",
        "    const title = \"Loading\";",
        "    const subtitle = \"Hold on\";",
        "    const details = \"Preparing data\";",
        "    const status = \"pending\";",
        "    return `${title}:${subtitle}:${details}`;",
        "  }",
        "",
        "  return \"ready\";",
        "}",
        "",
        "export const done = true;",
        "export const label = String(done);",
        "export const next = done ? label : \"\";",
        "export const stable = next.length > 0;",
        "export const count = next.length;",
        "export const title = count > 0 ? \"ready\" : \"idle\";",
        "export const message = `${title}:${count}`;",
        "export const hasMessage = message.length > 0;",
        "export const uppercase = message.toUpperCase();",
        "export const finalStatus = uppercase || title;",
        "",
      ].join("\n"),
      foldingRanges: [{ startLine: 1, endLine: 7 }],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/control-flow.ts",
      lineNumbers: true,
    });

    expect(snapshot.collapsedRangeCount).toBe(1);
    expect(snapshot.text).toContain(" 2 │   if (!isReady) {");
    expect(snapshot.text).toContain(" 3 │     ... // collapsed if block (6 lines)");
  });

  it("deduplicates identical folding ranges from the provider before rendering", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        'import { useEffect } from "react";',
        "",
        "export function Example() {",
        "  useEffect(() => {",
        "    const controller = new AbortController();",
        "    const shouldTrack = true;",
        "    if (shouldTrack) {",
        "      void controller.signal;",
        "    }",
        "    return () => controller.abort();",
        "  }, []);",
        "",
        "  const footer = \"done\";",
        "  return footer;",
        "}",
        "",
        "export const after = true;",
        "export const label = String(after);",
        "export const counter = 3;",
        "export const status = counter > 0;",
        "export const result = status ? label : \"\";",
      ].join("\n"),
      foldingRanges: [
        { startLine: 3, endLine: 9 },
        { startLine: 3, endLine: 9 },
      ],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/example.tsx",
      lineNumbers: true,
    });

    expect(snapshot.collapsedRangeCount).toBe(1);
    expect(snapshot.text).toContain(" 4 │   useEffect(() => {");
    expect(snapshot.text).toContain(" 5 │     ... // collapsed useEffect callback (6 lines)");
    expect(snapshot.text).toContain("11 │   }, []);");
    expect(snapshot.text).toContain("13 │   const footer = \"done\";");
  });

  it("numbers repeated visible labels so anonymous hook folds stay distinguishable", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        'import { useEffect } from "react";',
        "",
        "export function AuthProvider() {",
        "  useEffect(() => {",
        "    const unsubscribe = subscribeAuth();",
        "    const timeout = window.setTimeout(() => unsubscribe(), 1_000);",
        "    return () => {",
        "      window.clearTimeout(timeout);",
        "      unsubscribe();",
        "    };",
        "  }, []);",
        "",
        "  useEffect(() => {",
        "    const remove = subscribeUnauthorized(() => refreshAuth());",
        "    const status = readAuthStatus();",
        "    const shouldRefresh = status === \"stale\";",
        "    if (shouldRefresh) {",
        "      refreshAuth();",
        "    }",
        "    return () => remove();",
        "  }, []);",
        "",
        "  return null;",
        "}",
        "",
        "declare function subscribeAuth(): () => void;",
        "declare function subscribeUnauthorized(listener: () => void): () => void;",
        "declare function readAuthStatus(): string;",
        "declare function refreshAuth(): void;",
      ].join("\n"),
      foldingRanges: [
        { startLine: 3, endLine: 9 },
        { startLine: 12, endLine: 19 },
      ],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/auth-provider.tsx",
      lineNumbers: true,
    });

    expect(snapshot.collapsedRangeCount).toBe(2);
    expect(snapshot.text).toContain(" 4 │   useEffect(() => {");
    expect(snapshot.text).toContain(" 5 │     ... // collapsed useEffect callback #1 (6 lines)");
    expect(snapshot.text).toContain("13 │   useEffect(() => {");
    expect(snapshot.text).toContain("14 │     ... // collapsed useEffect callback #2 (7 lines)");
  });

  it("returns the original content when no matching ranges are available", async () => {
    const session = createSessionMock("/repo", {
      fileContent: "export const value = 1;\n",
      foldingRanges: [{ startLine: 0, endLine: 2, kind: "comment" }],
    });

    const snapshot = await getCollapsedFile(session, {
      file: "src/example.ts",
    });

    expect(snapshot.collapsedRangeCount).toBe(0);
    expect(snapshot.text).toBe("export const value = 1;\n");
  });
});
