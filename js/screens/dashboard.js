/* ════════════════════════════════════════════════════════════════
   AbdoPro — screens/dashboard.js

   Responsabilité unique : tableau de bord principal.
   ─────────────────────────────────────────────────────────────
   Hub central de l'application. Affiche l'état courant et
   permet de lancer la séance du jour.

   Données affichées :
   - Semaine et jour courants
   - Test max actuel + progression
   - Algorithme actif
   - Programme du jour (séries × reps, repos, type)
   - État des 7 jours de la semaine
   - Messages contextuels (reprise, semaine terminée, etc.)

   S'abonne aux topics : WEEK, SESSION, PROFILE

   Contrat d'écran :
     render(container, params)  → Génère le HTML
     destroy()                  → Nettoie
   ════════════════════════════════════════════════════════════════ */

import state, { TOPICS } from '../utils/state.js';
import engine from '../algorithms/engine.js';


// ── Constantes ──

/** Mapping type d'exercice → classe CSS de la card */
const TYPE_CSS_MAP = {
  ENDURANCE:    'card--endurance',
  HYPERTROPHIE: 'card--hypertrophie',
  FORCE:        'card--force',
  MIXTE:        'card--mixte',
  DELOAD:       'card--deload',
  DEBUTANT:     'card--deload',
  RECOVERY:     'card--recovery',
  MODERATE:     'card--moderate',
  INTENSE:      'card--intense',
  LIGHT:        'card--light',
  ADAPTATIF:    'card--adaptatif',
  STANDARD:     'card--standard'
};

/** Mapping type d'exercice → emoji */
const TYPE_EMOJI_MAP = {
  ENDURANCE:    '🏃',
  HYPERTROPHIE: '💪',
  FORCE:        '🔥',
  MIXTE:        '⚡',
  DELOAD:       '🧘',
  DEBUTANT:     '🌱',
  RECOVERY:     '🧘',
  MODERATE:     '⚡',
  INTENSE:      '🔥',
  LIGHT:        '🌿',
  ADAPTATIF:    '🎯',
  STANDARD:     '⚡'
};

/** Mapping statut de jour → icône */
const DAY_STATUS_ICONS = {
  done:    '✅',
  current: '▶️',
  pending: '⬜',
  failed:  '❌',
  skipped: '⏭️'
};

/** Messages de reprise selon le nombre de jours manqués */
const SKIP_MESSAGES = {
  1: 'La séance d\'hier n\'a pas été faite.',
  2: '2 séances manquées récemment.',
  3: '3+ séances manquées. Envisagez un nouveau test max.'
};

Object.freeze(TYPE_CSS_MAP);
Object.freeze(TYPE_EMOJI_MAP);
Object.freeze(DAY_STATUS_ICONS);
Object.freeze(SKIP_MESSAGES);


// ── Écran Dashboard ──

