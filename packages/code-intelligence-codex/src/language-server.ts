import { createConnection } from "@volar/language-server/node.js";
import { registerLanguageServer } from "@featuretype/code-intelligence-language-server";

const connection = createConnection();
registerLanguageServer(connection);
connection.listen();
