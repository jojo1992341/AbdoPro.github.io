// js/screens/history.js
// ─────────────────────────────────────────────────────────
// Historique & Statistiques.
//
// Écran de consultation pure (lecture seule).
// Affiche la courbe de progression test_max (SVG animé),
// le détail par semaine (accordion dépliable),
// les scores des algorithmes (barres horizontales triées),
// et un bouton d'export des données.
//
// Dépendances : DB (js/db.js)
// Route :       #/history
// ─────────────────────────────────────────────────────────

import db from '../db.js';

// ── Configuration ──────────────────────────────────────────

const CHART = Object.freeze({
  viewBoxWidth: 350,
  viewBoxHeight: 200,
  padding: { top: 20, right: 25, bottom: 35, left: 45 },
  dotRadius: 5,
  lineWidth: 2.5,
  gridLineCount: 4,
  animationDuration: '1s',
  dotStaggerMs: 100,
  dotDelayMs: 800,
});

const ALGO_META = Object.freeze({
  linear:     { label: 'Linéaire',   color: '#6366f1' },
  banister:   { label: 'Banister',   color: '#3b82f6' },
  dup:        { label: 'DUP',        color: '#22c55e' },
  rir:        { label: 'RIR',        color: '#f59e0b' },
  regression: { label: 'Régression', color: '#ef4444' },
});

const FEEDBACK_LABELS = Object.freeze({
  parfait: 'P',
  facile: 'F',
  impossible: 'I',
});

const TRAINING_DAYS_PER_WEEK = 6;
const ENTRY_STAGGER_MS = 80;

// ── Classe Principale ──────────────────────────────────────

export class HistoryScreen {

  constructor() {
    this._container = null;
    this._weeks = [];
    this._expandedWeeks = new Set();
    this._boundClickHandler = null;
    this._navigate = null;
  }

  // ── Lifecycle ──────────────────────────────────────────

  /**
   * Point d'entrée. Charge les données, rend le HTML,
   * attache les événements, lance les animations.
   * @param {HTMLElement} container
   */
  async render(container, params = {}) {
    this._navigate = params.navigateTo || null;
    this._container = container;
    await this._loadData();

    this._container.innerHTML = this._buildHTML();
    this._attachEvents();
    this._animateChart();
    this._animateEntry();
  }

  /**
   * Nettoyage complet avant démontage par le routeur.
   */
  destroy() {
    this._detachEvents();
    this._container = null;
    this._weeks = [];
    this._expandedWeeks.clear();
    this._navigate = null;
  }

  // ── Chargement ─────────────────────────────────────────

  async _loadData() {
    const rawWeeks = await db.getAllWeeks() || [];
    this._weeks = rawWeeks.sort((a, b) => a.weekNumber - b.weekNumber);
  }

  // ── Construction HTML — Structure Principale ───────────

  _buildHTML() {
    const hasData = this._weeks.length > 0;

    return `
      <div class="screen screen--history" role="main" aria-labelledby="history-title">

        <header class="screen__header">
          <button class="btn btn--icon btn--back" data-action="back"
                  type="button" aria-label="Retour au tableau de bord">←</button>
          <h1 id="history-title" class="screen__title">
            <span aria-hidden="true">📊</span> Progression
          </h1>
        </header>

        ${hasData ? this._buildContent() : this._buildEmptyState()}

      </div>
    `;
  }

  _buildEmptyState() {
    return `
      <section class="empty-state" aria-label="Aucune donnée">
        <p class="empty-state__icon" aria-hidden="true">📈</p>
        <p class="empty-state__text">Aucune donnée disponible.</p>
        <p class="empty-state__hint">
          Complétez votre première semaine pour voir vos statistiques.
        </p>
      </section>
    `;
  }

  _buildContent() {
    return `
      ${this._buildChartSection()}
      ${this._buildWeekListSection()}
      ${this._buildAlgorithmSection()}
      ${this._buildExportSection()}
    `;
  }

