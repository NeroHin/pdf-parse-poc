import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { pdfParseRoutes } from "./routes/pdfParseRoute.js";
import { cleanStaleFiles, ensureTmpDir } from "./storage/uploadStore.js";

export async function buildApp() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, {
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST", "DELETE"],
  });

  await fastify.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  });

  await fastify.register(pdfParseRoutes);

  fastify.get("/api/health", async () => ({ status: "ok" }));

  return fastify;
}

export async function startApp() {
  ensureTmpDir();
  cleanStaleFiles();

  const app = await buildApp();

  try {
    await app.listen({ port: 3000, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  return app;
}
