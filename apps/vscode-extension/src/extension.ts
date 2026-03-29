import path from "node:path";
import * as serverProtocol from "@volar/language-server/protocol";
import { createLabsInfo, getTsdk } from "@volar/vscode";
import {
  BaseLanguageClient,
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "@volar/vscode/node";
import * as vscode from "vscode";

let client: BaseLanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const serverModule = path.join(context.extensionPath, "dist", "server.js");
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        execArgv: ["--nolazy", "--inspect=6010"],
      },
    },
  };

  const tsdk = await getTsdk(context);
  if (!tsdk) {
    throw new Error("Unable to resolve a TypeScript SDK for FeatureType.");
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: "featuretype" }],
    initializationOptions: {
      typescript: {
        tsdk: tsdk.tsdk,
      },
    },
  };

  client = new LanguageClient(
    "featuretype-language-server",
    "FeatureType Language Server",
    serverOptions,
    clientOptions,
  );

  await client.start();

  const labsInfo = createLabsInfo(serverProtocol);
  labsInfo.addLanguageClient(client);
  return labsInfo.extensionExports;
}

export function deactivate() {
  return client?.stop();
}
