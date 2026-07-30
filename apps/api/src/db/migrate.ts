import { createDatabase } from "./database";
import { loadConfig } from "../config";

const config = loadConfig();
const database = createDatabase(config);
database.close();

console.log(`Database migrations applied to ${config.databasePath}`);