  // ── Graphique SVG ──────────────────────────────────────

  _buildChartSection() {
    const dataPoints = this._weeks
      .filter(w => w.testMax != null)
      .map(w => ({ week: w.weekNumber, value: w.testMax }));

    if (dataPoints.length === 0) return '';

    return `
      <section class="card card--chart" aria-label="Graphique de progression">
        <h2 class="card__subtitle">Courbe Test Max</h2>
        ${this._buildSVGChart(dataPoints)}
      </section>
    `;
  }

  _buildSVGChart(dataPoints) {
    const { viewBoxWidth: W, viewBoxHeight: H, padding: P } = CHART;
    const plotW = W - P.left - P.right;
    const plotH = H - P.top - P.bottom;

    const values = dataPoints.map(d => d.value);
    const yMin = Math.max(0, Math.min(...values) - 3);
    const yMax = Math.max(...values) + 3;

    const xScale = this._createXScale(dataPoints, P.left, plotW);
    const yScale = this._createYScale(yMin, yMax, P.top, plotH);

    const accessibleDescription = dataPoints
      .map(d => `Semaine ${d.week}: ${d.value}`)
      .join(', ');

    return `
      <svg
        class="chart__svg"
        viewBox="0 0 ${W} ${H}"
        role="img"
        aria-label="Graphique test maximum — ${accessibleDescription}"
        preserveAspectRatio="xMidYMid meet"
      >
        ${this._buildGridLines(yMin, yMax, P, plotW, yScale)}
        ${this._buildPolyline(dataPoints, xScale, yScale)}
        ${this._buildDots(dataPoints, xScale, yScale)}
        ${this._buildXLabels(dataPoints, xScale, H)}
      </svg>
    `;
  }

  /**
   * Crée une fonction de mapping semaine → coordonnée X.
   * Centre le point si un seul dataPoint.
   */
  _createXScale(dataPoints, leftPad, plotWidth) {
    if (dataPoints.length === 1) {
      return () => leftPad + plotWidth / 2;
    }
    const minW = dataPoints[0].week;
    const maxW = dataPoints[dataPoints.length - 1].week;
    const range = maxW - minW || 1;
    return (weekNum) => leftPad + ((weekNum - minW) / range) * plotWidth;
  }

  /**
   * Crée une fonction de mapping valeur → coordonnée Y (inversé).
   */
  _createYScale(yMin, yMax, topPad, plotHeight) {
    const range = yMax - yMin || 1;
    return (val) => topPad + plotHeight - ((val - yMin) / range) * plotHeight;
  }

  _buildGridLines(yMin, yMax, padding, plotWidth, yScale) {
    const step = (yMax - yMin) / CHART.gridLineCount;
    let svg = '';

    for (let i = 0; i <= CHART.gridLineCount; i++) {
      const val = yMin + step * i;
      const y = yScale(val).toFixed(1);

      svg += `
        <line
          x1="${padding.left}" y1="${y}"
          x2="${padding.left + plotWidth}" y2="${y}"
          class="chart__grid-line"
          stroke="var(--bg-secondary, #2a2a3e)"
          stroke-width="0.5"
        />
        <text
          x="${padding.left - 8}" y="${y}"
          class="chart__label chart__label--y"
          text-anchor="end"
          dominant-baseline="middle"
        >${Math.round(val)}</text>
      `;
    }

    return svg;
  }

  _buildPolyline(dataPoints, xScale, yScale) {
    if (dataPoints.length < 2) return '';

    const points = dataPoints
      .map(d => `${xScale(d.week).toFixed(1)},${yScale(d.value).toFixed(1)}`)
      .join(' ');

    const totalLength = this._computePolylineLength(dataPoints, xScale, yScale);

    return `
      <polyline
        class="chart__line"
        points="${points}"
        fill="none"
        stroke="var(--accent-primary, #6366f1)"
        stroke-width="${CHART.lineWidth}"
        stroke-linecap="round"
        stroke-linejoin="round"
        data-total-length="${totalLength.toFixed(0)}"
      />
    `;
  }

