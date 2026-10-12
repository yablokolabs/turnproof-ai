/**
 * Human review records.
 *
 * Reviews are append-only: a correction is a new row that supersedes an earlier
 * one, so the review trail can always be reconstructed. "Approved" here means a
 * reviewer preference recorded in the prototype, never operational execution
 * authority.
 */
import { shortHash, type Decision, type Review, type ReviewRequest } from '@turnproof/domain';
import type { DatabaseSync } from 'node:sqlite';
import { notFound, revisionConflict } from '../errors.js';
import { nowIso } from '../storage/db.js';
import { countReviews, getDecision, listReviews, saveReview } from '../storage/repository.js';

export type RecordReviewResult = {
  review: Review;
  decision: Decision;
  reviews: Review[];
};

export function recordReview(args: {
  db: DatabaseSync;
  decisionId: string;
  body: ReviewRequest;
}): RecordReviewResult {
  const { db, decisionId, body } = args;
  const stored = getDecision(db, decisionId);
  if (!stored) throw notFound(`Unknown decision "${decisionId}".`);

  if (body.supersedes) {
    const existing = listReviews(db, decisionId);
    if (!existing.some((r) => r.id === body.supersedes)) {
      throw revisionConflict(
        `Review "${body.supersedes}" does not belong to decision "${decisionId}" and cannot be superseded.`,
      );
    }
  }

  const createdAt = nowIso();
  const sequence = countReviews(db, decisionId) + 1;
  const review: Review = {
    id: `rev_${shortHash({
      decisionId,
      sequence,
      reviewer: body.reviewer,
      action: body.action,
      note: body.note,
      createdAt,
    }).slice(0, 12)}`,
    decisionId,
    reviewer: body.reviewer,
    action: body.action,
    note: body.note,
    createdAt,
    ...(body.supersedes ? { supersedes: body.supersedes } : {}),
  };

  saveReview(db, review);

  return {
    review,
    decision: stored.decision,
    reviews: listReviews(db, decisionId),
  };
}

export function reviewsFor(db: DatabaseSync, decisionId: string): Review[] {
  return listReviews(db, decisionId);
}
