// server/storage.ts

import { Pool } from "pg";
import { pool } from "./db";
import type { DocumentAnalysis } from "./openai";

export interface DocumentBatch {
  id: number;
  title: string;
  userId: number;
  createdAt: Date;
}

export interface Document {
  id: number;
  batchId: number;
  filename: string;
  fileType: string;
  filePath: string;
  createdAt: Date;
}

export interface DocumentSummary {
  documentId: number;
  summary: string;
  createdAt: Date;
}

export interface DocumentAnalysisRecord {
  batchId: number;
  analysis: DocumentAnalysis;
  createdAt: Date;
}

export const storage = {
  //
  // Document‐batch functions
  //

  /** Create a new document batch */
  async createDocumentBatch(opts: {
    title: string;
    userId: number;
  }): Promise<DocumentBatch> {
    const { rows } = await pool.query<{
      id: number;
      title: string;
      userId: number;
      createdAt: Date;
    }>(
      `
      INSERT INTO document_batches (title, user_id)
      VALUES ($1, $2)
      RETURNING
        id,
        title,
        user_id   AS "userId",
        created_at AS "createdAt"
      `,
      [opts.title, opts.userId]
    );
    return rows[0];
  },

  /** Get all batches for a given user */
  async getDocumentBatchesByUserId(
    userId: number
  ): Promise<DocumentBatch[]> {
    const { rows } = await pool.query<DocumentBatch>(
      `
      SELECT
        id,
        title,
        user_id   AS "userId",
        created_at AS "createdAt"
      FROM document_batches
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );
    return rows;
  },

  /** Fetch a single batch by its ID */
  async getDocumentBatch(id: number): Promise<DocumentBatch | null> {
    const { rows } = await pool.query<DocumentBatch>(
      `
      SELECT
        id,
        title,
        user_id   AS "userId",
        created_at AS "createdAt"
      FROM document_batches
      WHERE id = $1
      `,
      [id]
    );
    return rows[0] ?? null;
  },

  /** Delete a batch (and cascade‐delete its docs/analyses if configured) */
  async deleteDocumentBatch(id: number): Promise<boolean> {
    const { rowCount } = await pool.query(
      `
      DELETE FROM document_batches
      WHERE id = $1
      `,
      [id]
    );
    return rowCount > 0;
  },

  //
  // Document functions
  //

  /** Save a newly‐uploaded document record */
  async saveDocument(opts: {
    batchId: number;
    filename: string;
    fileType: string;
    filePath: string;
  }): Promise<Document> {
    const { rows } = await pool.query<Document>(
      `
      INSERT INTO documents (batch_id, filename, file_type, file_path)
      VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        batch_id   AS "batchId",
        filename,
        file_type  AS "fileType",
        file_path  AS "filePath",
        created_at  AS "createdAt"
      `,
      [opts.batchId, opts.filename, opts.fileType, opts.filePath]
    );
    return rows[0];
  },

  /** List all documents in a batch */
  async getDocumentsByBatchId(batchId: number): Promise<Document[]> {
    const { rows } = await pool.query<Document>(
      `
      SELECT
        id,
        batch_id   AS "batchId",
        filename,
        file_type  AS "fileType",
        file_path  AS "filePath",
        created_at  AS "createdAt"
      FROM documents
      WHERE batch_id = $1
      ORDER BY created_at
      `,
      [batchId]
    );
    return rows;
  },

  /** Fetch one document along with its parent batch */
  async getDocumentWithBatch(
    documentId: number
  ): Promise<(Document & { batch: DocumentBatch }) | null> {
    const { rows } = await pool.query<any>(
      `
      SELECT
        d.id,
        d.batch_id           AS "batchId",
        d.filename,
        d.file_type          AS "fileType",
        d.file_path          AS "filePath",
        d.created_at          AS "createdAt",
        b.id                  AS "batch.id",
        b.title               AS "batch.title",
        b.user_id             AS "batch.userId",
        b.created_at          AS "batch.createdAt"
      FROM documents d
      JOIN document_batches b ON d.batch_id = b.id
      WHERE d.id = $1
      `,
      [documentId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    const batch: DocumentBatch = {
      id: r["batch.id"],
      title: r["batch.title"],
      userId: r["batch.userId"],
      createdAt: r["batch.createdAt"],
    };
    const doc: Document = {
      id: r.id,
      batchId: r.batchId,
      filename: r.filename,
      fileType: r.fileType,
      filePath: r.filePath,
      createdAt: r.createdAt,
    };
    return { ...doc, batch };
  },

  //
  // Document‐analysis functions
  //

  /** Save or update the analysis JSON for a batch */
  async saveDocumentAnalysis(opts: {
    batchId: number;
    analysis: DocumentAnalysis;
  }): Promise<DocumentAnalysisRecord> {
    const { rows } = await pool.query<DocumentAnalysisRecord>(
      `
      INSERT INTO document_analysis (batch_id, analysis)
      VALUES ($1, $2)
      ON CONFLICT (batch_id)
      DO UPDATE SET analysis = EXCLUDED.analysis
      RETURNING
        batch_id     AS "batchId",
        analysis,
        created_at   AS "createdAt"
      `,
      [opts.batchId, opts.analysis]
    );
    return rows[0];
  },

  /** Get the analysis JSON for a batch */
  async getDocumentAnalysisByBatchId(
    batchId: number
  ): Promise<DocumentAnalysis | null> {
    const { rows } = await pool.query<{ analysis: DocumentAnalysis }>(
      `
      SELECT analysis
      FROM document_analysis
      WHERE batch_id = $1
      `,
      [batchId]
    );
    return rows[0]?.analysis ?? null;
  },

  //
  // Document‐summary functions
  //

  /** Save or update a per‐document summary */
  async saveDocumentSummary(
    documentId: number,
    summary: string
  ): Promise<DocumentSummary> {
    const { rows } = await pool.query<DocumentSummary>(
      `
      INSERT INTO document_summaries (document_id, summary)
      VALUES ($1, $2)
      ON CONFLICT (document_id)
      DO UPDATE SET summary = EXCLUDED.summary
      RETURNING
        document_id  AS "documentId",
        summary,
        created_at   AS "createdAt"
      `,
      [documentId, summary]
    );
    return rows[0];
  },

  /** Fetch an existing summary for a document */
  async getDocumentSummary(
    documentId: number
  ): Promise<DocumentSummary | null> {
    const { rows } = await pool.query<DocumentSummary>(
      `
      SELECT
        document_id  AS "documentId",
        summary,
        created_at   AS "createdAt"
      FROM document_summaries
      WHERE document_id = $1
      `,
      [documentId]
    );
    return rows[0] ?? null;
  },

  /** Delete a document’s summary */
  async deleteDocumentSummary(documentId: number): Promise<boolean> {
    const { rowCount } = await pool.query(
      `
      DELETE FROM document_summaries
      WHERE document_id = $1
      `,
      [documentId]
    );
    return rowCount > 0;
  },
};
