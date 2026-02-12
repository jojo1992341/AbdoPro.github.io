/* ════════════════════════════════════════════════════════════════
   AbdoPro — screens/session.js

   Responsabilité unique : séance d'entraînement active.
   ─────────────────────────────────────────────────────────────
   Machine à 6 états :

     READY       → Affiche le programme, bouton "Commencer"
     EXERCISING  → Série en cours, objectif reps, boutons actions
     RESTING     → Timer circulaire décomptant, skip possible
     COMPLETED   → Toutes les séries terminées → feedback
     FAILED      → Saisie reps partielles après "Impossible"
     SAVING      → Enregistrement en cours (transitoire)

   Transitions :
     READY      → EXERCISING  (clic "Commencer")
     EXERCISING → RESTING     (clic "Série terminée")
     EXERCISING → FAILED      (clic "Impossible")
     RESTING    → EXERCISING  (timer fini ou "Skip")
     EXERCISING → COMPLETED   (dernière série terminée)
     COMPLETED  → [navigation vers feedback]
     FAILED     → [navigation vers dashboard]

   Contrat d'écran :
     render(container, params)  → Génère le HTML
     destroy()                  → Nettoie timer, listeners, etc.
   ════════════════════════════════════════════════════════════════ */

import state from '../state.js';
import { RestTimer, TIMER_STATE } from '../utils/timer.js';
import { updateTimerUI, getCircleCircumference } from '../utils/timer.js';
import notifications from '../utils/notifications.js';


// ── Constantes ──

/** États de la machine */
const SESSION_STATE = {
  READY:      'ready',
  EXERCISING: 'exercising',
  RESTING:    'resting',
  COMPLETED:  'completed',
  FAILED:     'failed',
  SAVING:     'saving'
};

Object.freeze(SESSION_STATE);

/** Valeur min/max pour la saisie de reps partielles */
const PARTIAL_REPS_MIN = 0;

/** Mapping type → label */
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

/** Mapping type → emoji */
const TYPE_EMOJIS = {
  ENDURANCE: '🏃', HYPERTROPHIE: '💪', FORCE: '🔥', MIXTE: '⚡',
  DELOAD: '🧘', DEBUTANT: '🌱', RECOVERY: '🧘', MODERATE: '⚡',
  INTENSE: '🔥', LIGHT: '🌿', ADAPTATIF: '🎯', STANDARD: '⚡'
};

Object.freeze(TYPE_LABELS);
Object.freeze(TYPE_EMOJIS);


// ── Écran Session ──

