import type { Reporter, TestCase, Vitest } from "vite-plus/test/node";

type UserConsoleLog = Parameters<NonNullable<Reporter["onUserConsoleLog"]>>[0];
type TestRunEnd = NonNullable<Reporter["onTestRunEnd"]>;

/** Prints scenario evidence and failures, never runner ceremony. */
export default class ScenarioReporter implements Reporter {
  readonly #responses = new Map<string, string>();
  #selected = false;

  onInit(vitest: Vitest): void {
    const pattern = vitest.config.testNamePattern;
    this.#selected = pattern !== undefined && !pattern.source.includes("|");
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    if (log.type !== "stdout" || !log.content.startsWith("── ")) return;
    const content = log.content.endsWith("\n") ? log.content : `${log.content}\n`;
    if (log.taskId) this.#responses.set(log.taskId, content);
    if (this.#selected) process.stdout.write(content);
  }

  onTestCaseResult(testCase: TestCase): void {
    const result = testCase.result();
    if (result.state !== "failed") return;
    if (!this.#selected) {
      const response = this.#responses.get(testCase.id);
      if (response) process.stdout.write(response);
    }
    for (const error of result.errors) {
      const message = error.message ?? error.stack ?? JSON.stringify(error);
      process.stderr.write(
        `${testCase.fullName}: ${message.startsWith("Snapshot `") ? message.split("\n", 1)[0] : message}\n`,
      );
    }
  }

  onTestRunEnd(...[modules, errors]: Parameters<TestRunEnd>): void {
    if (!this.#selected && errors.length === 0 && modules.every((module) => module.ok())) {
      process.stdout.write("Checks passed.\n");
    }
  }
}
