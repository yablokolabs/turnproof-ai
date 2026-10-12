/**
 * Bounded extraction of typed updates from operator notes.
 *
 * This is the *deterministic* mode: keyword and pattern matching, no model. Its
 * job is to demonstrate the contract the live provider would have to satisfy:
 * - every cited id must already exist in the caller-supplied context;
 * - unknown fields are listed explicitly rather than guessed;
 * - the original note is preserved verbatim next to the extracted fields;
 * - text that looks like an instruction is data, never a command;
 * - nothing is marked confirmed: human confirmation is required for critical changes.
 */
import { hashValue } from '@turnproof/domain';
import type { AdapterCallResult } from './contracts.js';
import { DETERMINISTIC_DESCRIPTOR } from './contracts.js';

export type ExtractionContext = {
  taskIds: string[];
  resourceIds: string[];
  asOf: string;
};

export type ExtractedField = {
  targetId: string;
  field: string;
  value: string | number | boolean;
  /** Character span in the original note that produced this field. */
  span: [number, number];
};

export type ExtractionResult = {
  noteText: string;
  extracted: ExtractedField[];
  unknownFields: string[];
  /** Ids the note mentions that do not exist in the supplied context. */
  unmatchedIdMentions: string[];
  /** Sentences that read as instructions; retained as text only. */
  instructionLikeText: string[];
  confirmed: false;
};

const ISO_RE = /\b(\d{2}):(\d{2})(?::(\d{2}))?Z\b/g;
const INSTRUCTION_RE = /\b(ignore|disregard|override|bypass|approve without|do not ask|skip the rule)/i;

function isoFromClock(note: string, hour: number, minute: number, second = 0): string | null {
  const dateMatch = note.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (!dateMatch) return null;
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const ss = String(second).padStart(2, '0');
  return `${dateMatch[1]}T${hh}:${mm}:${ss}Z`;
}

/** Rule-based extraction. Deterministic: same note and context, same output. */
export function extractUpdateDeterministic(
  note: string,
  context: ExtractionContext,
): AdapterCallResult<ExtractionResult> {
  const startedAt = Date.now();
  const taskIds = new Set(context.taskIds);
  const resourceIds = new Set(context.resourceIds);

  const extracted: ExtractedField[] = [];
  const unknownFields: string[] = [];
  const unmatchedIdMentions: string[] = [];
  const instructionLikeText: string[] = [];

  // Id mentions. Anything adjacent to a known id keyword is a candidate.
  const idRegex = /\b([A-Za-z][A-Za-z0-9_-]*-\d+|[a-z]+-[a-z]+\d*)\b/g;
  for (const match of note.matchAll(idRegex)) {
    const token = match[1];
    const known = taskIds.has(token) || resourceIds.has(token);
    if (!known && /^(TANKER|TP|TO)-/i.test(token)) unmatchedIdMentions.push(token);
  }

  // Clock times -> proposed availability.
  for (const match of note.matchAll(ISO_RE)) {
    const iso = isoFromClock(note, Number(match[1]), Number(match[2]), Number(match[3] ?? 0));
    if (!iso) {
      unknownFields.push('timestamp: note contains a clock time but no calendar date on the same line');
      continue;
    }
    const window = note.slice(Math.max(0, match.index - 40), (match.index ?? 0) + 20);
    const targetResource = context.resourceIds.find((id) => window.includes(id));
    const targetTask = context.taskIds.find((id) => window.includes(id));
    if (targetResource) {
      extracted.push({
        targetId: targetResource,
        field: 'availableFrom',
        value: iso,
        span: [match.index ?? 0, (match.index ?? 0) + match[0].length],
      });
    } else if (targetTask) {
      extracted.push({
        targetId: targetTask,
        field: 'earliestStart',
        value: iso,
        span: [match.index ?? 0, (match.index ?? 0) + match[0].length],
      });
    } else {
      unknownFields.push(`timestamp ${match[0]}: no known task or resource id in the same sentence`);
    }
  }

  // Availability words without a usable time.
  if (/\bunavailable\b/i.test(note)) {
    const target = context.resourceIds.find((id) => note.includes(id));
    if (target) {
      extracted.push({
        targetId: target,
        field: 'unavailable',
        value: true,
        span: [0, 0],
      });
    } else {
      unknownFields.push('unavailable: no known resource id in the same note');
    }
  }

  for (const sentence of note.split(/[.\n]/)) {
    if (INSTRUCTION_RE.test(sentence)) instructionLikeText.push(sentence.trim());
  }

  const result: ExtractionResult = {
    noteText: note,
    extracted,
    unknownFields,
    unmatchedIdMentions,
    instructionLikeText,
    confirmed: false,
  };

  return {
    status: 'available',
    provider: DETERMINISTIC_DESCRIPTOR.id,
    mode: 'deterministic',
    observedAt: context.asOf,
    sourceIds: [...new Set(extracted.map((e) => e.targetId))],
    requestHash: hashValue({ note, context }),
    latencyMs: Date.now() - startedAt,
    sanitizedResponseMetadata: {
      extractedCount: extracted.length,
      unknownFieldCount: unknownFields.length,
      instructionLikeCount: instructionLikeText.length,
      model: 'none (rule-based)',
    },
    data: result,
  };
}

/**
 * Validate an extraction against the trusted context. Any id that is not in the
 * context is a hard rejection: an extractor may not invent a resource.
 */
export function validateExtraction(
  result: ExtractionResult,
  context: ExtractionContext,
): { accepted: ExtractedField[]; rejected: Array<{ field: ExtractedField; reason: string }> } {
  const known = new Set([...context.taskIds, ...context.resourceIds]);
  const accepted: ExtractedField[] = [];
  const rejected: Array<{ field: ExtractedField; reason: string }> = [];

  for (const field of result.extracted) {
    if (!known.has(field.targetId)) {
      rejected.push({ field, reason: 'UNKNOWN_ID' });
      continue;
    }
    if (field.field === 'availableFrom' && typeof field.value === 'string' && !/Z$/.test(field.value)) {
      rejected.push({ field, reason: 'MALFORMED_TIMESTAMP' });
      continue;
    }
    accepted.push(field);
  }
  return { accepted, rejected };
}
