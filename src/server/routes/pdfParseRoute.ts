import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { existsSync, createReadStream } from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { ingestPdf } from "../../ingestion/ingestPdf.js";
import { saveUploadedFile, getUploadedFilePath } from "../storage/uploadStore.js";
import {
  savePreviewDocument,
  getPreviewDocument,
} from "../storage/previewDocumentStore.js";
import type {
  PdfPreviewDocument,
  PdfParseModeHint,
  PdfAdvancedOptions,
} from "../../ingestion/types.js";

export async function pdfParseRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/pdf/parse
   * Multipart upload: field "file" (PDF), optional fields "parseMode", "advancedOptions"
   */
  fastify.post("/api/pdf/parse", async (request: FastifyRequest, reply: FastifyReply) => {
    const parts = request.parts();

    let parseMode: PdfParseModeHint = "auto";
    let advancedOptions: PdfAdvancedOptions = {};
    let documentId = uuidv4();
    let fileName = "upload.pdf";
    let filePath: string | null = null;

    // Must consume each part (especially file streams) within the loop
    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "file") {
        fileName = part.filename || "upload.pdf";
        try {
          filePath = await saveUploadedFile(part, documentId);
        } catch (err) {
          fastify.log.error(err, "Failed to save uploaded file");
          return reply.status(500).send({ error: "Failed to save uploaded file" });
        }
      } else if (part.type === "field") {
        if (part.fieldname === "parseMode") {
          parseMode = part.value as PdfParseModeHint;
        } else if (part.fieldname === "advancedOptions") {
          try {
            advancedOptions = JSON.parse(part.value as string);
          } catch {
            // ignore malformed json
          }
        }
      }
    }

    if (!filePath) {
      return reply.status(400).send({ error: "Missing PDF file field 'file'" });
    }

    let payload;
    try {
      payload = await ingestPdf({
        filePath,
        fileName,
        documentId,
        parseMode,
        advancedOptions,
      });
    } catch (err) {
      fastify.log.error(err, "PDF ingestion failed");
      return reply.status(500).send({ error: "PDF parsing failed", detail: String(err) });
    }

    const previewDoc: PdfPreviewDocument = {
      documentId: payload.document.id,
      fileName: payload.document.fileName,
      pageCount: payload.document.pageCount,
      originalPdfUrl: payload.document.originalPdfUrl,
      detections: payload.detections,
      blocks: payload.sourceBlocks,
      warnings: payload.warnings,
    };

    savePreviewDocument(previewDoc);

    return reply.status(200).send(previewDoc);
  });

  /**
   * GET /api/pdf/:documentId
   * Returns the stored PdfPreviewDocument (metadata + blocks)
   */
  fastify.get(
    "/api/pdf/:documentId",
    async (request: FastifyRequest<{ Params: { documentId: string } }>, reply: FastifyReply) => {
      const { documentId } = request.params;
      const doc = getPreviewDocument(documentId);
      if (!doc) {
        return reply.status(404).send({ error: "Document not found" });
      }
      return reply.send(doc);
    }
  );

  /**
   * GET /api/pdf/:documentId/original
   * Streams the original PDF file back to the client
   */
  fastify.get(
    "/api/pdf/:documentId/original",
    async (request: FastifyRequest<{ Params: { documentId: string } }>, reply: FastifyReply) => {
      const { documentId } = request.params;
      const filePath = getUploadedFilePath(documentId);

      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: "Original PDF not found" });
      }

      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${documentId}.pdf"`)
        .send(createReadStream(filePath));
    }
  );
}
