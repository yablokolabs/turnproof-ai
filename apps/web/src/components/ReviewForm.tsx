import { useState, type FormEvent } from 'react';
import { ApiClientError, api } from '../api/client';
import { describeError, formatBoth } from '../format';
import type { Decision, Review } from '../types';

type Props = {
  decision: Decision | null;
  onReviewed: (review: Review) => void;
};

type ReviewAction = 'accept' | 'reject' | 'needs_review';

export function ReviewForm({ decision, onReviewed }: Props) {
  const [reviewer, setReviewer] = useState('');
  const [action, setAction] = useState<ReviewAction>('accept');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<Review | null>(null);
  const [exporting, setExporting] = useState(false);

  const disabled = decision === null || submitting;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.createReview(decision.id, {
        reviewer: reviewer.trim() || 'unnamed reviewer',
        action,
        note,
      });
      setRecorded(response.review);
      onReviewed(response.review);
    } catch (caught) {
      const suffix = caught instanceof ApiClientError ? ` (${caught.code})` : '';
      setError(`${describeError(caught)}${suffix}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function exportPacket() {
    if (!decision) return;
    setExporting(true);
    setError(null);
    try {
      const packet = await api.exportPacket(decision.id);
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `turnproof-decision-${decision.id}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="panel" aria-label="Human review">
      <h2>Human review</h2>
      <p className="muted small">
        Records are append-only. Approving here records a reviewer preference inside this prototype;
        it does not authorize or execute any operational change.
      </p>

      <form data-testid="review-form" onSubmit={submit}>
        <div className="form-grid">
          <label htmlFor="reviewer-name">Reviewer</label>
          <input
            id="reviewer-name"
            data-testid="reviewer-name"
            value={reviewer}
            onChange={(event) => setReviewer(event.target.value)}
            placeholder="name or role"
            maxLength={200}
            disabled={disabled}
          />

          <label htmlFor="review-action">Action</label>
          <select
            id="review-action"
            data-testid="review-action"
            value={action}
            onChange={(event) => setAction(event.target.value as ReviewAction)}
            disabled={disabled}
          >
            <option value="accept">accept</option>
            <option value="reject">reject</option>
            <option value="needs_review">needs_review</option>
          </select>

          <label htmlFor="review-note">Note</label>
          <textarea
            id="review-note"
            data-testid="review-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="reason for the decision"
            maxLength={4000}
            disabled={disabled}
          />

          <div className="form-actions">
            <button type="submit" className="primary" data-testid="review-submit" disabled={disabled}>
              {submitting ? 'Recording...' : 'Record review'}
            </button>
            <button
              type="button"
              data-testid="export-button"
              onClick={exportPacket}
              disabled={decision === null || exporting}
            >
              {exporting ? 'Preparing packet...' : 'Export decision packet'}
            </button>
          </div>
        </div>
      </form>

      {error ? (
        <div className="error-box" role="alert">
          {error}
        </div>
      ) : null}

      <div data-testid="review-result" aria-live="polite">
        {recorded ? (
          <dl className="kv small">
            <dt>Recorded review</dt>
            <dd className="mono">{recorded.id}</dd>
            <dt>Reviewer</dt>
            <dd>{recorded.reviewer}</dd>
            <dt>Action</dt>
            <dd>{recorded.action}</dd>
            <dt>Note</dt>
            <dd>{recorded.note || '(none)'}</dd>
            <dt>Recorded at</dt>
            <dd>{formatBoth(recorded.createdAt)}</dd>
            <dt>Decision</dt>
            <dd className="mono">{recorded.decisionId}</dd>
          </dl>
        ) : (
          <p className="muted small">No review recorded in this session yet.</p>
        )}
      </div>
    </section>
  );
}
