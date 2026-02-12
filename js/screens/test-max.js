/* ════════════════════════════════════════════════════════════════
   AbdoPro — screens/test-max.js

   Responsabilité unique : saisie du test maximum hebdomadaire.
   ─────────────────────────────────────────────────────────────
   Écran en 2 phases :
   
   PHASE 1 — Saisie du test max
     Semaine 1 : Instructions + input numérique
     Semaine 2+: Récap semaine précédente + prédictions + input

   PHASE 2 — Résultat (après validation)
     Algorithme sélectionné + score + programme de la semaine
     Bouton "Aller au dashboard"

   Transition clé : c'est ici que engine.processNewWeek() est
   appelé, déclenchant la sélection d'algorithme et la
   génération du plan hebdomadaire.

   Contrat d'écran :
     render(container, params)  → Génère le HTML
     destroy()                  → Nettoie
   ════════════════════════════════════════════════════════════════ */

import state from '../utils/state.js';
import engine from '../algorithms/engine.js';
import notifications from '../utils/notifications.js';


// ── Constantes ──

/** Valeur initiale par défaut de l'input test max */
const DEFAULT_TEST_MAX = 10;

/** Valeur minimale autorisée */
const MIN_TEST_MAX = 1;

/** Valeur maximale autorisée */
const MAX_TEST_MAX = 200;

/** Pas d'incrémentation (+/−) */
const STEP = 1;

/** Pas d'incrémentation rapide (long press) */
const FAST_STEP = 5;

/** Délai avant le mode rapide (ms) */
const LONG_PRESS_DELAY = 400;

/** Intervalle du mode rapide (ms) */
const LONG_PRESS_INTERVAL = 100;

/** Mapping type → label lisible pour le programme */
const TYPE_LABELS = {
  ENDURANCE:    'Endurance',
  HYPERTROPHIE: 'Hypertrophie',
  FORCE:        'Force',
  MIXTE:        'Mixte',
  DELOAD:       'Deload',
  DEBUTANT:     'Débutant',
  RECOVERY:     'Récupération',
  MODERATE:     'Modéré',
  INTENSE:      'Intense',
  LIGHT:        'Léger',
  ADAPTATIF:    'Adaptatif',
  STANDARD:     'Standard'
};

Object.freeze(TYPE_LABELS);

/** Noms lisibles des algorithmes (fallback si engine non dispo) */
const ALGO_LABELS = {
  linear:     'Linéaire (Prilepin)',
  banister:   'Fitness-Fatigue (Banister)',
  dup:        'Ondulation Quotidienne (DUP)',
  rir:        'Autorégulation (RIR)',
  regression: 'Régression Adaptative'
};

Object.freeze(ALGO_LABELS);


// ── Écran TestMax ──

