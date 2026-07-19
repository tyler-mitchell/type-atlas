import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnnotatedTextEdit,
  ChangeAnnotation,
  CreateFile,
  TextDocumentEdit,
  type WorkspaceEdit,
} from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import {
  compileWorkspaceOperations,
  executeWorkspaceEdit,
  readWorkspaceFile,
  withWorkspaceEditTransaction,
} from "./workspace-edit.js";

const temporaryRoots: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "featuretype-workspace-edit-"));
  temporaryRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("workspace edit execution", () => {
  it("compiles and applies an ordered multi-file agent edit", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(root, "b.ts"), "export const b = 2;\n");
    const bRevision = (await readWorkspaceFile(root, "b.ts")).snapshot.revision;
    const compiled = await compileWorkspaceOperations(root, [
      { kind: "replace", file: "a.ts", oldText: "a = 1", newText: "a = 3" },
      { kind: "create", file: "c.ts", content: "export const c = 4;\n" },
      {
        kind: "move",
        oldFile: "b.ts",
        newFile: "nested/d.ts",
        ifMatch: bRevision,
      },
    ]);

    const result = await executeWorkspaceEdit(root, compiled.edit, {
      expectedRevisions: compiled.expectedRevisions,
    });

    expect(result.status).toBe("applied");
    expect(await readFile(path.join(root, "a.ts"), "utf8"))
      .toBe("export const a = 3;\n");
    expect(await readFile(path.join(root, "c.ts"), "utf8"))
      .toBe("export const c = 4;\n");
    expect(await readFile(path.join(root, "nested/d.ts"), "utf8"))
      .toBe("export const b = 2;\n");
    await expect(readFile(path.join(root, "b.ts"), "utf8")).rejects.toThrow();
  });

  it("rejects stale agent intent before mutating any file", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "a.ts"), "a\n");
    const compiled = await compileWorkspaceOperations(root, [
      { kind: "replace", file: "a.ts", oldText: "a", newText: "planned" },
      { kind: "create", file: "new.ts", content: "new\n" },
    ]);

    await writeFile(path.join(root, "a.ts"), "external\n");
    await expect(executeWorkspaceEdit(root, compiled.edit, {
      expectedRevisions: compiled.expectedRevisions,
    })).rejects.toThrow("Revision conflict");
    expect(await readFile(path.join(root, "a.ts"), "utf8")).toBe("external\n");
    await expect(readFile(path.join(root, "new.ts"), "utf8")).rejects.toThrow();
  });

  it("treats permission changes as revision conflicts", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    await writeFile(file, "a\n");
    await chmod(file, 0o644);
    const compiled = await compileWorkspaceOperations(root, [
      { kind: "replace", file: "a.ts", oldText: "a", newText: "b" },
    ]);
    await chmod(file, 0o600);

    await expect(executeWorkspaceEdit(root, compiled.edit, {
      expectedRevisions: compiled.expectedRevisions,
    })).rejects.toThrow("Revision conflict");
    expect(await readFile(file, "utf8")).toBe("a\n");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("previews without writing or retaining server state", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    await writeFile(file, "a\n");
    const compiled = await compileWorkspaceOperations(root, [
      { kind: "replace", file: "a.ts", oldText: "a", newText: "b" },
    ]);

    const result = await executeWorkspaceEdit(root, compiled.edit, {
      mode: "preview",
      expectedRevisions: compiled.expectedRevisions,
    });

    expect(result.status).toBe("preview");
    expect(result.preview).toContain("+b");
    expect(await readFile(file, "utf8")).toBe("a\n");
  });

  it("prefers documentChanges over changes", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    const uri = URI.file(file).toString();
    await writeFile(file, "a\n");
    const edit: WorkspaceEdit = {
      changes: {
        [uri]: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          newText: "wrong",
        }],
      },
      documentChanges: [TextDocumentEdit.create(
        { uri, version: null },
        [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          newText: "right",
        }],
      )],
    };

    await executeWorkspaceEdit(root, edit);
    expect(await readFile(file, "utf8")).toBe("right\n");
  });

  it("preserves same-position insertion order", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    const uri = URI.file(file).toString();
    await writeFile(file, "end\n");

    await executeWorkspaceEdit(root, {
      changes: {
        [uri]: [
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "first-" },
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "second-" },
        ],
      },
    });

    expect(await readFile(file, "utf8")).toBe("first-second-end\n");
  });

  it("delegates overlapping edit rejection without mutating the file", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    const uri = URI.file(file).toString();
    await writeFile(file, "abcd\n");

    await expect(executeWorkspaceEdit(root, {
      changes: {
        [uri]: [
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, newText: "first" },
          { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, newText: "second" },
        ],
      },
    })).rejects.toThrow("Overlapping edit");

    expect(await readFile(file, "utf8")).toBe("abcd\n");
  });

  it("preserves ordered create-then-edit semantics", async () => {
    const root = await createRoot();
    const file = path.join(root, "created.ts");
    const uri = URI.file(file).toString();
    await executeWorkspaceEdit(root, {
      documentChanges: [
        CreateFile.create(uri),
        TextDocumentEdit.create(
          { uri, version: null },
          [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: "export const created = true;\n",
          }],
        ),
      ],
    });
    expect(await readFile(file, "utf8"))
      .toBe("export const created = true;\n");
  });

  it("preserves ordered rename-then-edit semantics", async () => {
    const root = await createRoot();
    const oldFile = path.join(root, "old.ts");
    const newFile = path.join(root, "new.ts");
    const oldUri = URI.file(oldFile).toString();
    const newUri = URI.file(newFile).toString();
    await writeFile(oldFile, "old\n");

    await executeWorkspaceEdit(root, {
      documentChanges: [
        { kind: "rename", oldUri, newUri },
        TextDocumentEdit.create(
          { uri: newUri, version: null },
          [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            newText: "new",
          }],
        ),
      ],
    });

    await expect(readFile(oldFile, "utf8")).rejects.toThrow();
    expect(await readFile(newFile, "utf8")).toBe("new\n");
  });

  it("requires confirmation for annotated changes", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    const uri = URI.file(file).toString();
    await writeFile(file, "a\n");
    const annotationId = "breaking";
    const edit: WorkspaceEdit = {
      changeAnnotations: {
        [annotationId]: ChangeAnnotation.create("Breaking change", true),
      },
      documentChanges: [TextDocumentEdit.create(
        { uri, version: null },
        [AnnotatedTextEdit.replace(
          { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          "b",
          annotationId,
        )],
      )],
    };

    const preview = await executeWorkspaceEdit(root, edit, { mode: "preview" });
    expect(preview.status).toBe("preview");
    expect(await readFile(file, "utf8")).toBe("a\n");
    await expect(executeWorkspaceEdit(root, edit)).rejects.toThrow("requires confirmation");
    await executeWorkspaceEdit(root, edit, { confirm: true });
    expect(await readFile(file, "utf8")).toBe("b\n");
  });

  it("rejects edits that reference missing change annotations", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    const uri = URI.file(file).toString();
    await writeFile(file, "a\n");

    await expect(executeWorkspaceEdit(root, {
      documentChanges: [TextDocumentEdit.create(
        { uri, version: null },
        [AnnotatedTextEdit.replace(
          { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          "b",
          "missing",
        )],
      )],
    })).rejects.toThrow("missing change annotation");
    expect(await readFile(file, "utf8")).toBe("a\n");
  });

  it("lets overwrite take precedence over ignoreIfExists", async () => {
    const root = await createRoot();
    const source = path.join(root, "source.ts");
    const destination = path.join(root, "destination.ts");
    await writeFile(source, "source\n");
    await writeFile(destination, "destination\n");

    await executeWorkspaceEdit(root, {
      documentChanges: [{
        kind: "rename",
        oldUri: URI.file(source).toString(),
        newUri: URI.file(destination).toString(),
        options: { overwrite: true, ignoreIfExists: true },
      }],
    });

    await expect(readFile(source, "utf8")).rejects.toThrow();
    expect(await readFile(destination, "utf8")).toBe("source\n");
  });

  it("preserves the source inode and mode for a physical rename", async () => {
    const root = await createRoot();
    const source = path.join(root, "source.ts");
    const destination = path.join(root, "nested/destination.ts");
    await writeFile(source, "source\n");
    await chmod(source, 0o744);
    const before = await stat(source);
    const revision = (await readWorkspaceFile(root, "source.ts")).snapshot.revision;
    const compiled = await compileWorkspaceOperations(root, [{
      kind: "move",
      oldFile: "source.ts",
      newFile: "nested/destination.ts",
      ifMatch: revision,
    }]);

    await executeWorkspaceEdit(root, compiled.edit, {
      expectedRevisions: compiled.expectedRevisions,
    });

    const after = await stat(destination);
    expect(after.ino).toBe(before.ino);
    expect(after.mode & 0o777).toBe(0o744);
  });

  it("lets the process umask determine permissions for new files", async () => {
    const root = await createRoot();
    const previousUmask = process.umask(0o077);
    try {
      const compiled = await compileWorkspaceOperations(root, [{
        kind: "create",
        file: "private.ts",
        content: "private\n",
      }]);
      await executeWorkspaceEdit(root, compiled.edit, {
        expectedRevisions: compiled.expectedRevisions,
      });
      expect((await stat(path.join(root, "private.ts"))).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(previousUmask);
    }
  });

  it("rejects non-UTF-8 source files without mutation", async () => {
    const root = await createRoot();
    const file = path.join(root, "binary.ts");
    const bytes = Uint8Array.from([0xff, 0xfe, 0xfd]);
    await writeFile(file, bytes);

    await expect(compileWorkspaceOperations(root, [{
      kind: "replace",
      file: "binary.ts",
      oldText: "x",
      newText: "y",
    }])).rejects.toThrow();
    expect(await readFile(file)).toEqual(Buffer.from(bytes));
  });

  it("rejects edit text that cannot round-trip through UTF-8", async () => {
    const root = await createRoot();
    await expect(compileWorkspaceOperations(root, [{
      kind: "create",
      file: "invalid.ts",
      content: "\ud800",
    }])).rejects.toThrow("well-formed UTF-8");
    await expect(readFile(path.join(root, "invalid.ts"))).rejects.toThrow();
  });

  it("reports refresh failures after a successful commit", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    await writeFile(file, "a\n");
    const compiled = await compileWorkspaceOperations(root, [{
      kind: "replace",
      file: "a.ts",
      oldText: "a",
      newText: "b",
    }]);

    const result = await executeWorkspaceEdit(root, compiled.edit, {
      onFilesChanged: async () => {
        throw new Error("refresh unavailable");
      },
    });

    expect(result.status).toBe("applied");
    expect(result.warnings).toEqual([
      "Files were committed, but the language-server refresh failed: refresh unavailable",
    ]);
    expect(await readFile(file, "utf8")).toBe("b\n");
  });

  it("rolls back files and newly created parent directories", async () => {
    const root = await createRoot();
    const firstUri = URI.file(path.join(root, "nested/first.ts")).toString();
    const blockedUri = URI.file(path.join(root, "blocked/second.ts")).toString();

    await expect(executeWorkspaceEdit(root, {
      documentChanges: [CreateFile.create(firstUri), CreateFile.create(blockedUri)],
    }, {
      onProgress: async (phase) => {
        if (phase === "committing") await writeFile(path.join(root, "blocked"), "external\n");
      },
    })).rejects.toThrow("not a directory");

    await expect(stat(path.join(root, "nested"))).rejects.toThrow();
    expect(await readFile(path.join(root, "blocked"), "utf8")).toBe("external\n");
  });

  it("cancels while waiting for the workspace mutation lock", async () => {
    const root = await createRoot();
    let releaseFirst = (): void => undefined;
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const blocker = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withWorkspaceEditTransaction(root, undefined, async () => {
      markStarted();
      await blocker;
    });
    await started;
    const controller = new AbortController();
    const waiting = withWorkspaceEditTransaction(root, controller.signal, async () => undefined);
    controller.abort(new Error("cancelled while waiting"));

    await expect(waiting).rejects.toThrow("cancelled while waiting");
    releaseFirst();
    await first;
  });

  it("checks versioned document edits", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    const uri = URI.file(file).toString();
    await writeFile(file, "a\n");
    const edit: WorkspaceEdit = {
      documentChanges: [TextDocumentEdit.create(
        { uri, version: 2 },
        [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          newText: "b",
        }],
      )],
    };

    await expect(executeWorkspaceEdit(root, edit, {
      getDocumentVersion: () => 3,
    })).rejects.toThrow("Document version conflict");
    expect(await readFile(file, "utf8")).toBe("a\n");
  });

  it("honors cancellation before commit", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    await writeFile(file, "a\n");
    const compiled = await compileWorkspaceOperations(root, [
      { kind: "replace", file: "a.ts", oldText: "a", newText: "b" },
    ]);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(executeWorkspaceEdit(root, compiled.edit, {
      signal: controller.signal,
    })).rejects.toThrow("cancelled");
    expect(await readFile(file, "utf8")).toBe("a\n");
  });

  it("enforces managed Codex write grants", async () => {
    const root = await createRoot();
    const file = path.join(root, "a.ts");
    await writeFile(file, "a\n");
    const compiled = await compileWorkspaceOperations(root, [
      { kind: "replace", file: "a.ts", oldText: "a", newText: "b" },
    ]);
    const requestMeta = {
      "codex/sandbox-state-meta": {
        sandboxCwd: root,
        permissionProfile: {
          type: "managed",
          file_system: {
            type: "restricted",
            entries: [{
              path: { type: "special", value: { kind: "root" } },
              access: "read",
            }],
          },
        },
      },
    };

    await expect(executeWorkspaceEdit(root, compiled.edit, { requestMeta }))
      .rejects.toThrow("does not grant write access");
    expect(await readFile(file, "utf8")).toBe("a\n");
  });

  it("rejects paths that traverse a symbolic-link parent", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    await writeFile(path.join(outside, "outside.ts"), "outside\n");
    await symlink(outside, path.join(root, "linked"));

    await expect(compileWorkspaceOperations(root, [{
      kind: "replace",
      file: "linked/outside.ts",
      oldText: "outside",
      newText: "escaped",
    }])).rejects.toThrow("cannot traverse symbolic links");
    expect(await readFile(path.join(outside, "outside.ts"), "utf8"))
      .toBe("outside\n");
  });
});
