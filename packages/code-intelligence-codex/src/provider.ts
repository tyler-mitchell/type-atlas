export type DynamicToolFunction = {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly deferLoading?: boolean;
};

export type DynamicToolSpec = DynamicToolFunction | {
  readonly type: "namespace";
  readonly name: string;
  readonly description: string;
  readonly tools: readonly DynamicToolFunction[];
};

export type DynamicToolCall = {
  readonly threadId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly namespace: string | null;
  readonly tool: string;
  readonly arguments: unknown;
};

export type DynamicToolContent =
  | { readonly type: "inputText"; readonly text: string }
  | { readonly type: "inputImage"; readonly imageUrl: string };

export type DynamicToolContext = {
  readonly root: string;
  readonly changedFiles: readonly string[];
};

export type DynamicToolProvider = {
  readonly tools: readonly DynamicToolSpec[];
  readonly call: (
    context: DynamicToolContext,
    request: DynamicToolCall,
    signal: AbortSignal,
  ) => Promise<readonly DynamicToolContent[]>;
  readonly dispose?: () => Promise<void>;
};

export type DynamicToolProviderEnvironment = {
  readonly languageServer: URL;
};