  _buildDots(dataPoints, xScale, yScale) {
    return dataPoints.map(d => `
      <circle
        cx="${xScale(d.week).toFixed(1)}"
        cy="${yScale(d.value).toFixed(1)}"
        r="${CHART.dotRadius}"
        class="chart__dot"
        fill="var(--accent-primary, #6366f1)"
        stroke="var(--bg-card, #16213e)"
        stroke-width="2"
      >
        <title>Semaine ${d.week} : ${d.value} reps</title>
      </circle>
    `).join('');
  }

  _buildXLabels(dataPoints, xScale, svgHeight) {
    return dataPoints.map(d => `
      <text
        x="${xScale(d.week).toFixed(1)}"
        y="${svgHeight - 5}"
        class="chart__label chart__label--x"
        text-anchor="middle"
      >S${d.week}</text>
    `).join('');
  }

  _computePolylineLength(dataPoints, xScale, yScale) {
    let length = 0;
    for (let i = 1; i < dataPoints.length; i++) {
      const dx = xScale(dataPoints[i].week) - xScale(dataPoints[i - 1].week);
      const dy = yScale(dataPoints[i].value) - yScale(dataPoints[i - 1].value);
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }

  // ── Liste des Semaines (Accordion) ─────────────────────

  _buildWeekListSection() {
    const reversed = [...this._weeks].reverse();

    return `
      <section class="history__weeks" aria-label="Historique détaillé">
        <h2 class="section__title">
          <span aria-hidden="true">📋</span> Historique détaillé
        </h2>
        <div class="weeks__list" role="list">
          ${reversed.map(w => this._buildWeekItem(w)).join('')}
        </div>
      </section>
    `;
  }

  _buildWeekItem(week) {
    const isExpanded = this._expandedWeeks.has(week.weekNumber);
    const progressStr = this._formatWeekProgress(week);
    const algoMeta = ALGO_META[week.selectedAlgorithm] || { label: '—', color: '#888' };

    return `
      <div class="week-item card" role="listitem">
        <button
          class="week-item__header"
          data-action="toggle-week"
          data-week="${week.weekNumber}"
          type="button"
          aria-expanded="${isExpanded}"
          aria-controls="week-detail-${week.weekNumber}"
        >
          <span class="week-item__title">Semaine ${week.weekNumber}</span>
          <span class="week-item__summary">
            ${week.testMax != null ? `${week.testMax} reps` : '—'}
            ${progressStr ? ` (${progressStr})` : ''}
          </span>
          <span class="week-item__chevron ${isExpanded ? 'week-item__chevron--open' : ''}"
                aria-hidden="true">▶</span>
        </button>

        <div
          id="week-detail-${week.weekNumber}"
          class="week-item__detail ${isExpanded ? 'week-item__detail--open' : ''}"
          ${isExpanded ? '' : 'hidden'}
        >
          ${this._buildWeekDetail(week, algoMeta)}
        </div>
      </div>
    `;
  }

  _buildWeekDetail(week, algoMeta) {
    const fb = week.feedbackSummary || {};
    const algoScore = week.algorithmScores?.[week.selectedAlgorithm];

    return `
      <dl class="week-detail">
        <div class="week-detail__row">
          <dt>Algorithme</dt>
          <dd>
            <span class="algo-badge" style="--algo-color: ${algoMeta.color}">
              ${algoMeta.label}
            </span>
            ${algoScore != null
              ? `<span class="algo-score">(${algoScore.toFixed(1)})</span>`
              : ''}
          </dd>
        </div>

        <div class="week-detail__row">
          <dt>Test max</dt>
          <dd>
            ${week.testMax ?? '—'} reps
            ${this._formatWeekProgress(week)
              ? `<span class="progress-badge">${this._formatWeekProgress(week)}</span>`
              : ''}
          </dd>
        </div>

        <div class="week-detail__row">
          <dt>Volume total</dt>
          <dd>${fb.volumeTotal ?? '—'} reps</dd>
        </div>

        <div class="week-detail__row">
          <dt>Feedbacks</dt>
          <dd>${this._formatFeedbackSummary(fb)}</dd>
        </div>

        <div class="week-detail__row">
          <dt>Complétion</dt>
          <dd>${this._formatCompletionRate(fb)}</dd>
        </div>
      </dl>
    `;
  }

  // ── Formatage — Données Semaine ────────────────────────

  /**
   * @returns {string|null} Ex: "+25%" ou null si pas de comparaison possible.
   */
  _formatWeekProgress(week) {
    if (week.previousTestMax == null || week.testMax == null) return null;
    if (week.previousTestMax === 0) return null;

    const pct = ((week.testMax - week.previousTestMax) / week.previousTestMax) * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(0)}%`;
  }

  _formatFeedbackSummary(fb) {
    const parts = [];
    if (fb.parfait)    parts.push(`${fb.parfait}${FEEDBACK_LABELS.parfait}`);
    if (fb.facile)     parts.push(`${fb.facile}${FEEDBACK_LABELS.facile}`);
    if (fb.impossible) parts.push(`${fb.impossible}${FEEDBACK_LABELS.impossible}`);
    return parts.length > 0 ? parts.join(' ') : '—';
  }

  _formatCompletionRate(fb) {
    const completed = (fb.facile || 0) + (fb.parfait || 0) + (fb.impossible || 0);
    const pct = Math.round((completed / TRAINING_DAYS_PER_WEEK) * 100);
    return `${completed}/${TRAINING_DAYS_PER_WEEK} séances (${pct}%)`;
  }

  // ── Scores des Algorithmes — Barres Horizontales ───────

  _buildAlgorithmSection() {
    const latestWeek = this._weeks[this._weeks.length - 1];
    const scores = latestWeek?.algorithmScores;

    if (!scores || Object.keys(scores).length === 0) return '';

    const sorted = Object.entries(scores)
      .filter(([, score]) => score != null)
      .sort(([, a], [, b]) => b - a);

    if (sorted.length === 0) return '';

    const maxScore = sorted[0][1] || 1;

    return `
      <section class="card card--algos" aria-label="Performance des algorithmes">
        <h2 class="card__subtitle">
          <span aria-hidden="true">🧠</span> Performance des algorithmes
        </h2>
        <div class="algo-bars" role="list"
             aria-label="Classement des algorithmes par score">
          ${sorted.map(([name, score]) =>
            this._buildAlgoBar(name, score, maxScore)
          ).join('')}
        </div>
      </section>
    `;
  }

  _buildAlgoBar(name, score, maxScore) {
    const meta = ALGO_META[name] || { label: name, color: '#888' };
    const widthPct = maxScore > 0 ? (score / maxScore) * 100 : 0;

    return `
      <div class="algo-bar" role="listitem"
           aria-label="${meta.label} : ${score.toFixed(1)} points">
        <span class="algo-bar__label">${meta.label}</span>
        <div class="algo-bar__track" aria-hidden="true">
          <div
            class="algo-bar__fill"
            style="--bar-width: ${widthPct.toFixed(1)}%; --bar-color: ${meta.color}"
          ></div>
        </div>
        <span class="algo-bar__value">${score.toFixed(1)}</span>
      </div>
    `;
  }

  // ── Bouton Export ──────────────────────────────────────

  _buildExportSection() {
    return `
      <section class="history__export">
        <button
          class="btn btn--secondary btn--export"
          data-action="export"
          type="button"
        >
          <span aria-hidden="true">📤</span> Exporter mes données
        </button>
      </section>
    `;
  }

  // ── Gestion des Événements ─────────────────────────────

  /**
   * Délégation unique sur le container.
   * Toutes les actions sont identifiées par data-action.
   */
  _attachEvents() {
    this._boundClickHandler = (e) => this._onContainerClick(e);
    this._container.addEventListener('click', this._boundClickHandler);
  }

  _detachEvents() {
    if (this._boundClickHandler) {
      this._container?.removeEventListener('click', this._boundClickHandler);
      this._boundClickHandler = null;
    }
    this._navigate = null;
  }

  _onContainerClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    switch (target.dataset.action) {
      case 'toggle-week':
        this._toggleWeekDetail(Number(target.dataset.week));
        break;
      case 'export':
        this._onExport();
        break;
      case 'back':
        this._navigateTo('dashboard');
        break;
    }
  }

  /**
   * Ouvre/ferme une section de détail semaine.
   * Manipule le DOM directement (pas de re-render complet)
   * pour conserver l'état d'ouverture des autres sections.
   */
  _toggleWeekDetail(weekNumber) {
    const detailEl = this._container.querySelector(`#week-detail-${weekNumber}`);
    const headerEl = this._container.querySelector(
      `[data-action="toggle-week"][data-week="${weekNumber}"]`
    );
    const chevronEl = headerEl?.querySelector('.week-item__chevron');

    if (!detailEl || !headerEl) return;

    const isOpen = this._expandedWeeks.has(weekNumber);

    if (isOpen) {
      this._expandedWeeks.delete(weekNumber);
      detailEl.hidden = true;
      detailEl.classList.remove('week-item__detail--open');
      headerEl.setAttribute('aria-expanded', 'false');
      chevronEl?.classList.remove('week-item__chevron--open');
    } else {
      this._expandedWeeks.add(weekNumber);
      detailEl.hidden = false;
      detailEl.classList.add('week-item__detail--open');
      headerEl.setAttribute('aria-expanded', 'true');
      chevronEl?.classList.add('week-item__chevron--open');
    }
  }

