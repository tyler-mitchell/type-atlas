// vite-plus/test/node re-exports vitest/node, where reporters live since 4.1
// (vite-plus/test/reporters wraps the deprecated vitest/reporters path).
import { DefaultReporter, type UserConsoleLog } from "vite-plus/test/node";

/**
 * The run stream is the witness, so it carries witnesses and nothing else.
 *
 * Verbose listed every passing test — ~120 ceremony rows per run drowning the
 * two things a reader is actually there for: the changed-capture echoes and
 * the failures. The default reporter is quiet but buries the echoes with the
 * ceremony (it surfaces a test's console output only when the test fails —
 * exactly wrong for a passing `-u` regeneration). This reporter is the
 * default reporter plus one rule: a scenario echo or a replay-seed line
 * prints the moment it happens, pass or fail.
 */
const WITNESS = /^(── |shuffled replay seed)/;

export default class CaptureReporter extends DefaultReporter {
  override onUserConsoleLog(log: UserConsoleLog): void {
    if (log.type === "stdout" && WITNESS.test(log.content)) {
      process.stdout.write(log.content.endsWith("\n") ? log.content : `${log.content}\n`);
      return;
    }
    super.onUserConsoleLog(log);
  }
}
