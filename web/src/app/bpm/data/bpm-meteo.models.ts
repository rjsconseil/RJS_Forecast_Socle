// Météo BPM (API `GET /api/bpm/meteo`) : l'état des deux sections, les prévisions et les tendances. Montants en centimes.
import { BpmContextInfo } from './bpm-models';

export type WeatherKey = 'soleil' | 'eclaircies' | 'nuages' | 'orage';
export type SignalHealth = 'ok' | 'watch' | 'alert' | 'unknown';

export interface Weather {
  key: WeatherKey;
  label: string;
  symbol: string;
  rank: number;
}
export interface WeatherCounts { ok: number; watch: number; alert: number; unknown: number }
export interface WeatherReading extends Weather { counts: WeatherCounts }

export interface MeteoSignal {
  key: string;
  label: string;
  health: SignalHealth;
  healthLabel: string;
  figure: string;
  text: string;
  link: string | null;
  action: string | null;
  fragment?: string;
}

export interface MeteoProject {
  projectId: string;
  title: string;
  status: string;
  statusLabel: string;
  completionPercent: number;
  taskCount: number;
  fundingSource: 'cycle' | 'patrimoine';
  allocationCents: number | null;
  remainingCents: number | null;
  weather: WeatherReading;
  reasons: string[];
}

export interface MeteoSection {
  key: 'projet-de-vie' | 'gestion-de-projet' | 'patrimoine';
  label: string;
  link: string;
  home: string;
  weather: WeatherReading;
  signals: MeteoSignal[];
  projects?: MeteoProject[];
}

export interface ForecastItem {
  id?: string;
  date: string;
  kind: 'entree' | 'depense' | 'tache' | 'cycle' | 'facturation' | 'decision';
  label: string;
  detail: string | null;
  amountCents: number | null;
  late: boolean;
  link: string;
  query?: Record<string, string>;
  fundingSource?: 'cycle' | 'patrimoine';
}
export interface ForecastHorizon { days: number; incomingCents: number; outgoingCents: number; tasks: number }

export interface TrendRow {
  period: { key: string; label: string; start: string; end: string };
  status: 'closed' | 'ended' | 'current';
  source: string;
  receivedCents: number | null;
  spentCents: number | null;
  resultCents: number | null;
  projectsCents: number;
  withdrawnCents: number;
  stockAfterCents: number | null;
  weather: Weather | null;
  headline: string | null;
}

export interface BpmMeteo {
  context: BpmContextInfo & { today: string };
  overall: WeatherReading & { worst: SignalHealth; headline: string | null };
  sections: MeteoSection[];
  forecast: {
    from: string;
    to: string;
    lateCount: number;
    items: ForecastItem[];
    horizons: ForecastHorizon[];
    goals: { date: string; label: string; futureCostCents: number; provisionPerPeriodCents: number | null }[];
    cycleDaysLeft: number | null;
  };
  trends: {
    savingsTargetCents: number | null;
    rows: TrendRow[];
    tally: Record<WeatherKey, number>;
    direction: 'hausse' | 'baisse' | 'stable' | null;
    recentAverageCents: number | null;
    previousAverageCents: number | null;
    totals: { closedCount: number; capitalizedCents: number };
  };
  legend: { weathers: Weather[]; rule: { weather: WeatherKey; when: string }[]; health: Record<SignalHealth, string> };
}