const TestMaxScreen = {

  /** @type {Function|null} */
  _navigateTo: null,

  /** @type {AbortController|null} */
  _abortController: null,

  /** @type {HTMLElement|null} */
  _container: null,

  /** @type {number} Valeur courante de l'input */
  _currentValue: DEFAULT_TEST_MAX,

  /** @type {string} Phase courante : 'input' ou 'result' */
  _phase: 'input',

  /** @type {Object|null} Résultat de processNewWeek */
  _result: null,

  /** @type {number|null} Timer pour le long press */
  _longPressTimer: null,

  /** @type {number|null} Interval pour le long press rapide */
  _longPressInterval: null,


  /* ──────────────────────────────────────────────────────────
     RENDER
     ────────────────────────────────────────────────────────── */

  async render(container, params) {
    this._navigateTo = params.navigateTo;
    this._container = container;
    this._abortController = new AbortController();
    this._phase = 'input';
    this._result = null;

    // Initialiser la valeur par défaut
    this._currentValue = this._getDefaultValue();

    // Initialiser le moteur algorithmique
    engine.initialize();

    // Afficher la phase de saisie
    this._renderInputPhase();
  },


  /* ──────────────────────────────────────────────────────────
     DESTROY
     ────────────────────────────────────────────────────────── */

  destroy() {
    this._clearLongPress();

    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    this._navigateTo = null;
    this._container = null;
    this._result = null;
    this._phase = 'input';
  },


  /* ──────────────────────────────────────────────────────────
     PHASES DE RENDU
     ────────────────────────────────────────────────────────── */

  /**
   * Affiche la phase de saisie du test max.
   * @private
   */
  _renderInputPhase() {
    if (!this._container) return;

    const weekNumber = state.getCurrentWeekNumber();
    const isFirstWeek = weekNumber <= 1 || !state.getCurrentTestMax();

    this._container.innerHTML = isFirstWeek
      ? this._buildFirstWeekHTML(weekNumber)
      : this._buildRecurringWeekHTML(weekNumber);

    this._attachInputEvents();
  },

  /**
   * Affiche la phase de résultat après validation.
   * @private
   */
  _renderResultPhase() {
    if (!this._container || !this._result) return;

    this._container.innerHTML = this._buildResultHTML();
    this._attachResultEvents();
  },


  /* ──────────────────────────────────────────────────────────
     HTML — PREMIÈRE SEMAINE
     ────────────────────────────────────────────────────────── */

  /**
   * @param {number} weekNumber
   * @returns {string}
   * @private
   */
  _buildFirstWeekHTML(weekNumber) {
    return `
      <div class="screen centered" role="main" aria-label="Test maximum">

        <header class="screen-header text-center">
          <span class="screen-header__subtitle">Semaine ${weekNumber} — Jour 1</span>
          <h1 class="screen-header__title">Test Maximum</h1>
        </header>

        <!-- Instructions -->
        <div class="card mb-6">
          <div class="card__body">
            <p class="text-sm mb-4">
              Faites le maximum d'abdominaux en une seule série, sans pause.
            </p>
            <div class="detail-list">
              <div class="detail-item">
                <dt class="detail-item__label">💡 Position</dt>
                <dd class="detail-item__value text-sm">Dos au sol, genoux pliés</dd>
              </div>
              <div class="detail-item">
                <dt class="detail-item__label">🎯 Objectif</dt>
                <dd class="detail-item__value text-sm">Aller jusqu'à l'épuisement</dd>
              </div>
              <div class="detail-item">
                <dt class="detail-item__label">⏱️ Repos</dt>
                <dd class="detail-item__value text-sm">Aucun, une seule série</dd>
              </div>
            </div>
          </div>
        </div>

        <!-- Input -->
        <div class="mb-4">
          <p class="text-center text-secondary text-sm mb-4">
            Combien avez-vous fait ?
          </p>
          ${this._buildNumericInput()}
        </div>

        <!-- Bouton valider -->
        <div class="w-full mt-6">
          <button class="btn btn-primary btn-lg btn-block btn-ripple"
                  data-action="validate"
                  type="button">
            Valider mon test max
          </button>
        </div>

      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     HTML — SEMAINE RÉCURRENTE (2+)
     ────────────────────────────────────────────────────────── */

  /**
   * @param {number} weekNumber
   * @returns {string}
   * @private
   */
  _buildRecurringWeekHTML(weekNumber) {
    const recap = this._buildRecapSection(weekNumber);
    const predictions = this._buildPredictionsSection(weekNumber);

    return `
      <div class="screen" role="main" aria-label="Test maximum semaine ${weekNumber}">

        <header class="screen-header">
          <span class="screen-header__subtitle">Semaine ${weekNumber} — Jour 1</span>
          <h1 class="screen-header__title">Test Maximum</h1>
        </header>

        <!-- Récapitulatif semaine précédente -->
        ${recap}

        <!-- Prédictions algorithmiques -->
        ${predictions}

        <hr class="screen-divider">

        <!-- Input -->
        <div class="mb-4">
          <p class="text-secondary text-sm mb-4">
            Faites votre test maximum et entrez le résultat :
          </p>
          ${this._buildNumericInput()}
        </div>

        <!-- Bouton valider -->
        <div class="w-full mt-6 mb-6">
          <button class="btn btn-primary btn-lg btn-block btn-ripple"
                  data-action="validate"
                  type="button">
            Valider mon test max
          </button>
        </div>

      </div>
    `;
  },

  /**
   * Construit le récapitulatif de la semaine précédente.
   *
   * @param {number} weekNumber — Semaine courante
   * @returns {string}
   * @private
   */
  _buildRecapSection(weekNumber) {
    const history = state.getHistory();
    const previousWeek = history.length > 0 ? history[history.length - 1] : null;

    if (!previousWeek) return '';

    const prevNumber = previousWeek.weekNumber || weekNumber - 1;
    const prevMax = previousWeek.testMax || '—';
    const prevAlgo = previousWeek.selectedAlgorithm || 'linear';
    const prevAlgoLabel = ALGO_LABELS[prevAlgo] || prevAlgo;

    // Feedbacks
    const fb = previousWeek.feedbackSummary || {};
    const fbParts = [];
    if (fb.parfait) fbParts.push(`${fb.parfait} Parfait`);
    if (fb.facile) fbParts.push(`${fb.facile} Facile`);
    if (fb.impossible) fbParts.push(`${fb.impossible} Impossible`);
    const fbText = fbParts.length > 0 ? fbParts.join(', ') : 'Aucun';

    // Volume
    const volume = fb.volumeRealiseTotale || fb.volumeTotal || '—';

    // Séances complétées
    const completed = (fb.facile || 0) + (fb.parfait || 0) + (fb.impossible || 0);

    return `
      <div class="card mb-4">
        <div class="card__header">
          <h2 class="card__title text-sm">📊 Récap semaine ${prevNumber}</h2>
        </div>
        <div class="card__body">
          <dl class="detail-list">
            <div class="detail-item">
              <dt class="detail-item__label">Test max</dt>
              <dd class="detail-item__value mono">${prevMax} reps</dd>
            </div>
            <div class="detail-item">
              <dt class="detail-item__label">Séances</dt>
              <dd class="detail-item__value mono">${completed}/6</dd>
            </div>
            <div class="detail-item">
              <dt class="detail-item__label">Feedbacks</dt>
              <dd class="detail-item__value text-sm">${fbText}</dd>
            </div>
            <div class="detail-item">
              <dt class="detail-item__label">Volume total</dt>
              <dd class="detail-item__value mono">${volume} reps</dd>
            </div>
            <div class="detail-item">
              <dt class="detail-item__label">Algorithme</dt>
              <dd class="detail-item__value text-sm">${prevAlgoLabel}</dd>
            </div>
          </dl>
        </div>
      </div>
    `;
  },

  /**
   * Construit la section des prédictions algorithmiques.
   *
   * @param {number} weekNumber
   * @returns {string}
   * @private
   */
  _buildPredictionsSection(weekNumber) {
    const history = state.getHistory();

    if (history.length === 0) return '';

    // Construire l'historique pour les algorithmes
    let algoHistory;
    try {
      // Utiliser le cache synchrone si possible
      algoHistory = history.map(w => ({
        weekNumber: w.weekNumber,
        testMax: w.testMax,
        selectedAlgorithm: w.selectedAlgorithm,
        feedbackSummary: w.feedbackSummary,
        sessions: w.sessions || [],
        plan: w.plan
      }));
    } catch {
      return '';
    }

    // Obtenir les prédictions
    const predictions = engine.getAllPredictions(weekNumber, algoHistory);

    if (!predictions || Object.keys(predictions).length === 0) return '';

    // Construire les lignes de prédiction
    const rows = Object.entries(predictions)
      .filter(([, value]) => value !== null)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => {
        const label = ALGO_LABELS[name] || name;
        return `
          <div class="detail-item">
            <dt class="detail-item__label">${label}</dt>
            <dd class="detail-item__value mono">${value} reps</dd>
          </div>
        `;
      })
      .join('');

    return `
      <div class="card mb-4">
        <div class="card__header">
          <h2 class="card__title text-sm">🧠 Prédictions test max</h2>
        </div>
        <div class="card__body">
          <dl class="detail-list">
            ${rows}
          </dl>
        </div>
      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     HTML — INPUT NUMÉRIQUE
     ────────────────────────────────────────────────────────── */

  /**
   * Construit le composant d'input numérique (+/−).
   *
   * @returns {string}
   * @private
   */
  _buildNumericInput() {
    return `
      <div class="num-input" role="group" aria-label="Nombre de répétitions">
        <button class="num-input__btn"
                data-action="decrement"
                type="button"
                aria-label="Diminuer de 1">
          −
        </button>
        <span class="num-input__value"
              id="test-max-value"
              role="spinbutton"
              aria-valuenow="${this._currentValue}"
              aria-valuemin="${MIN_TEST_MAX}"
              aria-valuemax="${MAX_TEST_MAX}">
          ${this._currentValue}
        </span>
        <button class="num-input__btn"
                data-action="increment"
                type="button"
                aria-label="Augmenter de 1">
          +
        </button>
      </div>
    `;
  },

  /**
   * Met à jour l'affichage de la valeur.
   * @private
   */
  _updateValueDisplay() {
    const display = this._container?.querySelector('#test-max-value');
    if (display) {
      display.textContent = this._currentValue;
      display.setAttribute('aria-valuenow', this._currentValue);
    }
  },


  /* ──────────────────────────────────────────────────────────
     HTML — RÉSULTAT
     ────────────────────────────────────────────────────────── */

  /**
   * Construit le HTML de la phase résultat.
   *
   * @returns {string}
   * @private
   */
  _buildResultHTML() {
    const result = this._result;
    if (!result) return '';

    const weekNumber = state.getCurrentWeekNumber();
    const testMax = this._currentValue;
    const progression = this._calculateProgression(testMax);

    return `
      <div class="screen" role="main" aria-label="Résultat du test">

        <!-- Confirmation -->
        <div class="card card--highlight mb-6">
          <div class="card__body text-center">
            <div class="text-3xl mb-2" aria-hidden="true">✅</div>
            <h1 class="text-2xl font-bold mb-2">
              Test enregistré : ${testMax} reps
            </h1>
            ${progression !== null ? `
              <p class="text-lg ${progression >= 0 ? 'color-success' : 'color-danger'}">
                ${progression >= 0 ? '+' : ''}${progression}% vs semaine précédente
              </p>
            ` : ''}
          </div>
        </div>

        <!-- Algorithme sélectionné -->
        ${this._buildAlgorithmResultCard(result)}

        <!-- Programme de la semaine -->
        ${this._buildWeekPlanCard(result)}

        <!-- Bouton dashboard -->
        <div class="w-full mt-4 mb-6">
          <button class="btn btn-primary btn-lg btn-block btn-ripple"
                  data-action="go-dashboard"
                  type="button">
            Aller au dashboard
          </button>
        </div>

      </div>
    `;
  },

  /**
   * Carte de l'algorithme sélectionné.
   *
   * @param {Object} result
   * @returns {string}
   * @private
   */
  _buildAlgorithmResultCard(result) {
    const scoreText = result.scores
      ? `Score : ${result.scores[result.algorithm]?.composite || '—'}/100`
      : '';

    const reliabilityBadge = result.reliability?.reliable
      ? '<span class="badge badge--success">Fiable</span>'
      : '<span class="badge badge--warning">En calibration</span>';

    return `
      <div class="card mb-4">
        <div class="card__header">
          <h2 class="card__title text-sm">🧠 Algorithme sélectionné</h2>
          ${reliabilityBadge}
        </div>
        <div class="card__body">
          <p class="font-bold text-lg mb-2">${result.algorithmLabel}</p>
          ${scoreText ? `<p class="text-sm text-secondary mono mb-2">${scoreText}</p>` : ''}
          <p class="text-sm text-secondary">${result.reason}</p>
        </div>
        ${result.scores ? this._buildScoreBars(result) : ''}
      </div>
    `;
  },

  /**
   * Construit les barres de score des algorithmes.
   *
   * @param {Object} result
   * @returns {string}
   * @private
   */
  _buildScoreBars(result) {
    if (!result.scores) return '';

    const entries = Object.entries(result.scores)
      .filter(([, s]) => s && typeof s.composite === 'number')
      .sort(([, a], [, b]) => b.composite - a.composite);

    if (entries.length === 0) return '';

    const bestName = entries[0][0];

    const barsHTML = entries.map(([name, scores]) => {
      const isBest = name === bestName;
      const label = ALGO_LABELS[name] || name;
      const shortLabel = label.split(' ')[0]; // Premier mot
      const percent = Math.min(100, Math.max(0, scores.composite));

      return `
        <div class="score-bar ${isBest ? 'score-bar--best' : ''}">
          <span class="score-bar__label">${shortLabel}</span>
          <div class="score-bar__track">
            <div class="score-bar__fill" style="width: ${percent}%"></div>
          </div>
          <span class="score-bar__value">${scores.composite.toFixed(1)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="card__footer flex-col gap-2">
        ${barsHTML}
      </div>
    `;
  },

  /**
   * Carte du programme de la semaine.
   *
   * @param {Object} result
   * @returns {string}
   * @private
   */
  _buildWeekPlanCard(result) {
    if (!result.plan) return '';

    const rows = Object.entries(result.plan)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, plan]) => {
        const dayNum = dayKey.replace('day', '');
        const typeLabel = TYPE_LABELS[plan.type] || plan.type;
        const restFormatted = this._formatRest(plan.rest);

        return `
          <div class="detail-item">
            <dt class="detail-item__label">J${dayNum}</dt>
            <dd class="detail-item__value text-sm mono">
              ${plan.series} × ${plan.reps} · ${typeLabel} · ${restFormatted}
            </dd>
          </div>
        `;
      })
      .join('');

    return `
      <div class="card mb-4">
        <div class="card__header">
          <h2 class="card__title text-sm">📋 Programme de la semaine</h2>
        </div>
        <div class="card__body">
          <dl class="detail-list">
            ${rows}
          </dl>
        </div>
      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     ÉVÉNEMENTS — PHASE INPUT
     ────────────────────────────────────────────────────────── */

  /**
   * Attache les événements de la phase de saisie.
   * @private
   */
  _attachInputEvents() {
    if (!this._container || !this._abortController) return;
    const signal = this._abortController.signal;

    // Délégation des clics
    this._container.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;

      if (action === 'increment') {
        this._adjustValue(STEP);
      } else if (action === 'decrement') {
        this._adjustValue(-STEP);
      } else if (action === 'validate') {
        this._handleValidate(target);
      }
    }, { signal });

    // Long press pour incrémentation rapide
    this._setupLongPress('increment', FAST_STEP, signal);
    this._setupLongPress('decrement', -FAST_STEP, signal);

    // Clavier (accessibilité)
    this._container.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._adjustValue(STEP);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._adjustValue(-STEP);
      }
    }, { signal });
  },

  /**
   * Configure le long press sur un bouton +/−.
   *
   * @param {string} action — 'increment' ou 'decrement'
   * @param {number} step — Valeur d'ajustement par tick
   * @param {AbortSignal} signal
   * @private
   */
  _setupLongPress(action, step, signal) {
    const buttons = this._container.querySelectorAll(`[data-action="${action}"]`);

    buttons.forEach(button => {
      // Début du long press
      const startHandler = (e) => {
        e.preventDefault();
        this._clearLongPress();

        this._longPressTimer = setTimeout(() => {
          this._longPressInterval = setInterval(() => {
            this._adjustValue(step);
          }, LONG_PRESS_INTERVAL);
        }, LONG_PRESS_DELAY);
      };

      // Fin du long press
      const endHandler = () => {
        this._clearLongPress();
      };

      button.addEventListener('pointerdown', startHandler, { signal });
      button.addEventListener('pointerup', endHandler, { signal });
      button.addEventListener('pointerleave', endHandler, { signal });
      button.addEventListener('pointercancel', endHandler, { signal });
    });
  },

  /**
   * Nettoie les timers de long press.
   * @private
   */
  _clearLongPress() {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
    if (this._longPressInterval) {
      clearInterval(this._longPressInterval);
      this._longPressInterval = null;
    }
  },

  /**
   * Ajuste la valeur courante.
   *
   * @param {number} delta — Valeur à ajouter (positif ou négatif)
   * @private
   */
  _adjustValue(delta) {
    const newValue = this._currentValue + delta;
    this._currentValue = Math.max(MIN_TEST_MAX, Math.min(MAX_TEST_MAX, newValue));
    this._updateValueDisplay();
  },


  /* ──────────────────────────────────────────────────────────
     ÉVÉNEMENTS — PHASE RÉSULTAT
     ────────────────────────────────────────────────────────── */

  /**
   * Attache les événements de la phase résultat.
   * @private
   */
  _attachResultEvents() {
    if (!this._container || !this._abortController) return;
    const signal = this._abortController.signal;

    this._container.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      if (target.dataset.action === 'go-dashboard') {
        if (this._navigateTo) {
          this._navigateTo('dashboard');
        }
      }
    }, { signal });
  },


  /* ──────────────────────────────────────────────────────────
     VALIDATION DU TEST MAX
     ────────────────────────────────────────────────────────── */

  /**
   * Gère la validation du test max.
   *
   * @param {HTMLElement} button
   * @private
   */
  async _handleValidate(button) {
    const testMax = this._currentValue;

    if (testMax < MIN_TEST_MAX) return;

    try {
      // Désactiver le bouton
      button.disabled = true;
      button.textContent = 'Analyse en cours...';

      // Récupérer l'historique pour les algorithmes
      const weekHistory = await state.getAlgorithmHistory();
      const scoringHistory = state.getScoringHistory();
      const weekNumber = state.getCurrentWeekNumber();

      // Vérifier si la semaine précédente avait un "Impossible"
      const history = state.getHistory();
      const previousWeek = history.length > 0 ? history[history.length - 1] : null;
      const hasImpossibleLastWeek = previousWeek?.feedbackSummary?.impossible > 0;

      // Lancer le processus complet du moteur algorithmique
      const result = engine.processNewWeek(
        weekNumber,
        testMax,
        weekHistory,
        scoringHistory,
        hasImpossibleLastWeek
      );

      this._result = result;

      // Sauvegarder le test max et le plan dans le state
      await state.saveTestMax(testMax, {
        selectedAlgorithm: result.algorithm,
        algorithmScores: result.scores,
        predictions: result.predictions,
        plan: result.plan
      });

      // Sauvegarder le scoring
      if (result.scores) {
        await state.setAlgorithm(
          result.algorithm,
          result.scores,
          result.predictions,
          result.reason
        );
      }

      // Sauvegarder le plan
      await state.saveWeekPlan(result.plan);

      // Notification de succès
      notifications.notifyTestMaxSaved();

      // Passer à la phase résultat
      this._phase = 'result';
      this._renderResultPhase();

    } catch (error) {
      console.error('Erreur lors de la validation du test max :', error);

      button.disabled = false;
      button.textContent = 'Valider mon test max';

      this._showError('Une erreur est survenue. Veuillez réessayer.');
    }
  },


  /* ──────────────────────────────────────────────────────────
     UTILITAIRES
     ────────────────────────────────────────────────────────── */

  /**
   * Détermine la valeur initiale de l'input.
   *
   * @returns {number}
   * @private
   */
  _getDefaultValue() {
    // Utiliser le dernier test max + 10% comme suggestion
    const lastMax = state.getCurrentTestMax();

    if (lastMax && lastMax > 0) {
      return Math.round(lastMax * 1.1);
    }

    return DEFAULT_TEST_MAX;
  },

  /**
   * Calcule la progression en % par rapport à la semaine précédente.
   *
   * @param {number} currentMax
   * @returns {number|null}
   * @private
   */
  _calculateProgression(currentMax) {
    const history = state.getHistory();

    if (history.length < 1) return null;

    // Chercher le test max de la semaine précédente (pas la courante)
    for (let i = history.length - 1; i >= 0; i--) {
      const week = history[i];
      if (week.weekNumber < state.getCurrentWeekNumber() &&
          typeof week.testMax === 'number' && week.testMax > 0) {
        return Math.round(((currentMax - week.testMax) / week.testMax) * 100);
      }
    }

    return null;
  },

  /**
   * Formate un temps de repos.
   *
   * @param {number} seconds
   * @returns {string}
   * @private
   */
  _formatRest(seconds) {
    if (!seconds || seconds <= 0) return '—';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs === 0 ? `${mins}min` : `${mins}m${secs}s`;
  },

  /**
   * Affiche un message d'erreur.
   *
   * @param {string} message
   * @private
   */
  _showError(message) {
    if (!this._container) return;

    // Retirer l'erreur précédente
    const existing = this._container.querySelector('.test-max-error');
    if (existing) existing.remove();

    const errorDiv = document.createElement('div');
    errorDiv.className = 'test-max-error card card--highlight mt-4';
    errorDiv.setAttribute('role', 'alert');
    errorDiv.innerHTML = `
      <div class="card__body text-center">
        <p class="text-sm color-danger">${message}</p>
      </div>
    `;

    // Insérer avant le bouton de validation
    const button = this._container.querySelector('[data-action="validate"]');
    if (button) {
      button.parentNode.insertBefore(errorDiv, button.parentNode.firstChild);
    } else {
      this._container.appendChild(errorDiv);
    }
  }
};


// ── Export ──


export default TestMaxScreen;
