import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTwoFilesPatch } from "diff";
import {
  CreateFile,
  DeleteFile,
  RenameFile,
  TextDocumentEdit,
  type AnnotatedTextEdit,
  type ChangeAnnotation,
  type TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";

const SANDBOX_STATE_META_KEY = "codex/sandbox-state-meta";
const PROTECTED_METADATA_NAMES = new Set([".git", ".agents", ".codex"]);
const rootLocks = new Map<string, Promise<void>>();

export const MISSING_REVISION = "missing";

export type WorkspaceEditOperation =
  | {
      kind: "replace";
      file: string;
      oldText: string;
      newText: string;
      expectedOccurrences?: number;
    }
  | {
      kind: "write";
      file: string;
      content: string;
      ifMatch: string;
    }
  | {
      kind: "create";
      file: string;
      content: string;
    }
  | {
      kind: "move";
      oldFile: string;
      newFile: string;
      ifMatch: string;
      overwrite?: boolean;
    }
  | {
      kind: "delete";
      file: string;
      ifMatch: string;
    };

export type FileSnapshot = {
  content: string | null;
  mode: number | null;
  revision: string;
};

export type PreparedWorkspaceEdit = {
  root: string;
  before: ReadonlyMap<string, FileSnapshot>;
  after: ReadonlyMap<string, FileSnapshot>;
  files: readonly string[];
  preview: string;
  annotations: readonly (ChangeAnnotation & { id: string })[];
  steps: readonly MaterializedWorkspaceStep[];
};

export type WorkspaceEditResult = {
  status: "preview" | "applied";
  files: readonly string[];
  preview: string;
  annotations: readonly (ChangeAnnotation & { id: string })[];
  warnings: readonly string[];
};

export type WorkspaceEditExecutionOptions = {
  mode?: "preview" | "apply";
  requestMeta?: unknown;
  signal?: AbortSignal;
  confirm?: boolean;
  expectedRevisions?: ReadonlyMap<string, string>;
  getDocumentVersion?: (file: string) => number | null | undefined;
  onFilesChanged?: (root: string, files: readonly string[]) => Promise<void>;
  onProgress?: (phase: "preparing" | "committing" | "refreshing") => Promise<void>;
};

type MutableWorkspace = {
  root: string;
  before: Map<string, FileSnapshot>;
  current: Map<string, FileSnapshot>;
  steps: MaterializedWorkspaceStep[];
};

type MaterializedWorkspaceStep =
  | { kind: "text"; file: string; snapshot: FileSnapshot }
  | { kind: "create"; file: string; change: CreateFile }
  | { kind: "rename"; oldFile: string; newFile: string; change: RenameFile }
  | { kind: "delete"; file: string; change: DeleteFile };

type SandboxEntry = {
  access?: unknown;
  path?: unknown;
};

type Rollback = () => Promise<void>;

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Workspace edit cancelled.");
  }
};

const revisionForSnapshot = (content: string, mode: number | null): string =>
  `sha256:${createHash("sha256").update(`${mode ?? "new"}\0${content}`).digest("hex")}`;

const assertUtf8RoundTrip = (content: string): void => {
  const encoded = new TextEncoder().encode(content);
  const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(encoded);
  if (decoded !== content) {
    throw new Error("Workspace edits require well-formed UTF-8 text.");
  }
};

export const createSnapshot = (
  content: string | null,
  mode: number | null = null,
): FileSnapshot => {
  if (content !== null) assertUtf8RoundTrip(content);
  return {
    content,
    mode: content === null ? null : mode,
    revision: content === null ? MISSING_REVISION : revisionForSnapshot(content, mode),
  };
};

const isInside = (base: string, target: string): boolean => {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
};

export const resolveWorkspacePath = (root: string, file: string): string => {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, file);
  if (!isInside(resolvedRoot, resolved) || resolved === resolvedRoot) {
    throw new Error(`Edit path must be a file inside the attached root: ${file}`);
  }
  return resolved;
};

export const relativeWorkspacePath = (root: string, file: string): string =>
  path.relative(path.resolve(root), resolveWorkspacePath(root, file));