const DashboardScreen = {

  /** @type {Function|null} */
  _navigateTo: null,

  /** @type {AbortController|null} */
  _abortController: null,

  /** @type {Function[]} Fonctions de désabonnement du state */
  _unsubscribers: [],

  /** @type {HTMLElement|null} Référence au conteneur */
  _container: null,


  /* ──────────────────────────────────────────────────────────
     RENDER
     ────────────────────────────────────────────────────────── */

  /**
   * Génère le HTML du dashboard et attache les événements.
   *
   * @param {HTMLElement} container
   * @param {Object} params
   */
  async render(container, params) {
    this._navigateTo = params.navigateTo;
    this._container = container;
    this._abortController = new AbortController();

    // Rendu initial
    this._update();

    // S'abonner aux changements d'état
    this._unsubscribers = [
      state.subscribe(TOPICS.WEEK,    () => this._update()),
      state.subscribe(TOPICS.SESSION, () => this._update()),
      state.subscribe(TOPICS.PROFILE, () => this._update())
    ];
  },


  /* ──────────────────────────────────────────────────────────
     DESTROY
     ────────────────────────────────────────────────────────── */

  destroy() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    this._unsubscribers.forEach(unsub => unsub());
    this._unsubscribers = [];

    this._navigateTo = null;
    this._container = null;
  },


  /* ──────────────────────────────────────────────────────────
     MISE À JOUR DU RENDU
     ────────────────────────────────────────────────────────── */

  /**
   * Met à jour l'intégralité du dashboard.
   * Appelé au render initial et à chaque changement d'état.
   *
   * @private
   */
  _update() {
    if (!this._container) return;

    // Collecter toutes les données nécessaires
    const data = this._collectData();

    // Générer le HTML
    this._container.innerHTML = this._buildHTML(data);

    // Rattacher les événements
    this._attachEvents();
  },

  /**
   * Collecte les données depuis le state.
   *
   * @returns {Object}
   * @private
   */
  _collectData() {
    const weekNumber = state.getCurrentWeekNumber();
    const dayNumber = state.getCurrentDayNumber();
    const currentWeek = state.getCurrentWeek();
    const testMax = state.getCurrentTestMax();
    const progression = state.getProgressionPercent();
    const algorithm = state.getSelectedAlgorithm();
    const dayPlan = state.getCurrentDayPlan();
    const weekStatus = state.getWeekCompletionStatus();
    const isTestDay = state.isTestMaxDay();
    const isWeekDone = state.isWeekCompleted();
    const skippedDays = state.getConsecutiveSkippedDays();
    const shouldRetest = state.shouldRetestMax();
    const hasImpossible = state.hasImpossibleThisWeek();
    const isSessionDone = state.isSessionCompleted(dayNumber);

    // Récupérer le label de l'algorithme
    engine.initialize();
    const algoInfo = engine.getAlgorithmInfo(algorithm);
    const algorithmLabel = algoInfo ? algoInfo.label : algorithm;

    return {
      weekNumber,
      dayNumber,
      testMax,
      progression,
      algorithm,
      algorithmLabel,
      dayPlan,
      weekStatus,
      isTestDay,
      isWeekDone,
      skippedDays,
      shouldRetest,
      hasImpossible,
      isSessionDone
    };
  },


  /* ──────────────────────────────────────────────────────────
     CONSTRUCTION DU HTML
     ────────────────────────────────────────────────────────── */

  /**
   * Construit le HTML complet du dashboard.
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _buildHTML(data) {
    return `
      <div class="screen" role="main" aria-label="Tableau de bord">

        <!-- En-tête -->
        ${this._buildHeader(data)}

        <!-- Statistiques rapides -->
        ${this._buildStats(data)}

        <!-- Messages contextuels -->
        ${this._buildAlerts(data)}

        <!-- Carte de la séance du jour -->
        ${this._buildSessionCard(data)}

        <!-- Progression de la semaine (7 jours) -->
        ${this._buildWeekProgress(data)}

        <!-- Info algorithme -->
        ${this._buildAlgorithmInfo(data)}

      </div>
    `;
  },

  /**
   * Construit l'en-tête (semaine / jour).
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _buildHeader(data) {
    const dayLabel = data.isTestDay
      ? 'Test Maximum'
      : `Jour ${data.dayNumber}`;

    return `
      <header class="screen-header">
        <span class="screen-header__subtitle">Semaine ${data.weekNumber}</span>
        <h1 class="screen-header__title">${dayLabel}</h1>
      </header>
    `;
  },

  /**
   * Construit la rangée de statistiques rapides.
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _buildStats(data) {
    const progressionSign = data.progression >= 0 ? '+' : '';
    const progressionColor = data.progression > 0
      ? 'color-success'
      : data.progression < 0
        ? 'color-danger'
        : 'text-secondary';

    return `
      <div class="stats-row mb-6">
        <div class="stat">
          <span class="stat__icon" aria-hidden="true">📊</span>
          <span class="stat__value mono">${data.testMax ?? '—'}</span>
          <span class="stat__label">Test Max</span>
        </div>
        <div class="stat">
          <span class="stat__icon" aria-hidden="true">📈</span>
          <span class="stat__value mono ${progressionColor}">
            ${data.testMax ? `${progressionSign}${data.progression}%` : '—'}
          </span>
          <span class="stat__label">Progression</span>
        </div>
        <div class="stat">
          <span class="stat__icon" aria-hidden="true">🧠</span>
          <span class="stat__value text-sm">${data.algorithmLabel}</span>
          <span class="stat__label">Algorithme</span>
        </div>
      </div>
    `;
  },

  /**
   * Construit les messages d'alerte contextuels.
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _buildAlerts(data) {
    const alerts = [];

    // Semaine terminée
    if (data.isWeekDone) {
      alerts.push({
        type: 'success',
        icon: '🎉',
        message: 'Semaine terminée ! Passez à la semaine suivante.',
        action: {
          label: 'Semaine suivante',
          route: 'test-max',
          dataAction: 'next-week'
        }
      });
    }

    // Jours manqués
    if (!data.isWeekDone && data.skippedDays > 0) {
      const msg = SKIP_MESSAGES[Math.min(data.skippedDays, 3)];
      alerts.push({
        type: data.shouldRetest ? 'danger' : 'warning',
        icon: '⚠️',
        message: msg,
        action: data.shouldRetest
          ? { label: 'Refaire un test max', route: 'test-max', dataAction: 'retest' }
          : null
      });
    }

    // Séance impossible cette semaine
    if (data.hasImpossible && !data.isWeekDone) {
      alerts.push({
        type: 'info',
        icon: 'ℹ️',
        message: 'Séance impossible cette semaine. Le programme sera adapté la semaine prochaine (séries ×2, reps ÷2).'
      });
    }

    if (alerts.length === 0) return '';

    return `
      <div class="flex-col gap-3 mb-6">
        ${alerts.map(alert => this._buildAlertHTML(alert)).join('')}
      </div>
    `;
  },

  /**
   * Construit le HTML d'une alerte individuelle.
   *
   * @param {Object} alert
   * @returns {string}
   * @private
   */
  _buildAlertHTML(alert) {
    const actionHTML = alert.action
      ? `<button class="btn btn-sm btn-primary mt-2"
                 data-action="${alert.action.dataAction}"
                 type="button">
           ${alert.action.label}
         </button>`
      : '';

    return `
      <div class="card card--highlight" role="alert">
        <div class="flex gap-3">
          <span aria-hidden="true">${alert.icon}</span>
          <div class="flex-col flex-1 gap-1">
            <p class="text-sm">${alert.message}</p>
            ${actionHTML}
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Construit la carte de la séance du jour.
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _buildSessionCard(data) {
    // Semaine terminée → pas de séance
    if (data.isWeekDone) return '';

    // Jour de test max
    if (data.isTestDay) {
      return this._buildTestMaxCard(data);
    }

    // Séance déjà complétée
    if (data.isSessionDone) {
      return this._buildCompletedCard(data);
    }

    // Pas de plan (ne devrait pas arriver, mais sécurité)
    if (!data.dayPlan) {
      return this._buildNoSessionCard();
    }

    // Séance disponible
    return this._buildActiveSessionCard(data);
  },

  /**
   * Carte "Test Maximum" (J1).
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _buildTestMaxCard(data) {
    return `
      <div class="card card--highlight mb-6">
        <div class="card__header">
          <h2 class="card__title">📋 Test Maximum</h2>
          <span class="badge badge--primary">J1</span>
        </div>
        <div class="card__body">
          <p class="text-sm text-secondary">
            Faites le maximum d'abdominaux en une seule série
            pour calibrer votre programme de la semaine.
          </p>
        </div>
        <div class="card__footer">
          <button class="btn btn-primary btn-block"
                  data-action="start-test"
                  type="button">
            Passer le test
          </button>
        </div>
      </div>
    `;
  },

  /**
   * Carte séance active (à commencer).
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _buildActiveSessionCard(data) {
    const plan = data.dayPlan;
    const typeClass = TYPE_CSS_MAP[plan.type] || '';
    const typeEmoji = TYPE_EMOJI_MAP[plan.type] || '⚡';
    const typeName = this._formatTypeName(plan.type);
    const totalVolume = plan.series * plan.reps;
    const restFormatted = this._formatRest(plan.rest);

    return `
      <div class="card ${typeClass} mb-6">
        <div class="card__header">
          <h2 class="card__title">${typeEmoji} Séance du jour</h2>
          <span class="badge badge--primary">J${data.dayNumber}</span>
        </div>
        <div class="card__body">
          <dl class="detail-list">
            <div class="detail-item">
              <dt class="detail-item__label">Type</dt>
              <dd class="detail-item__value">${typeName}</dd>
            </div>
            <div class="detail-item">
              <dt class="detail-item__label">Programme</dt>
              <dd class="detail-item__value mono">
                ${plan.series} × ${plan.reps} reps
              </dd>
            </div>
            <div class="detail-item">
              <dt class="detail-item__label">Volume total</dt>
              <dd class="detail-item__value mono">${totalVolume} reps</dd>
            </div>
            <div class="detail-item">
              <dt class="detail-item__label">Repos</dt>
              <dd class="detail-item__value mono">${restFormatted}</dd>
            </div>
          </dl>
        </div>
        <div class="card__footer">
          <button class="btn btn-success btn-block btn-lg btn-ripple"
                  data-action="start-session"
                  type="button">
            Commencer la séance
          </button>
        </div>
      </div>
    `;
  },

  /**
   * Carte séance déjà complétée.
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _buildCompletedCard(data) {
    const nextDay = data.dayNumber + 1;
    const hasNextDay = nextDay <= 7;

    return `
      <div class="card mb-6">
        <div class="card__header">
          <h2 class="card__title">✅ Séance complétée</h2>
          <span class="badge badge--success">J${data.dayNumber}</span>
        </div>
        <div class="card__body">
          <p class="text-sm text-secondary">
            Bravo ! Votre séance du jour est terminée.
            ${hasNextDay
              ? 'Revenez demain pour la séance suivante.'
              : 'C\'était la dernière séance de la semaine !'}
          </p>
        </div>
        ${hasNextDay
          ? `<div class="card__footer">
              <button class="btn btn-ghost btn-block"
                      data-action="advance-day"
                      type="button">
                Passer au jour suivant
              </button>
            </div>`
          : `<div class="card__footer">
              <button class="btn btn-primary btn-block"
                      data-action="next-week"
                      type="button">
                Passer à la semaine suivante
              </button>
            </div>`
        }
      </div>
    `;
  },

  /**
   * Carte quand aucune séance n'est disponible.
   *
   * @returns {string}
   * @private
   */
  _buildNoSessionCard() {
    return `
      <div class="card mb-6">
        <div class="card__body text-center p-6">
          <p class="text-secondary">
            Aucune séance planifiée pour aujourd'hui.
          </p>
        </div>
      </div>
    `;
  },

  /**
   * Construit la barre de progression des 7 jours.
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _buildWeekProgress(data) {
    const daysHTML = data.weekStatus.map(day => {
      const statusClass = `week-day--${day.status}`;
      const icon = DAY_STATUS_ICONS[day.status] || '⬜';
      const label = day.day === 1 ? 'T' : `J${day.day}`;

      return `
        <div class="week-day ${statusClass}">
          <span class="week-day__label">${label}</span>
          <span class="week-day__icon" aria-label="${day.status}">${icon}</span>
        </div>
      `;
    }).join('');

    // Compter les jours complétés (hors test max)
    const completedCount = data.weekStatus.filter(
      d => d.status === 'done' || d.status === 'failed'
    ).length;
    const totalDays = 7;
    const completionPercent = Math.round((completedCount / totalDays) * 100);

    return `
      <div class="card mb-6">
        <div class="card__header">
          <h3 class="card__title text-sm">Semaine ${data.weekNumber}</h3>
          <span class="text-sm text-secondary mono">${completedCount}/${totalDays}</span>
        </div>
        <div class="week-days">
          ${daysHTML}
        </div>
        <div class="progress progress--sm mt-2">
          <div class="progress__fill" style="width: ${completionPercent}%"
               role="progressbar"
               aria-valuenow="${completionPercent}"
               aria-valuemin="0"
               aria-valuemax="100"
               aria-label="Progression de la semaine : ${completionPercent}%">
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Construit la section d'info sur l'algorithme actif.
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _buildAlgorithmInfo(data) {
    if (!data.testMax) return '';

    const algoInfo = engine.getAlgorithmInfo(data.algorithm);
    if (!algoInfo) return '';

    return `
      <div class="card mb-6">
        <div class="card__header">
          <h3 class="card__title text-sm">🧠 Algorithme actif</h3>
        </div>
        <div class="card__body">
          <p class="font-semibold mb-2">${algoInfo.label}</p>
          <p class="text-sm text-secondary">${algoInfo.description}</p>
        </div>
      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     ÉVÉNEMENTS
     ────────────────────────────────────────────────────────── */

  /**
   * Attache les événements sur le HTML fraîchement généré.
   *
   * Utilise la délégation d'événements sur le conteneur
   * pour éviter de réattacher sur chaque élément.
   *
   * @private
   */
  _attachEvents() {
    if (!this._container || !this._abortController) return;

    const signal = this._abortController.signal;

    // Délégation d'événements sur le conteneur
    this._container.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;
      this._handleAction(action, target);
    }, { signal });
  },

  /**
   * Dispatch les actions selon le data-action cliqué.
   *
   * @param {string} action
   * @param {HTMLElement} target
   * @private
   */
  async _handleAction(action, target) {
    switch (action) {
      case 'start-test':
        if (this._navigateTo) {
          await this._navigateTo('test-max');
        }
        break;

      case 'start-session':
        if (this._navigateTo) {
          await this._navigateTo('session');
        }
        break;

      case 'advance-day':
        await this._handleAdvanceDay(target);
        break;

      case 'next-week':
        await this._handleNextWeek(target);
        break;

      case 'retest':
        if (this._navigateTo) {
          await this._navigateTo('test-max');
        }
        break;

      default:
        console.warn(`Action inconnue : "${action}"`);
    }
  },

  /**
   * Gère l'avancement au jour suivant.
   *
   * @param {HTMLElement} button
   * @private
   */
  async _handleAdvanceDay(button) {
    try {
      button.disabled = true;
      await state.advanceDay();
      // Le re-render est déclenché automatiquement par le subscriber
    } catch (error) {
      console.error('Erreur advanceDay :', error);
      button.disabled = false;
    }
  },

  /**
   * Gère le passage à la semaine suivante.
   *
   * @param {HTMLElement} button
   * @private
   */
  async _handleNextWeek(button) {
    try {
      button.disabled = true;
      button.textContent = 'Chargement...';
      await state.advanceWeek();

      if (this._navigateTo) {
        await this._navigateTo('test-max');
      }
    } catch (error) {
      console.error('Erreur advanceWeek :', error);
      button.disabled = false;
      button.textContent = 'Semaine suivante';
    }
  },


  /* ──────────────────────────────────────────────────────────
     UTILITAIRES DE FORMATAGE
     ────────────────────────────────────────────────────────── */

  /**
   * Formate un nom de type d'exercice pour l'affichage.
   *
   * @param {string} type — Ex: 'HYPERTROPHIE', 'FORCE'
   * @returns {string} Ex: 'Hypertrophie', 'Force'
   * @private
   */
  _formatTypeName(type) {
    if (!type) return 'Standard';

    const names = {
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

    return names[type] || type;
  },

  /**
   * Formate un temps de repos en chaîne lisible.
   *
   * @param {number} seconds
   * @returns {string} Ex: '1 min 30s', '45s'
   * @private
   */
  _formatRest(seconds) {
    if (!seconds || seconds <= 0) return '—';

    if (seconds < 60) {
      return `${seconds}s`;
    }

    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (secs === 0) {
      return `${mins} min`;
    }

    return `${mins} min ${secs}s`;
  }
};


// ── Export ──


export default DashboardScreen;
