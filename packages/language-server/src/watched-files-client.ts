import fs from "node:fs";
import path from "node:path";
import type { ProtocolConnection } from "@volar/language-server/node";
import {
  DidChangeWatchedFilesNotification,
  FileChangeType,
  RegistrationRequest,
  UnregistrationRequest,
  type DidChangeWatchedFilesRegistrationOptions,
} from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";

export interface WatchedFilesClient {
  settle(): Promise<void>;
  dispose(): void;
}

interface WatchedFilesClientOptions {
  connection: ProtocolConnection;
  rootDir: string;
}

export function createWatchedFilesClient(
  options: WatchedFilesClientOptions,
): WatchedFilesClient {
  const rootDir = path.resolve(options.rootDir);
  const registrations = new Map<string, fs.FSWatcher>();
  let delivery = Promise.resolve();
  let failure: Error | undefined;

  const registrationDisposable = options.connection.onRequest(
    RegistrationRequest.type,
    ({ registrations: requestedRegistrations }) => {
      for (const registration of requestedRegistrations) {
        if (registration.method !== DidChangeWatchedFilesNotification.method) {
          continue;
        }

        registrations.get(registration.id)?.close();
        registrations.delete(registration.id);
        const registrationOptions = registration.registerOptions as
          | DidChangeWatchedFilesRegistrationOptions
          | undefined;
        const patterns = registrationOptions?.watchers.flatMap((watcher) =>
          typeof watcher.globPattern === "string" ? [watcher.globPattern] : []
        ) ?? [];
        if (patterns.length === 0) {
          continue;
        }

        const watcher = fs.watch(
          rootDir,
          { recursive: true },
          (eventType, fileName) => {
            if (!fileName) {
              return;
            }

            const relativePath = fileName.toString().split(path.sep).join("/");
            if (!patterns.some((pattern) => path.matchesGlob(relativePath, pattern))) {
              return;
            }

            const filePath = path.resolve(rootDir, relativePath);
            let stat: fs.Stats | undefined;
            try {
              stat = fs.statSync(filePath, { throwIfNoEntry: false });
            } catch (error) {
              reportError(error);
              return;
            }
            if (stat && !stat.isFile()) {
              return;
            }

            const types = !stat
              ? [FileChangeType.Deleted]
              : eventType === "change"
                ? [FileChangeType.Changed]
                : [FileChangeType.Created, FileChangeType.Changed];
            delivery = delivery
              .then(() =>
                options.connection.sendNotification(
                  DidChangeWatchedFilesNotification.type,
                  {
                    changes: types.map((type) => ({
                      uri: URI.file(filePath).toString(),
                      type,
                    })),
                  },
                )
              )
              .catch(reportError);
          },
        );
        watcher.on("error", reportError);
        registrations.set(registration.id, watcher);
      }
    },
  );

  const unregistrationDisposable = options.connection.onRequest(
    UnregistrationRequest.type,
    ({ unregisterations }) => {
      for (const unregistration of unregisterations) {
        registrations.get(unregistration.id)?.close();
        registrations.delete(unregistration.id);
      }
    },
  );

  function reportError(error: unknown): void {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  return {
    async settle() {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      let currentDelivery: Promise<void>;
      do {
        currentDelivery = delivery;
        await currentDelivery;
      } while (currentDelivery !== delivery);
      if (failure) {
        throw new Error("Workspace file observation failed.", {
          cause: failure,
        });
      }
    },
    dispose() {
      registrationDisposable.dispose();
      unregistrationDisposable.dispose();
      for (const watcher of registrations.values()) {
        watcher.close();
      }
      registrations.clear();
    },
  };
}