export const assertWorkspacePathSafe = async (
  root: string,
  file: string,
): Promise<void> => {
  const resolvedRoot = path.resolve(root);
  const absolute = resolveWorkspacePath(resolvedRoot, file);
  const components = path.relative(resolvedRoot, absolute).split(path.sep);
  let current = resolvedRoot;
  for (const [index, component] of components.entries()) {
    current = path.join(current, component);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Workspace edit paths cannot traverse symbolic links: ${file}`);
      }
      if (index < components.length - 1 && !stat.isDirectory()) {
        throw new Error(`Workspace edit path component is not a directory: ${current}`);
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
};

export const readWorkspaceSnapshot = async (
  root: string,
  file: string,
): Promise<FileSnapshot> => {
  const absolute = resolveWorkspacePath(root, file);
  await assertWorkspacePathSafe(root, file);
  try {
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`Editing symbolic links is not supported: ${file}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Edit path is not a regular file: ${file}`);
    }
    const bytes = await fs.readFile(absolute);
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return createSnapshot(content, stat.mode);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return createSnapshot(null);
    }
    throw error;
  }
};

export const readWorkspaceFile = async (
  root: string,
  file: string,
): Promise<{ file: string; snapshot: FileSnapshot }> => {
  const relative = relativeWorkspacePath(root, file);
  const snapshot = await readWorkspaceSnapshot(root, relative);
  if (snapshot.content === null) {
    throw new Error(`File does not exist: ${relative}`);
  }
  return { file: relative, snapshot };
};

const getSnapshot = async (
  state: MutableWorkspace,
  file: string,
): Promise<FileSnapshot> => {
  const relative = relativeWorkspacePath(state.root, file);
  const current = state.current.get(relative);
  if (current) return current;
  const original = await readWorkspaceSnapshot(state.root, relative);
  state.before.set(relative, original);
  state.current.set(relative, original);
  return original;
};

const setSnapshot = async (
  state: MutableWorkspace,
  file: string,
  snapshot: FileSnapshot,
): Promise<void> => {
  const relative = relativeWorkspacePath(state.root, file);
  if (!state.before.has(relative)) {
    state.before.set(relative, await readWorkspaceSnapshot(state.root, relative));
  }
  state.current.set(relative, snapshot);
};

const requireContent = (file: string, snapshot: FileSnapshot): string => {
  if (snapshot.content === null) throw new Error(`File does not exist: ${file}`);
  return snapshot.content;
};

const fileFromUri = (root: string, uri: string): string => {
  const parsed = URI.parse(uri);
  if (parsed.scheme !== "file") {
    throw new Error(`Only file: WorkspaceEdit URIs are supported: ${uri}`);
  }
  return relativeWorkspacePath(root, parsed.fsPath);
};

const documentFor = (root: string, file: string, content: string): TextDocument =>
  TextDocument.create(
    URI.file(resolveWorkspacePath(root, file)).toString(),
    "plaintext",
    0,
    content,
  );

const annotationIds = (edit: WorkspaceEdit): Set<string> => {
  const ids = new Set<string>();
  for (const change of edit.documentChanges ?? []) {
    if ("annotationId" in change && typeof change.annotationId === "string") {
      ids.add(change.annotationId);
    }
    if (TextDocumentEdit.is(change)) {
      for (const textEdit of change.edits) {
        if ("annotationId" in textEdit && typeof textEdit.annotationId === "string") {
          ids.add(textEdit.annotationId);
        }
      }
    }
  }
  return ids;
};

export const getWorkspaceEditAnnotations = (
  edit: WorkspaceEdit,
): (ChangeAnnotation & { id: string })[] => [...annotationIds(edit)].map((id) => {
    const annotation = edit.changeAnnotations?.[id];
    if (!annotation) {
      throw new Error(`Workspace edit references missing change annotation: ${id}`);
    }
    return { id, ...annotation };
  });

const applyTextDocumentEdit = async (
  state: MutableWorkspace,
  change: ReturnType<typeof TextDocumentEdit.create>,
  getDocumentVersion?: WorkspaceEditExecutionOptions["getDocumentVersion"],
): Promise<void> => {
  const file = fileFromUri(state.root, change.textDocument.uri);
  const expectedVersion = change.textDocument.version;
  if (expectedVersion !== null && expectedVersion >= 0 && getDocumentVersion) {
    const actualVersion = getDocumentVersion(file);
    if (actualVersion !== undefined && actualVersion !== null && actualVersion !== expectedVersion) {
      throw new Error(
        `Document version conflict for ${file}: expected ${expectedVersion}, found ${actualVersion}.`,
      );
    }
  }
  const snapshot = await getSnapshot(state, file);
  const content = requireContent(file, snapshot);
  const document = documentFor(state.root, file, content);
  const next = TextDocument.applyEdits(
    document,
    [...change.edits] as (TextEdit | AnnotatedTextEdit)[],
  );
  const nextSnapshot = createSnapshot(next, snapshot.mode);
  if (nextSnapshot.revision === snapshot.revision) return;
  await setSnapshot(state, file, nextSnapshot);
  state.steps.push({ kind: "text", file, snapshot: nextSnapshot });
};

const applyResourceOperation = async (
  state: MutableWorkspace,
  change: CreateFile | RenameFile | DeleteFile,
): Promise<void> => {
  if (CreateFile.is(change)) {
    const file = fileFromUri(state.root, change.uri);
    const current = await getSnapshot(state, file);
    if (current.content !== null) {
      if (change.options?.overwrite !== true && change.options?.ignoreIfExists) return;
      if (change.options?.overwrite !== true) {
        throw new Error(`WorkspaceEdit create target already exists: ${file}`);
      }
    }
    await setSnapshot(state, file, createSnapshot(""));
    state.steps.push({ kind: "create", file, change });
    return;
  }
  if (RenameFile.is(change)) {
    const oldFile = fileFromUri(state.root, change.oldUri);
    const newFile = fileFromUri(state.root, change.newUri);
    const source = await getSnapshot(state, oldFile);
    requireContent(oldFile, source);
    const destination = await getSnapshot(state, newFile);
    const sameFile = destination.content !== null && await pathsResolveToSameFile(
      resolveWorkspacePath(state.root, oldFile),
      resolveWorkspacePath(state.root, newFile),
    );
    if (destination.content !== null && !sameFile) {
      if (change.options?.overwrite !== true && change.options?.ignoreIfExists) return;
      if (change.options?.overwrite !== true) {
        throw new Error(`WorkspaceEdit rename target already exists: ${newFile}`);
      }
    }
    await setSnapshot(state, oldFile, createSnapshot(null));
    await setSnapshot(state, newFile, source);
    state.steps.push({ kind: "rename", oldFile, newFile, change });
    return;
  }
  if (!DeleteFile.is(change)) {
    throw new Error(`Unsupported WorkspaceEdit resource operation: ${JSON.stringify(change)}`);
  }
  const file = fileFromUri(state.root, change.uri);
  const current = await getSnapshot(state, file);
  if (current.content === null) {
    if (change.options?.ignoreIfNotExists) return;
    throw new Error(`WorkspaceEdit delete target does not exist: ${file}`);
  }
  if (change.options?.recursive) {
    throw new Error("Recursive directory deletion is outside the text-editing contract.");
  }
  await setSnapshot(state, file, createSnapshot(null));
  state.steps.push({ kind: "delete", file, change });
};

const renderPreview = (
  before: ReadonlyMap<string, FileSnapshot>,
  after: ReadonlyMap<string, FileSnapshot>,
): string => [...after.keys()]
  .sort()
  .map((file) => createTwoFilesPatch(
    before.get(file)?.content === null ? "/dev/null" : `a/${file}`,
    after.get(file)?.content === null ? "/dev/null" : `b/${file}`,
    before.get(file)?.content ?? "",
    after.get(file)?.content ?? "",
    "before",
    "after",
    { context: 3 },
  ).trimEnd())
  .join("\n\n");

export const prepareWorkspaceEdit = async (
  root: string,
  edit: WorkspaceEdit,
  options: Pick<
    WorkspaceEditExecutionOptions,
    "signal" | "confirm" | "expectedRevisions" | "getDocumentVersion"
  > = {},
): Promise<PreparedWorkspaceEdit> => {
  throwIfAborted(options.signal);
  const annotations = getWorkspaceEditAnnotations(edit);
  const state: MutableWorkspace = {
    root: path.resolve(root),
    before: new Map(),
    current: new Map(),
    steps: [],
  };
  for (const [file, expected] of options.expectedRevisions ?? []) {
    const snapshot = await getSnapshot(state, file);
    if (snapshot.revision !== expected) {
      throw new Error(
        `Revision conflict for ${file}: expected ${expected}, found ${snapshot.revision}.`,
      );
    }
  }
  if (edit.documentChanges !== undefined) {
    for (const change of edit.documentChanges) {
      throwIfAborted(options.signal);
      if (TextDocumentEdit.is(change)) {
        await applyTextDocumentEdit(state, change, options.getDocumentVersion);
      } else {
        await applyResourceOperation(state, change);
      }
    }
  } else {
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
      throwIfAborted(options.signal);
      await applyTextDocumentEdit(
        state,
        TextDocumentEdit.create({ uri, version: null }, edits),
        options.getDocumentVersion,
      );
    }
  }
  const after = new Map(
    [...state.current].filter(([file, snapshot]) =>
      state.before.get(file)?.revision !== snapshot.revision
    ),
  );
  if (after.size === 0) throw new Error("The requested edit produced no changes.");
  const files = new Set(after.keys());
  for (const step of state.steps) {
    if (step.kind === "rename") {
      files.add(step.oldFile);
      files.add(step.newFile);
    } else {
      files.add(step.file);
    }
  }
  const before = new Map([...state.before].filter(([file]) => files.has(file)));
  return {
    root: state.root,
    before,
    after,
    files: [...files].sort(),
    preview: renderPreview(before, after),
    annotations,
    steps: state.steps,
  };
};

const countOccurrences = (text: string, search: string): number => {
  if (search.length === 0) throw new Error("replace.oldText must not be empty.");
  let count = 0;
  let offset = 0;
  while (offset <= text.length - search.length) {
    const next = text.indexOf(search, offset);
    if (next < 0) break;
    count += 1;
    offset = next + search.length;
  }
  return count;
};

export const compileWorkspaceOperations = async (
  root: string,
  operations: readonly WorkspaceEditOperation[],
  signal?: AbortSignal,
): Promise<{ edit: WorkspaceEdit; expectedRevisions: ReadonlyMap<string, string> }> => {
  if (operations.length === 0) {
    throw new Error("edit_workspace requires at least one operation.");
  }
  const state: MutableWorkspace = {
    root: path.resolve(root),
    before: new Map(),
    current: new Map(),
    steps: [],
  };
  const documentChanges: NonNullable<WorkspaceEdit["documentChanges"]> = [];
  for (const operation of operations) {
    throwIfAborted(signal);
    if (operation.kind === "replace" || operation.kind === "write") {
      const file = relativeWorkspacePath(state.root, operation.file);
      const snapshot = await getSnapshot(state, file);
      const content = requireContent(file, snapshot);
      if (operation.kind === "write" && snapshot.revision !== operation.ifMatch) {
        throw new Error(
          `Revision conflict for ${file}: expected ${operation.ifMatch}, found ${snapshot.revision}.`,
        );
      }
      const document = documentFor(state.root, file, content);
      const edits: TextEdit[] = operation.kind === "write"
        ? [{
            range: { start: document.positionAt(0), end: document.positionAt(content.length) },
            newText: operation.content,
          }]
        : (() => {
            const actual = countOccurrences(content, operation.oldText);
            const expected = operation.expectedOccurrences ?? 1;
            if (actual !== expected) {
              throw new Error(
                `Exact replacement conflict for ${file}: expected ${expected} occurrence(s), found ${actual}.`,
              );
            }
            const offsets: number[] = [];
            let offset = 0;
            while (offset <= content.length - operation.oldText.length) {
              const next = content.indexOf(operation.oldText, offset);
              if (next < 0) break;
              offsets.push(next);
              offset = next + operation.oldText.length;
            }
            return offsets.map((start) => ({
              range: {
                start: document.positionAt(start),
                end: document.positionAt(start + operation.oldText.length),
              },
              newText: operation.newText,
            }));
          })();
      documentChanges.push(TextDocumentEdit.create({ uri: document.uri, version: null }, edits));
      await setSnapshot(
        state,
        file,
        createSnapshot(TextDocument.applyEdits(document, edits), snapshot.mode),
      );
      continue;
    }
    if (operation.kind === "create") {
      const file = relativeWorkspacePath(state.root, operation.file);
      const snapshot = await getSnapshot(state, file);
      if (snapshot.content !== null) throw new Error(`Create target already exists: ${file}`);
      const uri = URI.file(resolveWorkspacePath(state.root, file)).toString();
      documentChanges.push(CreateFile.create(uri));
      if (operation.content.length > 0) {
        documentChanges.push(TextDocumentEdit.create(
          { uri, version: null },
          [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: operation.content }],
        ));
      }
      await setSnapshot(state, file, createSnapshot(operation.content, 0o666));
      continue;
    }
    if (operation.kind === "move") {
      const oldFile = relativeWorkspacePath(state.root, operation.oldFile);
      const newFile = relativeWorkspacePath(state.root, operation.newFile);
      const source = await getSnapshot(state, oldFile);
      if (source.revision !== operation.ifMatch) {
        throw new Error(
          `Revision conflict for ${oldFile}: expected ${operation.ifMatch}, found ${source.revision}.`,
        );
      }
      requireContent(oldFile, source);
      const destination = await getSnapshot(state, newFile);
      if (destination.content !== null && operation.overwrite !== true) {
        throw new Error(`Move target already exists: ${newFile}`);
      }
      documentChanges.push(RenameFile.create(
        URI.file(resolveWorkspacePath(state.root, oldFile)).toString(),
        URI.file(resolveWorkspacePath(state.root, newFile)).toString(),
        { overwrite: operation.overwrite },
      ));
      await setSnapshot(state, oldFile, createSnapshot(null));
      await setSnapshot(state, newFile, source);
      continue;
    }
    const file = relativeWorkspacePath(state.root, operation.file);
    const snapshot = await getSnapshot(state, file);
    if (snapshot.revision !== operation.ifMatch) {
      throw new Error(
        `Revision conflict for ${file}: expected ${operation.ifMatch}, found ${snapshot.revision}.`,
      );
    }
    requireContent(file, snapshot);
    documentChanges.push(DeleteFile.create(
      URI.file(resolveWorkspacePath(state.root, file)).toString(),
    ));
    await setSnapshot(state, file, createSnapshot(null));
  }
  return {
    edit: { documentChanges },
    expectedRevisions: new Map([...state.before].map(([file, snapshot]) => [file, snapshot.revision])),
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;

const pathValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  if (!value.startsWith("file:")) return value;
  try {
    return URI.parse(value).fsPath;
  } catch {
    return null;
  }
};

const entryBasePath = (
  entry: SandboxEntry,
  root: string,
  sandboxCwd: string,
): string | null => {
  const descriptor = asRecord(entry.path);
  if (!descriptor) return null;
  if (descriptor.type === "path") return pathValue(descriptor.path);
  if (descriptor.type !== "special") return null;
  const special = asRecord(descriptor.value);
  if (!special) return null;
  if (special.kind === "root") return path.parse(root).root;
  if (special.kind === "project_roots") {
    return path.resolve(root, typeof special.subpath === "string" ? special.subpath : "");
  }
  if (special.kind === "minimal") return sandboxCwd;
  return null;
};

const accessRank = (access: unknown): number => {
  if (access === "deny" || access === "none") return 3;
  if (access === "write") return 2;
  if (access === "read") return 1;
  return 0;
};

const hasProtectedMetadata = (root: string, target: string): boolean => {
  const [first] = path.relative(root, target).split(path.sep);
  return first !== undefined && PROTECTED_METADATA_NAMES.has(first.toLowerCase());
};

const hasExplicitProtectedWrite = (
  entries: readonly SandboxEntry[],
  root: string,
  sandboxCwd: string,
  target: string,
): boolean => entries.some((entry) => {
  if (entry.access !== "write") return false;
  const descriptor = asRecord(entry.path);
  if (descriptor?.type !== "path") return false;
  const base = entryBasePath(entry, root, sandboxCwd);
  return base !== null && hasProtectedMetadata(root, base) && isInside(base, target);
});

const assertSandboxAllows = (
  root: string,
  files: readonly string[],
  requestMeta: unknown,
): void => {
  const metadata = asRecord(requestMeta);
  const sandbox = asRecord(metadata?.[SANDBOX_STATE_META_KEY]);
  if (!sandbox) return;
  const profile = asRecord(sandbox.permissionProfile);
  if (!profile || profile.type === "disabled" || profile.type === "external") return;
  if (profile.type !== "managed") {
    throw new Error("Unsupported Codex permission profile; refusing the workspace edit.");
  }
  const fileSystem = asRecord(profile.file_system);
  if (fileSystem?.type === "unrestricted") return;
  if (fileSystem?.type !== "restricted" || !Array.isArray(fileSystem.entries)) {
    throw new Error("Codex permission metadata does not include a writable filesystem profile.");
  }
  const sandboxCwd = pathValue(sandbox.sandboxCwd) ?? root;
  const entries = fileSystem.entries
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  for (const file of files) {
    const target = resolveWorkspacePath(root, file);
    const matches = entries.flatMap((entry) => {
      const base = entryBasePath(entry, root, sandboxCwd);
      return base !== null && isInside(base, target)
        ? [{ base, access: entry.access }]
        : [];
    });
    const winner = matches.sort((left, right) =>
      right.base.length - left.base.length
      || accessRank(right.access) - accessRank(left.access)
    )[0];
    if (winner?.access !== "write") {
      throw new Error(`Codex sandbox metadata does not grant write access to ${target}.`);
    }
    if (
      hasProtectedMetadata(root, target)
      && !hasExplicitProtectedWrite(entries, root, sandboxCwd, target)
    ) {
      throw new Error(`Protected workspace metadata requires an explicit write grant: ${target}`);
    }
  }
};

const rollbackChanges = async (rollbacks: readonly Rollback[]): Promise<unknown[]> => {
  const errors: unknown[] = [];
  for (const rollback of [...rollbacks].reverse()) {
    try {
      await rollback();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
};

const assertBaselinesCurrent = async (edit: PreparedWorkspaceEdit): Promise<void> => {
  for (const [file, expected] of edit.before) {
    const current = await readWorkspaceSnapshot(edit.root, file);
    if (current.revision !== expected.revision) {
      throw new Error(
        `Workspace edit is stale at ${file}: expected ${expected.revision}, found ${current.revision}.`,
      );
    }
  }
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const pathsResolveToSameFile = async (
  left: string,
  right: string,
): Promise<boolean> => {
  try {
    const [resolvedLeft, resolvedRight] = await Promise.all([
      fs.realpath(left),
      fs.realpath(right),
    ]);
    return resolvedLeft === resolvedRight;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const removeEmptyDirectories = async (
  directories: readonly string[],
): Promise<void> => {
  for (const directory of directories) {
    try {
      await fs.rmdir(directory);
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && (error.code === "ENOENT" || error.code === "ENOTEMPTY")
      ) {
        continue;
      }
      throw error;
    }
  }
};

const createParentDirectories = async (
  root: string,
  target: string,
): Promise<Rollback | null> => {
  const resolvedRoot = path.resolve(root);
  const missing: string[] = [];
  let current = path.dirname(target);
  while (current !== resolvedRoot) {
    if (!isInside(resolvedRoot, current)) {
      throw new Error(`Edit path must remain inside the attached root: ${target}`);
    }
    if (await pathExists(current)) break;
    missing.push(current);
    current = path.dirname(current);
  }
  if (missing.length === 0) return null;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
  } catch (error) {
    await removeEmptyDirectories(missing).catch(() => undefined);
    throw error;
  }
  return () => removeEmptyDirectories(missing);
};

const commitWorkspaceEdit = async (edit: PreparedWorkspaceEdit): Promise<void> => {
  await assertBaselinesCurrent(edit);
  const transactionDir = await fs.mkdtemp(path.join(edit.root, ".featuretype-edit-"));
  const stagedText = new Map<number, string>();
  const rollbacks: Rollback[] = [];
  let backupIndex = 0;
  const backup = async (target: string): Promise<string> => {
    const destination = path.join(transactionDir, `${backupIndex++}.backup`);
    await fs.rename(target, destination);
    return destination;
  };
  const restore = async (source: string, target: string): Promise<void> => {
    await fs.rm(target, { force: true });
    await fs.rename(source, target);
  };
  try {
    for (const [index, step] of edit.steps.entries()) {
      if (step.kind !== "text") continue;
      if (step.snapshot.content === null) throw new Error(`Text edit removed ${step.file}.`);
      const staged = path.join(transactionDir, `${index}.text`);
      await fs.writeFile(staged, step.snapshot.content, { encoding: "utf8", flag: "wx" });
      if (step.snapshot.mode !== null) await fs.chmod(staged, step.snapshot.mode & 0o7777);
      stagedText.set(index, staged);
    }

    for (const [index, step] of edit.steps.entries()) {
      if (step.kind === "text") {
        const target = resolveWorkspacePath(edit.root, step.file);
        await assertWorkspacePathSafe(edit.root, step.file);
        const staged = stagedText.get(index);
        if (!staged) throw new Error(`Missing staged text for ${step.file}.`);
        const previous = await backup(target);
        try {
          await fs.rename(staged, target);
        } catch (error) {
          await restore(previous, target);
          throw error;
        }
        rollbacks.push(() => restore(previous, target));
        continue;
      }

      if (step.kind === "create") {
        const target = resolveWorkspacePath(edit.root, step.file);
        await assertWorkspacePathSafe(edit.root, step.file);
        const rollbackDirectories = await createParentDirectories(edit.root, target);
        if (rollbackDirectories) rollbacks.push(rollbackDirectories);
        const exists = await pathExists(target);
        if (
          exists
          && step.change.options?.overwrite !== true
          && step.change.options?.ignoreIfExists
        ) continue;
        const previous = exists && step.change.options?.overwrite ? await backup(target) : null;
        try {
          await fs.writeFile(target, "", { encoding: "utf8", flag: "wx" });
        } catch (error) {
          if (previous) await fs.rename(previous, target);
          throw error;
        }
        rollbacks.push(async () => {
          await fs.rm(target, { force: true });
          if (previous) await fs.rename(previous, target);
        });
        continue;
      }

      if (step.kind === "rename") {
        const oldTarget = resolveWorkspacePath(edit.root, step.oldFile);
        const newTarget = resolveWorkspacePath(edit.root, step.newFile);
        await assertWorkspacePathSafe(edit.root, step.oldFile);
        await assertWorkspacePathSafe(edit.root, step.newFile);
        const rollbackDirectories = await createParentDirectories(edit.root, newTarget);
        if (rollbackDirectories) rollbacks.push(rollbackDirectories);
        const destinationExists = await pathExists(newTarget);
        const sameFile = destinationExists
          && await pathsResolveToSameFile(oldTarget, newTarget);
        if (
          destinationExists
          && !sameFile
          && step.change.options?.overwrite !== true
          && step.change.options?.ignoreIfExists
        ) continue;
        const previousDestination = destinationExists
          && !sameFile
          && step.change.options?.overwrite
          ? await backup(newTarget)
          : null;
        try {
          await fs.rename(oldTarget, newTarget);
        } catch (error) {
          if (previousDestination) await fs.rename(previousDestination, newTarget);
          throw error;
        }
        rollbacks.push(async () => {
          await fs.rename(newTarget, oldTarget);
          if (previousDestination) await fs.rename(previousDestination, newTarget);
        });
        continue;
      }

      const target = resolveWorkspacePath(edit.root, step.file);
      await assertWorkspacePathSafe(edit.root, step.file);
      const previous = await backup(target);
      rollbacks.push(() => fs.rename(previous, target));
    }
  } catch (error) {
    const rollbackErrors = await rollbackChanges(rollbacks);
    throw rollbackErrors.length > 0
      ? new AggregateError([error, ...rollbackErrors], "Workspace edit and rollback both failed.")
      : error;
  } finally {
    await fs.rm(transactionDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const withRootLock = async <T>(
  root: string,
  signal: AbortSignal | undefined,
  work: () => Promise<T>,
): Promise<T> => {
  const resolvedRoot = path.resolve(root);
  const previous = rootLocks.get(resolvedRoot) ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  rootLocks.set(resolvedRoot, queued);
  let acquired = false;
  try {
    if (!signal) {
      await previous;
    } else {
      throwIfAborted(signal);
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          signal.removeEventListener("abort", onAbort);
          reject(signal.reason instanceof Error
            ? signal.reason
            : new Error("Workspace edit cancelled."));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        void previous.then(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        });
      });
    }
    acquired = true;
    return await work();
  } finally {
    release();
    if (acquired && rootLocks.get(resolvedRoot) === queued) {
      rootLocks.delete(resolvedRoot);
    } else if (!acquired) {
      void queued.then(() => {
        if (rootLocks.get(resolvedRoot) === queued) rootLocks.delete(resolvedRoot);
      });
    }
  }
};

export type LockedWorkspaceEditApplier = (
  edit: WorkspaceEdit,
  options?: Omit<WorkspaceEditExecutionOptions, "mode">,
) => Promise<WorkspaceEditResult>;

const applyWorkspaceEdit = async (
  root: string,
  edit: WorkspaceEdit,
  options: WorkspaceEditExecutionOptions,
): Promise<WorkspaceEditResult> => {
  const confirmations = getWorkspaceEditAnnotations(edit)
    .filter((annotation) => annotation.needsConfirmation);
  if (confirmations.length > 0 && options.confirm !== true) {
    throw new Error(
      `Workspace edit requires confirmation: ${confirmations.map((value) => value.label).join(", ")}`,
    );
  }
  await options.onProgress?.("preparing");
  const prepared = await prepareWorkspaceEdit(root, edit, options);
  assertSandboxAllows(prepared.root, prepared.files, options.requestMeta);
  throwIfAborted(options.signal);
  await options.onProgress?.("committing");
  await commitWorkspaceEdit(prepared);
  const warnings: string[] = [];
  try {
    await options.onProgress?.("refreshing");
    await options.onFilesChanged?.(prepared.root, prepared.files);
  } catch (error) {
    warnings.push(
      `Files were committed, but the language-server refresh failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return {
    status: "applied",
    files: prepared.files,
    preview: prepared.preview,
    annotations: prepared.annotations,
    warnings,
  };
};

export const withWorkspaceEditTransaction = async <T>(
  root: string,
  signal: AbortSignal | undefined,
  work: (apply: LockedWorkspaceEditApplier) => Promise<T>,
): Promise<T> => withRootLock(root, signal, () =>
  work((edit, options = {}) =>
    applyWorkspaceEdit(root, edit, {
      ...options,
      signal: options.signal ?? signal,
    })
  )
);

export const executeWorkspaceEdit = async (
  root: string,
  edit: WorkspaceEdit,
  options: WorkspaceEditExecutionOptions = {},
): Promise<WorkspaceEditResult> => {
  if ((options.mode ?? "apply") === "preview") {
    const prepared = await prepareWorkspaceEdit(root, edit, options);
    return {
      status: "preview",
      files: prepared.files,
      preview: prepared.preview,
      annotations: prepared.annotations,
      warnings: [],
    };
  }
  return await withRootLock(root, options.signal, () =>
    applyWorkspaceEdit(root, edit, options)
  );
};