  /**
   * Import dynamique du module d'export — chargé uniquement au clic.
   */
  async _onExport() {
    const { exportData } = await import('../utils/export.js');
    await exportData();
  }

  // ── Animations ─────────────────────────────────────────

  /**
   * Animation line-draw SVG via stroke-dasharray.
   * Les points apparaissent en fondu décalé après la ligne.
   */
  _animateChart() {
    const line = this._container.querySelector('.chart__line');
    if (!line) return;

    const totalLength = Number(line.dataset.totalLength) || 500;

    line.style.strokeDasharray = `${totalLength}`;
    line.style.strokeDashoffset = `${totalLength}`;

    requestAnimationFrame(() => {
      line.style.transition = `stroke-dashoffset ${CHART.animationDuration} ease-out`;
      line.style.strokeDashoffset = '0';
    });

    const dots = this._container.querySelectorAll('.chart__dot');
    dots.forEach((dot, i) => {
      dot.style.opacity = '0';
      dot.style.transition = 'none';

      setTimeout(() => {
        dot.style.transition = 'opacity 0.3s ease-out';
        dot.style.opacity = '1';
      }, CHART.dotDelayMs + i * CHART.dotStaggerMs);
    });
  }

  /**
   * Fade-in + slide-up échelonné sur les sections principales.
   * Respecte prefers-reduced-motion via CSS.
   */
  _animateEntry() {
    const targets = this._container.querySelectorAll(
      '.card, .section__title, .history__export'
    );

    targets.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(16px)';

      requestAnimationFrame(() => {
        setTimeout(() => {
          el.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        }, i * ENTRY_STAGGER_MS);
      });
    });
  }

  // ── Navigation ─────────────────────────────────────────

  _navigateTo(screen) {
    if (typeof this._navigate === 'function') {
      this._navigate(screen);
      return;
    }
    window.location.hash = `#/${screen}`;
  }
}

export default new HistoryScreen();