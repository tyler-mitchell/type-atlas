import { fork } from "node:child_process";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  CancellationTokenSource,
  createMessageConnection,
  IPCMessageReader,
  IPCMessageWriter,
  type RequestType,
} from "vscode-jsonrpc/node.js";
import {
  ConfigurationRequest,
  DiagnosticRefreshRequest,
  ExitNotification,
  InlayHintRefreshRequest,
  InitializedNotification,
  InitializeRequest,
  SemanticTokensRefreshRequest,
  ShutdownRequest,
} from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import {
  clientCapabilities,
  getClientConfiguration,
} from "./language-client.ts";

const require = createRequire(import.meta.url);

/** Creates an isolated Volar workspace over an LSP connection. */
export const createVolarWorkspace = async (
  root: string,
  signal: AbortSignal,
) => {
  if (!path.isAbsolute(root)) {
    throw new Error(`Workspace must be an absolute path: ${root}`);
  }
  const workspaceRoot = path.resolve(root);
  const workspaceStat = await stat(workspaceRoot).catch(() => undefined);
  if (!workspaceStat?.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${root}`);
  }
  const getAbortReason = () =>
    signal.reason instanceof Error
      ? signal.reason
      : new Error("Code intelligence request was cancelled.");
  const languageServerEntry = require.resolve(
    "@featuretype/code-intelligence-language-server/node",
  );
  const languageServer = fork(
    languageServerEntry,
    ["--node-ipc"],
    {
      cwd: workspaceRoot,
      execArgv: [],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      signal,
      killSignal: "SIGKILL",
    },
  );
  const languageServerExit = new Promise<void>((resolve) =>
    languageServer.once("close", () => resolve())
  );
  let languageServerError: Error | undefined;
  languageServer.on("error", (error) => {
    languageServerError = error;
  });
  const clientConnection = createMessageConnection(
    new IPCMessageReader(languageServer),
    new IPCMessageWriter(languageServer),
  );
  languageServer.once("close", () => clientConnection.dispose());

  clientConnection.listen();
  const cancelInitialization = () => clientConnection.dispose();
  signal.addEventListener("abort", cancelInitialization, { once: true });
  if (signal.aborted) cancelInitialization();
  clientConnection.onRequest(ConfigurationRequest.type, ({ items }) =>
    items.map(({ section }) => getClientConfiguration(section))
  );
  clientConnection.onRequest(DiagnosticRefreshRequest.type, () => undefined);
  clientConnection.onRequest(InlayHintRefreshRequest.type, () => undefined);
  clientConnection.onRequest(
    SemanticTokensRefreshRequest.type,
    () => undefined,
  );

  try {
    const workspaceUri = URI.file(workspaceRoot).toString();
    await clientConnection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: workspaceUri,
      workspaceFolders: [{
        uri: workspaceUri,
        name: path.basename(workspaceRoot),
      }],
      capabilities: clientCapabilities,
    });
    await clientConnection.sendNotification(InitializedNotification.type, {});
  } catch (error) {
    clientConnection.dispose();
    if (languageServer.exitCode === null && languageServer.signalCode === null) {
      languageServer.kill("SIGKILL");
    }
    await languageServerExit;
    throw signal.aborted
      ? getAbortReason()
      : languageServerError ?? error;
  } finally {
    signal.removeEventListener("abort", cancelInitialization);
  }

  let disposed = false;
  return {
    async sendRequest<Params, Result, Error>(
      request: RequestType<Params, Result, Error>,
      params: Params,
      requestSignal: AbortSignal,
    ): Promise<Result> {
      const cancellation = new CancellationTokenSource();
      const cancel = () => cancellation.cancel();
      requestSignal.addEventListener("abort", cancel, { once: true });
      if (requestSignal.aborted) cancel();

      try {
        return await clientConnection.sendRequest(
          request,
          params,
          cancellation.token,
        );
      } catch (error) {
        if (signal.aborted) throw getAbortReason();
        if (requestSignal.aborted) {
          throw requestSignal.reason instanceof Error
            ? requestSignal.reason
            : new Error("Code intelligence request was cancelled.");
        }
        throw error;
      } finally {
        requestSignal.removeEventListener("abort", cancel);
        cancellation.dispose();
      }
    },
    async getTextDocument(file: string) {
      const filePath = path.resolve(workspaceRoot, file);
      const relativePath = path.relative(workspaceRoot, filePath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(`File is outside the workspace: ${file}`);
      }
      const fileStat = await stat(filePath).catch(() => undefined);
      if (!fileStat?.isFile()) {
        throw new Error(`File is not a regular file: ${file}`);
      }

      return { uri: URI.file(filePath).toString() };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        if (
          !signal.aborted &&
          languageServer.exitCode === null &&
          languageServer.signalCode === null
        ) {
          await clientConnection.sendRequest(ShutdownRequest.type);
          await clientConnection.sendNotification(ExitNotification.type);
          await languageServerExit;
        }
      } finally {
        clientConnection.dispose();
        if (
          languageServer.exitCode === null &&
          languageServer.signalCode === null
        ) {
          languageServer.kill("SIGKILL");
          await languageServerExit;
        }
      }
    },
  };
};
