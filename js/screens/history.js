/* ════════════════════════════════════════════════════════════════
   AbdoPro — screens/history.js
   
   Responsabilité unique : affichage de l'historique et des stats.
   ─────────────────────────────────────────────────────────────
   Contenu :
   1. Graphique de progression (Test Max).
   2. Classement des algorithmes (Scoring).
   3. Historique détaillé par semaine (Accordéons).
   4. Actions de maintenance (Export).
   ════════════════════════════════════════════════════════════════ */

import state from '../state.js';
import { exportData } from '../utils/export.js';

const HistoryScreen = {
  _container: null,
  _abortController: null,

  async render(container, params) {
    this._container = container;
    this._abortController = new AbortController();

    const history = state.getHistory();
    
    if (!history || history.length === 0) {
      this._renderEmptyState();
      return;
    }

    this._renderUI(history);
  },

  destroy() {
    if (this._abortController) {
      this._abortController.abort();
    }
    this._container = null;
  },

  _renderEmptyState() {
    this._container.innerHTML = `
      <div class="screen centered">
        <div class="text-3xl mb-4">📊</div>
        <h1 class="screen-header__title">Historique vide</h1>
        <p class="text-secondary text-center">
          Complétez votre première semaine pour voir vos statistiques de progression ici.
        </p>
      </div>
    `;
  },

  _renderUI(history) {
    const lastWeek = history[history.length - 1];
    
    this._container.innerHTML = `
      <div class="screen">
        <header class="screen-header">
          <span class="screen-header__subtitle">Statistiques</span>
          <h1 class="screen-header__title">Votre Progression</h1>
        </header>

        <!-- 1. Graphique (Composant Section 15) -->
        <section class="mb-8">
          <h3 class="mb-4 text-sm uppercase text-muted">Évolution Test Max</h3>
          <div class="chart-container">
            ${this._buildSVGChart(history)}
          </div>
        </section>

        <!-- 2. Scoring Algorithmes (Composant Section 8) -->
        ${this._buildAlgoScoring(lastWeek)}

        <!-- 3. Liste des semaines (Composant Section 17) -->
        <section class="mb-8">
          <h3 class="mb-4 text-sm uppercase text-muted">Détail des semaines</h3>
          <div class="flex-col gap-3">
            ${history.slice().reverse().map(w => this._buildWeekAccordion(w)).join('')}
          </div>
        </section>

        <!-- 4. Actions -->
        <footer class="mt-4 mb-8">
          <button class="btn btn-ghost btn-block" data-action="export">
            📤 Exporter mes données (JSON)
          </button>
        </footer>
      </div>
    `;

    this._attachEvents();
  },

  _buildSVGChart(history) {
    const data = history.filter(w => w.testMax !== null);
    if (data.length < 2) return `<div class="flex-center h-full text-muted text-sm">Plus de données requises pour le graphique</div>`;

    const width = 300;
    const height = 150;
    const padding = 20;
    
    const maxVal = Math.max(...data.map(d => d.testMax)) * 1.2;
    const minVal = 0;

    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
      const y = height - ((d.testMax / maxVal) * (height - padding * 2) + padding);
      return `${x},${y}`;
    }).join(' ');

    return `
      <svg viewBox="0 0 ${width} ${height}" class="w-full h-full">
        <polyline fill="none" stroke="var(--accent-primary)" stroke-width="3" 
                  stroke-linecap="round" stroke-linejoin="round" 
                  points="${points}" />
        ${data.map((d, i) => {
          const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
          const y = height - ((d.testMax / maxVal) * (height - padding * 2) + padding);
          return `<circle cx="${x}" cy="${y}" r="4" fill="var(--bg-card)" stroke="var(--accent-primary)" stroke-width="2" />`;
        }).join('')}
      </svg>
    `;
  },

  _buildAlgoScoring(week) {
    if (!week.algorithmScores) return '';

    const scores = Object.entries(week.algorithmScores)
      .sort(([, a], [, b]) => b.composite - a.composite);

    return `
      <section class="card mb-8">
        <div class="card__header">
          <h3 class="card__title text-sm">Précision des algorithmes</h3>
        </div>
        <div class="card__body gap-4">
          ${scores.map(([name, s]) => `
            <div class="score-bar ${name === week.selectedAlgorithm ? 'score-bar--best' : ''}">
              <span class="score-bar__label">${name.toUpperCase()}</span>
              <div class="score-bar__track">
                <div class="score-bar__fill" style="width: ${s.composite}%"></div>
              </div>
              <span class="score-bar__value">${Math.round(s.composite)}</span>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  },

  _buildWeekAccordion(week) {
    const fb = week.feedbackSummary || {};
    return `
      <details class="accordion">
        <summary class="accordion__header">
          <span class="accordion__title">Semaine ${week.weekNumber}</span>
          <span class="mono text-sm">${week.testMax} reps</span>
          <span class="accordion__chevron">▶</span>
        </summary>
        <div class="accordion__content">
          <dl class="detail-list">
            <div class="detail-item">
              <dt class="detail-item__label">Algorithme utilisé</dt>
              <dd class="detail-item__value">${week.selectedAlgorithm}</dd>
            </div>
            <div class="detail-item">
              <dt class="detail-item__label">Volume réalisé</dt>
              <dd class="detail-item__value">${fb.volumeRealiseTotale || 0} reps</dd>
            </div>
            <div class="detail-item">
              <dt class="detail-item__label">Feedbacks</dt>
              <dd class="detail-item__value">
                ✅${fb.parfait || 0}  😊${fb.facile || 0}  ❌${fb.impossible || 0}
              </dd>
            </div>
          </dl>
        </div>
      </details>
    `;
  },

  _attachEvents() {
    const signal = this._abortController.signal;
    this._container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="export"]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Génération...';
        await exportData();
        btn.disabled = false;
        btn.textContent = '📤 Exporter mes données (JSON)';
      }
    }, { signal });
  }
};

export default HistoryScreen;