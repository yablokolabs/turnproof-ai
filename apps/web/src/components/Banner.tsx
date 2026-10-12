import type { Adapter, ProviderInfo } from '../types';

/** Matches the wording required by the build specification. */
const BANNER_TEXT = 'Prototype \u2022 synthetic data \u2022 advisory only \u2022 no operational execution';
/** Plain-ASCII variant of the same sentence, kept as a machine-readable attribute. */
const BANNER_TEXT_ASCII =
  'Prototype - synthetic data - advisory only - no operational execution';

export function modeLabel(provider: ProviderInfo | null): string {
  if (!provider) return 'Provider mode: loading';
  switch (provider.mode) {
    case 'deterministic':
      return 'Provider mode: deterministic rules (rule-based, no model inference)';
    case 'replay':
      return 'Provider mode: recorded replay (labelled replay, not a live provider)';
    case 'live':
      return 'Provider mode: live - unavailable (no verified contract)';
    default:
      return `Provider mode: ${String(provider.mode)}`;
  }
}

function statusClass(status: Adapter['status']): string {
  if (status === 'available') return 'pill pill-ok';
  if (status === 'error') return 'pill pill-bad';
  return 'pill pill-warn';
}

type Props = {
  provider: ProviderInfo | null;
  adapters: Adapter[];
};

export function Banner({ provider, adapters }: Props) {
  const sponsors = adapters.filter((adapter) => adapter.kind === 'sponsor');

  return (
    <section aria-label="Prototype status">
      <div
        className="banner"
        data-testid="prototype-banner"
        data-banner-text={BANNER_TEXT_ASCII}
        role="note"
      >
        {BANNER_TEXT}
      </div>

      <div className="banner-row" style={{ marginTop: 8 }}>
        <span className="pill" data-testid="provider-mode">
          {modeLabel(provider)}
        </span>
        <span className="pill pill-warn">
          A recorded review is a preference, never an operational authorization
        </span>
      </div>

      <div className="sponsor-list" data-testid="sponsor-list" aria-label="Sponsor adapter status">
        <h3>Sponsor adapters</h3>
        {sponsors.length === 0 ? (
          <p className="muted small">Sponsor adapter status has not loaded.</p>
        ) : (
          sponsors.map((sponsor) => (
            <div className="sponsor" data-testid={`sponsor-${sponsor.id}`} key={sponsor.id}>
              <strong>{sponsor.name}</strong>{' '}
              <span className={statusClass(sponsor.status)}>{sponsor.status}</span>
              <div className="muted small">{sponsor.detail}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
