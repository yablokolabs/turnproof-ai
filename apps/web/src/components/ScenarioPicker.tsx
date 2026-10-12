import type { ChangeEvent } from 'react';
import type { ProviderMode, ScenarioSummary } from '../types';

type Props = {
  scenarios: ScenarioSummary[];
  selectedId: string | null;
  onSelect: (scenarioId: string) => void;
  providerMode: ProviderMode;
  onProviderModeChange: (mode: ProviderMode) => void;
  onRefresh: () => void;
  loading: boolean;
};

export function ScenarioPicker({
  scenarios,
  selectedId,
  onSelect,
  providerMode,
  onProviderModeChange,
  onRefresh,
  loading,
}: Props) {
  const select = (event: ChangeEvent<HTMLSelectElement>) => {
    onProviderModeChange(event.target.value as ProviderMode);
  };

  return (
    <section className="panel" aria-label="Scenario selection">
      <h2>Scenarios</h2>
      <p className="muted small">
        Fictitious stations, flights, aircraft, and ground units. No live airport telemetry.
      </p>

      {scenarios.length === 0 ? (
        <p className="muted" role="status">
          {loading ? 'Loading scenarios...' : 'No scenarios available.'}
        </p>
      ) : (
        <ul className="scenario-list" data-testid="scenario-list">
          {scenarios.map((scenario) => (
            <li key={scenario.id}>
              <button
                type="button"
                className={`scenario-item${scenario.id === selectedId ? ' selected' : ''}`}
                data-testid={`scenario-item-${scenario.id}`}
                aria-pressed={scenario.id === selectedId}
                onClick={() => onSelect(scenario.id)}
              >
                <span className="label">{scenario.label}</span>
                <span className="muted small">
                  {scenario.id} &middot; {scenario.category} &middot; {scenario.station} &middot;{' '}
                  {scenario.flightNumber}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Provider mode</h3>
      <label className="small" htmlFor="provider-mode-select">
        Select the mode used to produce the decision
      </label>
      <div style={{ marginTop: 6 }}>
        <select
          id="provider-mode-select"
          data-testid="provider-mode-select"
          value={providerMode}
          onChange={select}
        >
          <option value="deterministic">deterministic rules</option>
          <option value="replay">recorded replay</option>
          <option value="live" disabled>
            live - unavailable
          </option>
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="button" data-testid="refresh" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh board'}
        </button>
      </div>
    </section>
  );
}
