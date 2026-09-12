import { extractText, getDocumentProxy } from 'unpdf';
import type { PassageId, ProjectId, SourceId } from '@coral/core';
import { appendEvent, loadProject, type ProjectView } from './repo.js';

/**
 * The escape hatch that keeps the evidence gate from blocking paywalled work.
 *
 * Retrieval stops at the abstract for most literature, so without this a
 * student could not build evidence from anything they had actually read. They
 * drop the PDF, we extract its text, and the source is promoted to
 * `user_upload` — the one level that outranks whatever retrieval managed.
 *
 * The promotion is earned in the same way as every other level: the source only
 * moves once characters are in hand. An unreadable or image-only PDF is refused
 * rather than promoted, because a source at `user_upload` with no text would be
 * a hole straight through invariant ii.
 */

/** 24MB. Large enough for a scanned monograph chapter, small enough to hold in memory. */
export const MAX_PDF_BYTES = 24 * 1024 * 1024;

export class UploadRefused extends Error {
  readonly invariant = 'ii.evidence';
  constructor(message: string) {
    super(message);
    this.name = 'UploadRefused';
  }
}

export interface UploadResult extends ProjectView {
  pages: number;
  characters: number;
  locator: string;
}

/**
 * Text extraction, with the failure cases named.
 *
 * A PDF that is a scan of paper carries images and no text layer. `unpdf`
 * returns an empty string for it rather than failing, which is the case most
 * worth catching: it is the one that would otherwise promote a source we cannot
 * quote.
 */
async function textOf(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (error) {
    throw new UploadRefused(
      `that file could not be read as a PDF (${error instanceof Error ? error.message : 'unknown'})`,
    );
  }

  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const merged = (Array.isArray(text) ? text.join('\n') : text).replace(/\s+/g, ' ').trim();

  if (merged.length < 200) {
    throw new UploadRefused(
      'no text layer in that PDF — it is probably a scan. Type the passage you want to quote instead.',
    );
  }
  return { text: merged, pages: totalPages };
}

/**
 * Promote a source with the document the student actually holds.
 *
 * Two appends, in this order: the passage first, then the promotion, so there
 * is no instant at which the source claims `user_upload` while carrying no
 * text. Both are coach events — capturing is a retrieval action, and
 * `assertAuthorship` requires it — but neither writes a word of the student's
 * reasoning. The interpretation and the warrant still have to be written by
 * hand before any of this becomes evidence.
 */
export async function uploadPaper(
  projectId: ProjectId,
  sourceId: SourceId,
  bytes: Uint8Array,
): Promise<UploadResult> {
  if (bytes.byteLength === 0) throw new UploadRefused('that upload was empty');
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new UploadRefused(
      `that file is ${String(Math.round(bytes.byteLength / 1024 / 1024))}MB; the limit is `
      + `${String(MAX_PDF_BYTES / 1024 / 1024)}MB`,
    );
  }

  const before = await loadProject(projectId);
  const source = before.state.sources[sourceId];
  if (source === undefined) throw new UploadRefused(`unknown source ${sourceId}`);

  const { text, pages } = await textOf(bytes);

  // The opening of the document, which is where a reader looks first. The
  // student picks the real quote when they write the evidence; this is the
  // passage that makes the source quotable at all.
  const excerpt = text.slice(0, 1800);
  const locator = `uploaded PDF, ${String(pages)} page${pages === 1 ? '' : 's'}`;

  let view = await appendEvent(projectId, {
    actor: 'coach',
    type: 'passage.captured',
    payload: {
      passageId: crypto.randomUUID() as PassageId,
      sourceId,
      text: excerpt,
      locator,
      // The student supplied the document. Not retrieved, and not generated —
      // there is no provenance for that.
      provenance: 'uploaded',
    },
  });

  view = await appendEvent(projectId, {
    actor: 'student',
    type: 'source.uploaded',
    payload: { sourceId },
  });

  return { ...view, pages, characters: text.length, locator };
}

/**
 * A quote the student typed from a paper they hold but cannot upload.
 *
 * The third provenance, and the honest one for a library book or a PDF that
 * will not extract. It is the student's transcription, so they own it, and it
 * is text we hold, so it can back evidence.
 */
export async function transcribePassage(
  projectId: ProjectId,
  sourceId: SourceId,
  body: { text: string; locator: string },
): Promise<ProjectView> {
  const text = body.text.trim();
  const locator = body.locator.trim();
  if (text.length < 20) {
    throw new UploadRefused('a transcribed passage needs the actual sentences, not a summary of them');
  }
  if (locator === '') {
    throw new UploadRefused('say where the passage is, so a reader can find it again');
  }

  const before = await loadProject(projectId);
  if (before.state.sources[sourceId] === undefined) {
    throw new UploadRefused(`unknown source ${sourceId}`);
  }

  const view = await appendEvent(projectId, {
    actor: 'coach',
    type: 'passage.captured',
    payload: {
      passageId: crypto.randomUUID() as PassageId,
      sourceId,
      text,
      locator,
      provenance: 'student_transcribed',
    },
  });

  // Transcribing is the student vouching for the text, which is what an upload
  // does too, so it earns the same level.
  return appendEvent(projectId, {
    actor: 'student',
    type: 'source.uploaded',
    payload: { sourceId },
  });
}
