import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageServerHandle } from "@volar/test-utils";
import { createServer, fixturePath, fixtureUri, tsdk } from "./utils";

let serverHandle: LanguageServerHandle;

beforeEach(async () => {
  serverHandle = createServer();
  await serverHandle.initialize(fixtureUri(""), {
    typescript: { tsdk },
  });
});

afterEach(() => {
  serverHandle.connection.dispose();
});

describe("featuretype language server", () => {
  it("maps embedded ts diagnostics back onto the source .featuretype document", async () => {
    const { uri } = await serverHandle.openTextDocument(
      fixturePath("broken-button.featuretype"),
      "featuretype",
    );
    const diagnostics = await serverHandle.sendDocumentDiagnosticRequest(uri);
    if (diagnostics.kind !== "full") {
      throw new Error("Expected a full diagnostic report.");
    }

    const items = diagnostics.items;

    expect(items.map((item) => item.source)).toContain("ts");
    expect(items.map((item) => item.source)).toContain("featuretype");
    expect(items.some((item) => item.message.includes("Type '\"destructive\"'"))).toBe(true);
    expect(
      items.some((item) => item.message.includes("must declare an <intent> block")),
    ).toBe(true);
  });

  it("typechecks top-level recipe blocks and maps diagnostics back to the source file", async () => {
    const { uri } = await serverHandle.openTextDocument(
      fixturePath("broken-single-select-combobox.featuretype"),
      "featuretype",
    );
    const diagnostics = await serverHandle.sendDocumentDiagnosticRequest(uri);
    if (diagnostics.kind !== "full") {
      throw new Error("Expected a full diagnostic report.");
    }

    const items = diagnostics.items;

    expect(items.map((item) => item.source)).toContain("ts");
    expect(items.some((item) => item.message.includes("selectedValue"))).toBe(true);
  });
});
