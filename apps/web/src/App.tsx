import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, api } from './api/client';
import { Alternatives } from './components/Alternatives';
import { Banner } from './components/Banner';
import { EvidenceDrawer } from './components/EvidenceDrawer';
import { ReviewForm } from './components/ReviewForm';
import { ScenarioPicker } from './components/ScenarioPicker';
import { StationBoard } from './components/StationBoard';
import { Timeline } from './components/Timeline';
import { describeError } from './format';
import type {
  Adapter,
  Decision,
  HealthResponse,
  ProviderInfo,
  ProviderMode,
  Review,
  ScenarioSummary,
  SnapshotResponse,
} from './types';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [providerMode, setProviderMode] = useState<ProviderMode>('deterministic');
  const [data, setData] = useState<SnapshotResponse | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  /**
   * The decision record actually stored on the server. A review or an export
   * must point at a persisted record; the decision returned with a snapshot is
   * computed on the fly and would 404 if reviewed directly.
   */
  const [persisted, setPersisted] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadScenarios = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthResponse, scenarioResponse] = await Promise.all([
        api.health(),
        api.scenarios(),
      ]);
      setHealth(healthResponse);
      setScenarios(scenarioResponse.scenarios);
      setSelectedId((current) => current ?? scenarioResponse.scenarios[0]?.id ?? null);
    } catch (caught) {
      const suffix = caught instanceof ApiClientError ? ` (${caught.code})` : '';
      setError(`Could not load the board: ${describeError(caught)}${suffix}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSnapshot = useCallback(async (scenarioId: string, mode: ProviderMode) => {
    setLoading(true);
    setError(null);
    setPersisted(null);
    setReviews([]);
    try {
      const response = await api.snapshot(scenarioId, mode);
      setData(response);
      // Record the decision so the review and export steps act on a stored
      // record. The key is stable per scenario revision and mode, so reloading
      // returns the same stored decision instead of writing another row.
      const idempotencyKey = `ui-${scenarioId}-${response.snapshot.revision}-${mode}`;
      const created = await api.createDecision(
        {
          scenarioId,
          expectedRevision: response.snapshot.revision,
          providerMode: mode,
        },
        idempotencyKey,
      );
      setPersisted(created.decision);
    } catch (caught) {
      const suffix = caught instanceof ApiClientError ? ` (${caught.code})` : '';
      setError(`Could not load scenario ${scenarioId}: ${describeError(caught)}${suffix}`);
      setData(null);
      setPersisted(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScenarios();
  }, [loadScenarios]);

  useEffect(() => {
    if (selectedId) void loadSnapshot(selectedId, providerMode);
  }, [selectedId, providerMode, loadSnapshot]);

  const adapters: Adapter[] = useMemo(
    () => data?.adapters ?? health?.adapters ?? [],
    [data, health],
  );
  const provider: ProviderInfo | null = data?.provider ?? null;

  return (
    <div className="app">
      <header className="app-header">
        {/*
          The wordmark is dark ink on a transparent background, so it is placed
          on a light brand plate. On the dark console it would otherwise be
          almost invisible.
        */}
        <h1 className="brand-plate">
          <img
            className="app-logo"
            src="/turnproof-logo.png"
            alt="TurnProof AI"
            width={252}
            height={84}
          />
        </h1>
        <p className="muted">Recover the turnaround. Show the evidence.</p>
      </header>

      <Banner provider={provider} adapters={adapters} />

      {error ? (
        <div className="error-box" data-testid="api-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="grid">
        <div>
          <ScenarioPicker
            scenarios={scenarios}
            selectedId={selectedId}
            onSelect={setSelectedId}
            providerMode={providerMode}
            onProviderModeChange={setProviderMode}
            onRefresh={() => {
              if (selectedId) void loadSnapshot(selectedId, providerMode);
            }}
            loading={loading}
          />
        </div>

        <div>
          {loading && !data ? (
            <section className="panel" role="status">
              <h2>Loading</h2>
              <p className="muted">Requesting the snapshot from the local API.</p>
            </section>
          ) : null}

          {!loading && !data ? (
            <section className="panel" role="status">
              <h2>No snapshot</h2>
              <p className="muted">
                Select a scenario to compute its baseline and candidate set.
              </p>
            </section>
          ) : null}

          {data ? (
            <>
              <StationBoard snapshot={data.snapshot} baseline={data.baseline} />
              <Timeline baseline={data.baseline} />
              <Alternatives candidates={data.candidates} decision={data.decision} />
              <EvidenceDrawer snapshot={data.snapshot} />
              <ReviewForm
                decision={persisted}
                onReviewed={(review) => setReviews((current) => [...current, review])}
              />

              {reviews.length > 0 ? (
                <section className="panel" aria-label="Session review log">
                  <h2>Reviews recorded this session</h2>
                  <ul className="small" data-testid="review-log">
                    {reviews.map((review) => (
                      <li key={review.id}>
                        <span className="mono">{review.id}</span> &middot; {review.action} &middot;{' '}
                        {review.reviewer} &middot; {review.note || '(no note)'}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="panel" aria-label="Provenance">
                <h2>Provenance</h2>
                <dl className="kv small">
                  <dt>Scenario</dt>
                  <dd className="mono">{data.scenario.id}</dd>
                  <dt>Data provenance</dt>
                  <dd>{data.scenario.dataProvenance}</dd>
                  <dt>Snapshot hash</dt>
                  <dd className="mono">{data.snapshot.inputHash}</dd>
                  <dt>Solver version</dt>
                  <dd className="mono">{data.decision.solverVersion}</dd>
                  <dt>Policy version</dt>
                  <dd className="mono">{data.decision.policyVersion}</dd>
                  <dt>Snapshot as of</dt>
                  <dd className="mono">{data.snapshot.asOf}</dd>
                  <dt>Decision created</dt>
                  <dd className="mono">{data.decision.createdAt}</dd>
                  <dt>Recorded decision id</dt>
                  <dd className="mono">{persisted?.id ?? 'not recorded'}</dd>
                </dl>
                <p className="muted small">
                  Advisory output only. Hard constraints are evaluated before any ranking, and a
                  human review is required.
                </p>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
