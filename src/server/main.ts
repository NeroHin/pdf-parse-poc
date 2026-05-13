import { loadDotenv } from "./loadEnv.js";
import { startApp } from "./app.js";

loadDotenv();
await startApp();
