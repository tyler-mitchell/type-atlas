import { createConnection } from "@volar/language-server/node.js";
import { registerLanguageServer } from "./server.ts";

const connection = createConnection();
registerLanguageServer(connection);
connection.listen();