const SessionScreen = {

  /** @type {Function|null} */
  _navigateTo: null,

  /** @type {AbortController|null} */
  _abortController: null,

  /** @type {HTMLElement|null} */
  _container: null,

  /** @type {RestTimer|null} */
  _timer: null,

  /* ── État de la séance ── */

  /** @type {string} État courant de la machine */
  _state: SESSION_STATE.READY,

  /** @type {Object|null} Plan du jour { series, reps, rest, type } */
  _plan: null,

  /** @type {number} Numéro de la série courante (1-based) */
  _currentSeries: 1,

  /** @type {Array<Object>} Détail de chaque série complétée */
  _seriesDetail: [],

  /** @type {number} Timestamp de début de séance */
  _sessionStart: 0,

  /** @type {number} Timestamp de début de série courante */
  _seriesStart: 0,

  /** @type {number} Valeur courante de l'input reps partielles */
  _partialReps: 0,

  /** @type {Object|null} Éléments DOM du timer (cache) */
  _timerElements: null,


  /* ──────────────────────────────────────────────────────────
     RENDER
     ────────────────────────────────────────────────────────── */

  async render(container, params) {
    this._navigateTo = params.navigateTo;
    this._container = container;
    this._abortController = new AbortController();

    // Récupérer le plan du jour
    this._plan = state.getCurrentDayPlan();

    if (!this._plan) {
      this._showNoPlanError();
      return;
    }

    // Initialiser l'état
    this._state = SESSION_STATE.READY;
    this._currentSeries = 1;
    this._seriesDetail = [];
    this._sessionStart = 0;
    this._partialReps = 0;
    this._timerElements = null;

    // Initialiser les notifications
    notifications.init();

    // Afficher l'écran initial
    this._render();
  },


  /* ──────────────────────────────────────────────────────────
     DESTROY
     ────────────────────────────────────────────────────────── */

  destroy() {
    if (this._timer) {
      this._timer.destroy();
      this._timer = null;
    }

    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    this._timerElements = null;
    this._navigateTo = null;
    this._container = null;
    this._plan = null;
    this._seriesDetail = [];
  },


  /* ──────────────────────────────────────────────────────────
     RENDU CENTRAL (dispatch selon l'état)
     ────────────────────────────────────────────────────────── */

  /**
   * Met à jour le rendu selon l'état courant.
   * @private
   */
  _render() {
    if (!this._container) return;

    switch (this._state) {
      case SESSION_STATE.READY:
        this._container.innerHTML = this._buildReadyHTML();
        break;
      case SESSION_STATE.EXERCISING:
        this._container.innerHTML = this._buildExercisingHTML();
        break;
      case SESSION_STATE.RESTING:
        this._container.innerHTML = this._buildRestingHTML();
        this._cacheTimerElements();
        this._startRestTimer();
        break;
      case SESSION_STATE.COMPLETED:
        this._container.innerHTML = this._buildCompletedHTML();
        break;
      case SESSION_STATE.FAILED:
        this._container.innerHTML = this._buildFailedHTML();
        break;
      case SESSION_STATE.SAVING:
        this._container.innerHTML = this._buildSavingHTML();
        break;
    }

    this._attachEvents();
  },


  /* ──────────────────────────────────────────────────────────
     HTML — ÉTAT READY
     ────────────────────────────────────────────────────────── */

  _buildReadyHTML() {
    const p = this._plan;
    const dayNumber = state.getCurrentDayNumber();
    const typeLabel = TYPE_LABELS[p.type] || p.type;
    const typeEmoji = TYPE_EMOJIS[p.type] || '⚡';
    const totalVolume = p.series * p.reps;

    return `
      <div class="screen centered" role="main" aria-label="Préparation de la séance">
        <header class="screen-header text-center">
          <span class="screen-header__subtitle">${typeEmoji} Séance J${dayNumber} — ${typeLabel}</span>
          <h1 class="screen-header__title">Prêt ?</h1>
        </header>

        <div class="card mb-6 w-full">
          <div class="card__body">
            <dl class="detail-list">
              <div class="detail-item">
                <dt class="detail-item__label">Programme</dt>
                <dd class="detail-item__value mono">${p.series} séries × ${p.reps} reps</dd>
              </div>
              <div class="detail-item">
                <dt class="detail-item__label">Volume total</dt>
                <dd class="detail-item__value mono">${totalVolume} reps</dd>
              </div>
              <div class="detail-item">
                <dt class="detail-item__label">Repos entre séries</dt>
                <dd class="detail-item__value mono">${this._formatRest(p.rest)}</dd>
              </div>
            </dl>
          </div>
        </div>

        <button class="btn btn-primary btn-lg btn-block btn-ripple"
                data-action="start-session"
                type="button">
          Commencer
        </button>
      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     HTML — ÉTAT EXERCISING
     ────────────────────────────────────────────────────────── */

  _buildExercisingHTML() {
    const p = this._plan;
    const progressPercent = Math.round(
      ((this._currentSeries - 1) / p.series) * 100
    );

    return `
      <div class="screen centered" role="main" aria-label="Série en cours">
        <header class="screen-header text-center">
          <span class="screen-header__subtitle">
            ${TYPE_EMOJIS[p.type] || '⚡'} Séance J${state.getCurrentDayNumber()} — ${TYPE_LABELS[p.type] || p.type}
          </span>
          <h1 class="screen-header__title">
            Série ${this._currentSeries} / ${p.series}
          </h1>
        </header>

        <!-- Objectif reps -->
        <div class="flex-col flex-center gap-2 mb-8">
          <div class="text-4xl font-bold mono color-primary">${p.reps}</div>
          <div class="text-secondary text-sm">reps à faire</div>
        </div>

        <!-- Bouton série terminée -->
        <button class="btn btn-success btn-lg btn-block btn-ripple mb-4"
                data-action="series-done"
                type="button">
          ✅ Série terminée
        </button>

        <!-- Bouton impossible -->
        <button class="btn btn-danger btn-block btn-ripple mb-6"
                data-action="impossible"
                type="button">
          ❌ Impossible
        </button>

        <!-- Barre de progression -->
        <div class="progress-labeled w-full">
          <div class="progress">
            <div class="progress__fill"
                 style="width: ${progressPercent}%"
                 role="progressbar"
                 aria-valuenow="${progressPercent}"
                 aria-valuemin="0"
                 aria-valuemax="100">
            </div>
          </div>
          <span class="progress-labeled__text">${progressPercent}%</span>
        </div>
      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     HTML — ÉTAT RESTING
     ────────────────────────────────────────────────────────── */

  _buildRestingHTML() {
    const p = this._plan;
    const nextSeries = this._currentSeries + 1;
    const circumference = getCircleCircumference();

    return `
      <div class="screen centered" role="main" aria-label="Repos">
        <header class="screen-header text-center">
          <span class="screen-header__subtitle">Repos</span>
          <h1 class="screen-header__title">Respirez</h1>
        </header>

        <!-- Timer circulaire -->
        <div class="timer" id="rest-timer-container">
          <svg class="timer__svg" viewBox="0 0 120 120" aria-hidden="true">
            <circle class="timer__track" cx="60" cy="60" r="54" />
            <circle class="timer__progress"
                    id="timer-progress"
                    cx="60" cy="60" r="54"
                    style="stroke-dasharray: ${circumference}; stroke-dashoffset: 0" />
          </svg>
          <div class="timer__display">
            <span class="timer__time" id="timer-time">
              ${this._formatTimerTime(p.rest)}
            </span>
            <span class="timer__label">repos</span>
          </div>
        </div>

        <!-- Info série suivante -->
        <div class="text-center mt-6 mb-6">
          <p class="text-secondary text-sm">
            Série suivante : ${nextSeries} / ${p.series}
          </p>
          <p class="text-secondary text-sm">
            Objectif : ${p.reps} reps
          </p>
        </div>

        <!-- Bouton skip -->
        <button class="btn btn-ghost btn-block"
                data-action="skip-rest"
                type="button">
          ⏭ Passer le repos
        </button>
      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     HTML — ÉTAT COMPLETED
     ────────────────────────────────────────────────────────── */

  _buildCompletedHTML() {
    const p = this._plan;
    const totalReps = this._getTotalRepsCompleted();
    const totalPlanned = p.series * p.reps;
    const duration = this._getSessionDuration();

    return `
      <div class="screen centered" role="main" aria-label="Séance terminée">
        <div class="text-3xl mb-4" aria-hidden="true">🎉</div>
        <h1 class="text-2xl font-bold mb-2">Séance terminée !</h1>

        <div class="card w-full mb-6">
          <div class="card__body">
            <dl class="detail-list">
              <div class="detail-item">
                <dt class="detail-item__label">Programme</dt>
                <dd class="detail-item__value mono">
                  ${p.series} × ${p.reps} = ${totalPlanned} reps
                </dd>
              </div>
              <div class="detail-item">
                <dt class="detail-item__label">Réalisé</dt>
                <dd class="detail-item__value mono color-success">
                  ${totalReps} reps
                </dd>
              </div>
              <div class="detail-item">
                <dt class="detail-item__label">Durée</dt>
                <dd class="detail-item__value mono">${duration}</dd>
              </div>
            </dl>
          </div>
        </div>

        <!-- Séries détaillées -->
        ${this._buildSeriesRecapHTML()}

        <button class="btn btn-primary btn-lg btn-block btn-ripple mt-6"
                data-action="go-feedback"
                type="button">
          Donner mon feedback
        </button>
      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     HTML — ÉTAT FAILED
     ────────────────────────────────────────────────────────── */

  _buildFailedHTML() {
    const p = this._plan;
    const completedSeries = this._currentSeries - 1;
    const completedReps = this._getTotalRepsCompleted();
    const totalPlanned = p.series * p.reps;

    return `
      <div class="screen" role="main" aria-label="Séance interrompue">
        <header class="screen-header">
          <h1 class="screen-header__title">❌ Séance interrompue</h1>
        </header>

        <div class="card mb-4">
          <div class="card__body">
            <dl class="detail-list">
              <div class="detail-item">
                <dt class="detail-item__label">Série interrompue</dt>
                <dd class="detail-item__value mono">${this._currentSeries} / ${p.series}</dd>
              </div>
              <div class="detail-item">
                <dt class="detail-item__label">Séries complétées</dt>
                <dd class="detail-item__value mono">${completedSeries}</dd>
              </div>
            </dl>
          </div>
        </div>

        <!-- Saisie reps partielles -->
        <div class="card mb-4">
          <div class="card__header">
            <h2 class="card__title text-sm">
              Combien de reps dans cette série ?
            </h2>
          </div>
          <div class="card__body">
            <div class="num-input" role="group" aria-label="Répétitions partielles">
              <button class="num-input__btn"
                      data-action="partial-decrement"
                      type="button"
                      aria-label="Diminuer">−</button>
              <span class="num-input__value"
                    id="partial-reps-value"
                    role="spinbutton"
                    aria-valuenow="${this._partialReps}"
                    aria-valuemin="${PARTIAL_REPS_MIN}"
                    aria-valuemax="${p.reps}">
                ${this._partialReps}
              </span>
              <button class="num-input__btn"
                      data-action="partial-increment"
                      type="button"
                      aria-label="Augmenter">+</button>
            </div>
          </div>
        </div>

        <!-- Récapitulatif -->
        <div class="card mb-6">
          <div class="card__header">
            <h2 class="card__title text-sm">Récapitulatif</h2>
          </div>
          <div class="card__body">
            ${this._buildSeriesRecapHTML(true)}
            <hr class="screen-divider">
            <div class="flex-between">
              <span class="text-sm font-semibold">Total</span>
              <span class="mono text-sm font-bold">
                ${completedReps + this._partialReps} / ${totalPlanned} reps
                (${Math.round(((completedReps + this._partialReps) / totalPlanned) * 100)}%)
              </span>
            </div>
          </div>
        </div>

        <button class="btn btn-primary btn-lg btn-block btn-ripple"
                data-action="save-failed"
                type="button">
          Enregistrer
        </button>
      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     HTML — ÉTAT SAVING
     ────────────────────────────────────────────────────────── */

  _buildSavingHTML() {
    return `
      <div class="screen centered" role="status" aria-label="Enregistrement">
        <div class="loading-spinner" aria-hidden="true"></div>
        <p class="text-secondary mt-4">Enregistrement...</p>
      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     HTML — COMPOSANTS PARTAGÉS
     ────────────────────────────────────────────────────────── */

  /**
   * Construit le récapitulatif des séries.
   *
   * @param {boolean} [includePartial=false] — Inclure la série partielle
   * @returns {string}
   * @private
   */
  _buildSeriesRecapHTML(includePartial = false) {
    const p = this._plan;
    const items = [];

    // Séries complétées
    this._seriesDetail.forEach(detail => {
      items.push(`
        <div class="series-item series-item--done">
          <span class="series-item__icon">✅</span>
          <span class="series-item__label">Série ${detail.seriesNumber}</span>
          <span class="series-item__reps">${detail.repsCompleted}/${p.reps}</span>
        </div>
      `);
    });

    // Série partielle (état FAILED)
    if (includePartial && this._state === SESSION_STATE.FAILED) {
      items.push(`
        <div class="series-item series-item--failed">
          <span class="series-item__icon">❌</span>
          <span class="series-item__label">Série ${this._currentSeries}</span>
          <span class="series-item__reps">${this._partialReps}/${p.reps}</span>
        </div>
      `);
    }

    // Séries restantes (état FAILED)
    if (includePartial) {
      for (let s = this._currentSeries + 1; s <= p.series; s++) {
        items.push(`
          <div class="series-item series-item--pending">
            <span class="series-item__icon">⬜</span>
            <span class="series-item__label">Série ${s}</span>
            <span class="series-item__reps">—/${p.reps}</span>
          </div>
        `);
      }
    }

    return `<div class="series-recap">${items.join('')}</div>`;
  },


  /* ──────────────────────────────────────────────────────────
     ÉVÉNEMENTS
     ────────────────────────────────────────────────────────── */

  /**
   * Attache les événements via délégation.
   * @private
   */
  _attachEvents() {
    if (!this._container || !this._abortController) return;
    const signal = this._abortController.signal;

    this._container.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      this._handleAction(target.dataset.action, target);
    }, { signal });

    // Clavier pour reps partielles
    if (this._state === SESSION_STATE.FAILED) {
      this._container.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this._adjustPartialReps(1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this._adjustPartialReps(-1);
        }
      }, { signal });
    }
  },

  /**
   * Dispatch les actions.
   *
   * @param {string} action
   * @param {HTMLElement} target
   * @private
   */
  _handleAction(action, target) {
    switch (action) {
      case 'start-session':
        this._onStartSession();
        break;
      case 'series-done':
        this._onSeriesDone();
        break;
      case 'impossible':
        this._onImpossible();
        break;
      case 'skip-rest':
        this._onSkipRest();
        break;
      case 'go-feedback':
        this._onGoFeedback();
        break;
      case 'partial-increment':
        this._adjustPartialReps(1);
        break;
      case 'partial-decrement':
        this._adjustPartialReps(-1);
        break;
      case 'save-failed':
        this._onSaveFailed(target);
        break;
    }
  },


  /* ──────────────────────────────────────────────────────────
     TRANSITIONS D'ÉTAT
     ────────────────────────────────────────────────────────── */

  /**
   * READY → EXERCISING
   * @private
   */
  _onStartSession() {
    this._sessionStart = Date.now();
    this._seriesStart = Date.now();
    this._state = SESSION_STATE.EXERCISING;
    this._render();
  },

  /**
   * EXERCISING → RESTING (ou COMPLETED si dernière série)
   * @private
   */
  _onSeriesDone() {
    const p = this._plan;

    // Enregistrer la série complétée
    this._seriesDetail.push({
      seriesNumber: this._currentSeries,
      repsCompleted: p.reps,
      restTaken: p.rest,
      completed: true,
      duration: Math.round((Date.now() - this._seriesStart) / 1000)
    });

    // Dernière série ?
    if (this._currentSeries >= p.series) {
      this._state = SESSION_STATE.COMPLETED;
      notifications.notifySessionEnd();
      this._render();
      return;
    }

    // Sinon → repos
    this._state = SESSION_STATE.RESTING;
    this._render();
  },

  /**
   * EXERCISING → FAILED
   * @private
   */
  _onImpossible() {
    this._partialReps = 0;
    this._state = SESSION_STATE.FAILED;
    notifications.notifyImpossible();
    this._render();
  },

  /**
   * RESTING → EXERCISING (timer fini ou skip)
   * @private
   */
  _onRestComplete() {
    // Détruire le timer
    if (this._timer) {
      this._timer.destroy();
      this._timer = null;
    }

    this._timerElements = null;
    this._currentSeries++;
    this._seriesStart = Date.now();
    this._state = SESSION_STATE.EXERCISING;
    this._render();
  },

  /**
   * Skip repos
   * @private
   */
  _onSkipRest() {
    if (this._timer) {
      this._timer.skip();
      // skip() appelle onComplete → _onRestComplete()
    }
  },

  /**
   * COMPLETED → navigation vers feedback
   * @private
   */
  async _onGoFeedback() {
    await this._saveSession('completed', null);

    if (this._navigateTo) {
      await this._navigateTo('feedback');
    }
  },

  /**
   * FAILED → sauvegarde puis navigation vers dashboard
   *
   * @param {HTMLElement} button
   * @private
   */
  async _onSaveFailed(button) {
    try {
      button.disabled = true;
      button.textContent = 'Enregistrement...';

      await this._saveSession('completed', 'impossible');

      if (this._navigateTo) {
        await this._navigateTo('dashboard');
      }
    } catch (error) {
      console.error('Erreur de sauvegarde :', error);
      button.disabled = false;
      button.textContent = 'Enregistrer';
    }
  },


  /* ──────────────────────────────────────────────────────────
     TIMER DE REPOS
     ────────────────────────────────────────────────────────── */

  /**
   * Démarre le timer de repos.
   * @private
   */
  _startRestTimer() {
    const settings = state.getSettings();
    const autoStart = settings.restTimerAutoStart !== false;

    // Créer le timer
    this._timer = new RestTimer({
      duration: this._plan.rest,

      onTick: (data) => {
        if (this._timerElements) {
          updateTimerUI(this._timerElements, data);
        }
      },

      onWarning: () => {
        notifications.notifyTimerWarning();
      },

      onComplete: () => {
        notifications.notifyTimerEnd();
        // Petit délai pour laisser le son/vibration se produire
        setTimeout(() => this._onRestComplete(), 300);
      }
    });

    // Démarrer automatiquement si l'option est activée
    if (autoStart) {
      this._timer.start();
    }
  },

  /**
   * Met en cache les éléments DOM du timer.
   * @private
   */
  _cacheTimerElements() {
    if (!this._container) return;

    this._timerElements = {
      container: this._container.querySelector('#rest-timer-container'),
      circle: this._container.querySelector('#timer-progress'),
      timeText: this._container.querySelector('#timer-time')
    };
  },


  /* ──────────────────────────────────────────────────────────
     SAISIE REPS PARTIELLES
     ────────────────────────────────────────────────────────── */

  /**
   * Ajuste la valeur des reps partielles.
   *
   * @param {number} delta
   * @private
   */
  _adjustPartialReps(delta) {
    const maxReps = this._plan ? this._plan.reps : 100;
    this._partialReps = Math.max(
      PARTIAL_REPS_MIN,
      Math.min(maxReps, this._partialReps + delta)
    );

    this._updatePartialDisplay();
  },

  /**
   * Met à jour l'affichage des reps partielles.
   * @private
   */
  _updatePartialDisplay() {
    const display = this._container?.querySelector('#partial-reps-value');
    if (display) {
      display.textContent = this._partialReps;
      display.setAttribute('aria-valuenow', this._partialReps);
    }

    // Mettre à jour le récap total
    this._updateFailedRecap();
  },

  /**
   * Met à jour le récapitulatif en temps réel (état FAILED).
   * @private
   */
  _updateFailedRecap() {
    // Mettre à jour les reps de la série partielle
    const failedItem = this._container?.querySelector('.series-item--failed .series-item__reps');
    if (failedItem && this._plan) {
      failedItem.textContent = `${this._partialReps}/${this._plan.reps}`;
    }

    // Mettre à jour le total
    const totalEl = this._container?.querySelector('.flex-between .mono');
    if (totalEl && this._plan) {
      const totalPlanned = this._plan.series * this._plan.reps;
      const totalDone = this._getTotalRepsCompleted() + this._partialReps;
      const percent = Math.round((totalDone / totalPlanned) * 100);
      totalEl.textContent = `${totalDone} / ${totalPlanned} reps (${percent}%)`;
    }
  },


  /* ──────────────────────────────────────────────────────────
     SAUVEGARDE DE LA SÉANCE
     ────────────────────────────────────────────────────────── */

  /**
   * Sauvegarde la séance dans le state.
   *
   * @param {string} status — 'completed'
   * @param {string|null} feedback — 'impossible' ou null (feedback donné plus tard)
   * @private
   */
  async _saveSession(status, feedback) {
    const p = this._plan;
    const weekNumber = state.getCurrentWeekNumber();
    const dayNumber = state.getCurrentDayNumber();

    const completedSeries = this._seriesDetail.length;
    const totalRepsCompleted = this._getTotalRepsCompleted() +
      (feedback === 'impossible' ? this._partialReps : 0);
    const totalVolumePlanned = p.series * p.reps;
    const duration = Math.round((Date.now() - this._sessionStart) / 1000);

    // Construire les détails des séries
    const seriesDetail = [...this._seriesDetail];

    // Ajouter la série partielle si impossible
    if (feedback === 'impossible') {
      seriesDetail.push({
        seriesNumber: this._currentSeries,
        repsCompleted: this._partialReps,
        restTaken: null,
        completed: false,
        duration: Math.round((Date.now() - this._seriesStart) / 1000)
      });
    }

    // RIR estimé
    let rirEstimated = 2; // défaut
    if (feedback === 'impossible') {
      rirEstimated = 0;
    }

    const sessionData = {
      weekNumber,
      dayNumber,
      date: new Date().toISOString(),
      type: 'training',
      planned: {
        series: p.series,
        reps: p.reps,
        rest: p.rest,
        type: p.type
      },
      actual: {
        completedSeries,
        partialSeriesReps: feedback === 'impossible' ? this._partialReps : null,
        totalRepsCompleted,
        totalVolumePlanned,
        seriesDetail
      },
      feedback: feedback,
      rirEstimated,
      duration,
      status
    };

    await state.saveSession(sessionData);
  },


  /* ──────────────────────────────────────────────────────────
     UTILITAIRES
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule le total des reps complétées (séries terminées uniquement).
   *
   * @returns {number}
   * @private
   */
  _getTotalRepsCompleted() {
    return this._seriesDetail.reduce(
      (sum, detail) => sum + detail.repsCompleted, 0
    );
  },

  /**
   * Calcule la durée de la séance formatée.
   *
   * @returns {string}
   * @private
   */
  _getSessionDuration() {
    if (!this._sessionStart) return '—';

    const seconds = Math.round((Date.now() - this._sessionStart) / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (mins === 0) return `${secs}s`;
    return `${mins} min ${secs.toString().padStart(2, '0')}s`;
  },

  /**
   * Formate le temps de repos.
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
    return secs === 0 ? `${mins} min` : `${mins} min ${secs}s`;
  },

  /**
   * Formate le temps pour le timer (M:SS).
   *
   * @param {number} seconds
   * @returns {string}
   * @private
   */
  _formatTimerTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  /**
   * Affiche une erreur quand aucun plan n'est disponible.
   * @private
   */
  _showNoPlanError() {
    if (!this._container) return;

    this._container.innerHTML = `
      <div class="screen centered">
        <div class="text-3xl mb-4" aria-hidden="true">⚠️</div>
        <h1 class="text-xl font-bold mb-4">Aucune séance prévue</h1>
        <p class="text-secondary text-center mb-6">
          Il n'y a pas de programme pour aujourd'hui.
          Retournez au tableau de bord.
        </p>
        <button class="btn btn-primary btn-block"
                data-action="go-back"
                type="button">
          Retour au dashboard
        </button>
      </div>
    `;

    const signal = this._abortController?.signal;
    if (signal) {
      this._container.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action="go-back"]');
        if (target && this._navigateTo) {
          this._navigateTo('dashboard');
        }
      }, { signal });
    }
  }
};


// ── Export ──

export default SessionScreen;