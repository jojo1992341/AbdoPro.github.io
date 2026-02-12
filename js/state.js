/* ════════════════════════════════════════════════════════════════
   AbdoPro — state.js

   Responsabilité unique : gestion d'état centralisée.
   ─────────────────────────────────────────────────────────────
   Pont entre la couche de persistance (db.js) et les
   consommateurs (écrans, algorithmes).

   Implémente :
     - Cache en mémoire (évite les lectures DB répétitives)
     - Pattern pub/sub par topics (réactivité ciblée)
     - Mutations atomiques (état + persistance + notification)
     - État dérivé (valeurs calculées à partir de l'état brut)

   ─────────────────────────────────────────────────────────────
   Topics de notification :
     'profile'       → Profil utilisateur modifié
     'week'          → Semaine courante modifiée
     'session'       → Séance active modifiée
     'history'       → Historique modifié (semaines passées)
     'settings'      → Paramètres modifiés
     'algorithm'     → Algorithme sélectionné modifié
     'navigation'    → Changement d'écran (route)

   ─────────────────────────────────────────────────────────────
   API publique :

     // Cycle de vie
     state.init()                        → Charge l'état depuis DB
     state.isInitialized()               → Vérifie l'init

     // Pub/Sub
     state.subscribe(topic, callback)    → Écoute un topic
     state.unsubscribe(topic, callback)  → Arrête d'écouter
     state.notify(topic)                 → Notifie les abonnés

     // Lecture
     state.get(key)                      → Lit une valeur brute
     state.getProfile()                  → Profil complet
     state.getCurrentWeek()              → Semaine courante
     state.getSettings()                 → Paramètres
     state.getHistory()                  → Historique complet

     // Écriture (persiste + notifie)
     state.updateProfile(data)           → Met à jour le profil
     state.updateSettings(data)          → Met à jour les paramètres
     state.setCurrentWeek(data)          → Définit la semaine courante
     state.saveSession(data)             → Enregistre une séance
     state.advanceDay()                  → Passe au jour suivant
     state.advanceWeek()                 → Passe à la semaine suivante
     state.setAlgorithm(name, scores)    → Définit l'algorithme actif
     state.reset()                       → Réinitialise tout

     // État dérivé (calculé)
     state.isFirstLaunch()               → Première utilisation ?
     state.isTestMaxDay()                → Jour de test max ?
     state.getCurrentDayPlan()           → Plan du jour courant
     state.getProgressionPercent()       → % de progression
     state.getWeekCompletionStatus()     → État des 7 jours
     state.hasImpossibleThisWeek()       → Séance impossible ?
     state.getWeekFeedbackSummary()      → Résumé feedbacks semaine
   ════════════════════════════════════════════════════════════════ */

import db from './db.js';


// ── Topics de notification ──

const TOPICS = {
  PROFILE: 'profile',
  WEEK: 'week',
  SESSION: 'session',
  HISTORY: 'history',
  SETTINGS: 'settings',
  ALGORITHM: 'algorithm',
  NAVIGATION: 'navigation'
};

Object.freeze(TOPICS);


// ── Valeurs par défaut ──

const DEFAULT_PROFILE = {
  id: 'profile',
  createdAt: null,
  currentWeek: 1,
  currentDay: 1,
  selectedAlgorithm: 'linear',
  settings: {
    soundEnabled: true,
    vibrationEnabled: true,
    theme: 'dark',
    restTimerAutoStart: true
  }
};

const DEFAULT_WEEK = {
  weekNumber: 1,
  startDate: null,
  testMax: null,
  previousTestMax: null,
  selectedAlgorithm: 'linear',
  algorithmScores: null,
  predictions: null,
  plan: null,
  feedbackSummary: {
    facile: 0,
    parfait: 0,
    impossible: 0,
    rirMoyen: 2,
    volumeTotal: 0,
    volumeRealiseTotale: 0
  },
  status: 'pending'
};

Object.freeze(DEFAULT_PROFILE);
Object.freeze(DEFAULT_WEEK);


// ── Classe State ──

class State {

  constructor() {
    /** @type {Map<string, Set<Function>>} Abonnés par topic */
    this._subscribers = new Map();

    /** @type {Object} Cache en mémoire de l'état */
    this._cache = {
      profile: null,
      currentWeek: null,
      sessions: [],
      weeks: [],
      scoringHistory: []
    };

    /** @type {boolean} */
    this._initialized = false;
  }


  /* ──────────────────────────────────────────────────────────
     CYCLE DE VIE
     ────────────────────────────────────────────────────────── */

  /**
   * Charge l'état complet depuis IndexedDB dans le cache mémoire.
   * Appelé une seule fois par app.js au démarrage.
   *
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized) return;

    // S'assurer que la DB est ouverte
    await db.open();

    // Charger le profil (peut être null si premier lancement)
    this._cache.profile = await db.getProfile();

    // Charger les semaines
    this._cache.weeks = await db.getAllWeeks();

    // Charger la semaine courante si elle existe
    if (this._cache.profile?.currentWeek) {
      this._cache.currentWeek = await db.getWeek(
        this._cache.profile.currentWeek
      );
    }

    // Charger les séances de la semaine courante
    if (this._cache.profile?.currentWeek) {
      this._cache.sessions = await db.getSessionsByWeek(
        this._cache.profile.currentWeek
      );
    }

    // Charger l'historique de scoring
    this._cache.scoringHistory = await db.getScoringHistory();

    this._initialized = true;
  }

  /**
   * Vérifie si l'état est initialisé.
   * @returns {boolean}
   */
  isInitialized() {
    return this._initialized;
  }

  /**
   * Vérifie que l'état est initialisé avant toute opération.
   * @throws {Error}
   * @private
   */
  _ensureInitialized() {
    if (!this._initialized) {
      throw new Error(
        'State non initialisé. Appelez state.init() avant toute opération.'
      );
    }
  }


  /* ──────────────────────────────────────────────────────────
     PUB/SUB — SYSTÈME DE NOTIFICATION
     ────────────────────────────────────────────────────────── */

  /**
   * Abonne une fonction callback à un topic.
   *
   * @param {string}   topic    — Le topic à écouter (TOPICS.*)
   * @param {Function} callback — Fonction appelée lors de la notification
   * @returns {Function} Fonction de désabonnement (pour cleanup)
   */
  subscribe(topic, callback) {
    if (typeof callback !== 'function') {
      throw new Error(`subscribe(${topic}) : callback doit être une fonction.`);
    }

    if (!this._subscribers.has(topic)) {
      this._subscribers.set(topic, new Set());
    }

    this._subscribers.get(topic).add(callback);

    // Retourne la fonction de désabonnement
    return () => this.unsubscribe(topic, callback);
  }

  /**
   * Désabonne une fonction callback d'un topic.
   *
   * @param {string}   topic
   * @param {Function} callback
   */
  unsubscribe(topic, callback) {
    const subs = this._subscribers.get(topic);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) {
        this._subscribers.delete(topic);
      }
    }
  }

  /**
   * Notifie tous les abonnés d'un topic.
   * Les callbacks reçoivent l'état courant en argument.
   *
   * @param {string} topic
   * @param {*}      [data] — Données optionnelles à passer aux callbacks
   */
  notify(topic, data = null) {
    const subs = this._subscribers.get(topic);
    if (!subs || subs.size === 0) return;

    // Clone le Set pour éviter les mutations pendant l'itération
    const callbacks = [...subs];

    // Exécuter les callbacks de manière asynchrone (microtask)
    // pour ne pas bloquer le thread principal
    queueMicrotask(() => {
      callbacks.forEach(cb => {
        try {
          cb(data || this._getTopicData(topic));
        } catch (error) {
          console.error(
            `Erreur dans subscriber de "${topic}" :`,
            error
          );
        }
      });
    });
  }

  /**
   * Retourne les données pertinentes pour un topic.
   *
   * @param {string} topic
   * @returns {*}
   * @private
   */
  _getTopicData(topic) {
    switch (topic) {
      case TOPICS.PROFILE:    return this._cache.profile;
      case TOPICS.WEEK:       return this._cache.currentWeek;
      case TOPICS.SESSION:    return this._cache.sessions;
      case TOPICS.HISTORY:    return this._cache.weeks;
      case TOPICS.SETTINGS:   return this._cache.profile?.settings;
      case TOPICS.ALGORITHM:  return this._cache.profile?.selectedAlgorithm;
      default:                return null;
    }
  }

  /**
   * Supprime tous les abonnés (cleanup).
   */
  clearSubscribers() {
    this._subscribers.clear();
  }


  /* ──────────────────────────────────────────────────────────
     LECTURE — ACCÈS À L'ÉTAT
     ────────────────────────────────────────────────────────── */

  /**
   * Accès générique à une clé du cache.
   *
   * @param {string} key — Clé du cache (profile, currentWeek, etc.)
   * @returns {*}
   */
  get(key) {
    this._ensureInitialized();
    return this._cache[key] ?? null;
  }

  /**
   * Retourne le profil utilisateur complet.
   * @returns {Object|null}
   */
  getProfile() {
    this._ensureInitialized();
    return this._cache.profile;
  }

  /**
   * Retourne la semaine courante.
   * @returns {Object|null}
   */
  getCurrentWeek() {
    this._ensureInitialized();
    return this._cache.currentWeek;
  }

  /**
   * Retourne les paramètres utilisateur.
   * @returns {Object}
   */
  getSettings() {
    this._ensureInitialized();
    return this._cache.profile?.settings || { ...DEFAULT_PROFILE.settings };
  }

  /**
   * Retourne l'historique de toutes les semaines (triées).
   * @returns {Array<Object>}
   */
  getHistory() {
    this._ensureInitialized();
    return [...this._cache.weeks];
  }

  /**
   * Retourne les séances de la semaine courante.
   * @returns {Array<Object>}
   */
  getCurrentSessions() {
    this._ensureInitialized();
    return [...this._cache.sessions];
  }

  /**
   * Retourne l'historique de scoring des algorithmes.
   * @returns {Array<Object>}
   */
  getScoringHistory() {
    this._ensureInitialized();
    return [...this._cache.scoringHistory];
  }

  /**
   * Retourne le numéro de semaine courante.
   * @returns {number}
   */
  getCurrentWeekNumber() {
    this._ensureInitialized();
    return this._cache.profile?.currentWeek || 1;
  }

  /**
   * Retourne le numéro de jour courant.
   * @returns {number}
   */
  getCurrentDayNumber() {
    this._ensureInitialized();
    return this._cache.profile?.currentDay || 1;
  }

  /**
   * Retourne le nom de l'algorithme actif.
   * @returns {string}
   */
  getSelectedAlgorithm() {
    this._ensureInitialized();
    return this._cache.profile?.selectedAlgorithm || 'linear';
  }


  /* ──────────────────────────────────────────────────────────
     ÉCRITURE — MUTATIONS ATOMIQUES
     
     Chaque mutation :
     1. Met à jour le cache mémoire
     2. Persiste dans IndexedDB
     3. Notifie les abonnés du topic concerné
     ────────────────────────────────────────────────────────── */

  /**
   * Initialise le profil pour un nouvel utilisateur.
   *
   * @returns {Promise<void>}
   */
  async createProfile() {
    const profile = {
      ...DEFAULT_PROFILE,
      createdAt: new Date().toISOString()
    };

    await db.saveProfile(profile);
    this._cache.profile = await db.getProfile();

    this.notify(TOPICS.PROFILE);
  }

  /**
   * Met à jour le profil utilisateur (fusion partielle).
   *
   * @param {Object} data — Champs à mettre à jour
   * @returns {Promise<void>}
   */
  async updateProfile(data) {
    this._ensureInitialized();

    await db.saveProfile(data);
    this._cache.profile = await db.getProfile();

    this.notify(TOPICS.PROFILE);
  }

  /**
   * Met à jour les paramètres utilisateur (fusion partielle).
   *
   * @param {Object} settings — Paramètres à mettre à jour
   * @returns {Promise<void>}
   */
  async updateSettings(settings) {
    this._ensureInitialized();

    await db.saveProfile({ settings });
    this._cache.profile = await db.getProfile();

    this.notify(TOPICS.SETTINGS);
  }

  /**
   * Définit ou met à jour la semaine courante.
   *
   * @param {Object} weekData — Données de la semaine
   * @returns {Promise<void>}
   */
  async setCurrentWeek(weekData) {
    this._ensureInitialized();

    const data = {
      ...DEFAULT_WEEK,
      ...weekData,
      updatedAt: new Date().toISOString()
    };

    await db.saveWeek(data);
    this._cache.currentWeek = await db.getWeek(data.weekNumber);

    // Mettre à jour la liste des semaines dans le cache
    await this._refreshWeeksCache();

    this.notify(TOPICS.WEEK);
  }

  /**
   * Enregistre le résultat du test max pour la semaine courante.
   *
   * @param {number} testMax      — Nombre de reps au test max
   * @param {Object} [extraData]  — Données supplémentaires (prédictions, scores...)
   * @returns {Promise<void>}
   */
  async saveTestMax(testMax, extraData = {}) {
    this._ensureInitialized();

    const weekNumber = this.getCurrentWeekNumber();
    const previousWeek = this._cache.weeks.length > 0
      ? this._cache.weeks[this._cache.weeks.length - 1]
      : null;

    const weekData = {
      weekNumber,
      startDate: new Date().toISOString().split('T')[0],
      testMax,
      previousTestMax: previousWeek?.testMax || null,
      status: 'in_progress',
      ...extraData
    };

    await this.setCurrentWeek(weekData);

    // Enregistrer le test max comme séance J1
    await this.saveSession({
      weekNumber,
      dayNumber: 1,
      date: new Date().toISOString(),
      type: 'test_max',
      actual: {
        totalRepsCompleted: testMax,
        totalVolumePlanned: testMax,
        completedSeries: 1,
        seriesDetail: [
          {
            seriesNumber: 1,
            repsCompleted: testMax,
            completed: true
          }
        ]
      },
      feedback: null,
      status: 'completed'
    });

    // Avancer au jour 2
    await this.updateProfile({
      currentDay: 2
    });
  }

  /**
   * Enregistre une séance d'entraînement.
   *
   * @param {Object} sessionData — Données complètes de la séance
   * @returns {Promise<void>}
   */
  async saveSession(sessionData) {
    this._ensureInitialized();

    const data = {
      ...sessionData,
      updatedAt: new Date().toISOString()
    };

    await db.saveSession(data);

    // Rafraîchir le cache des séances de la semaine courante
    const weekNumber = data.weekNumber || this.getCurrentWeekNumber();
    this._cache.sessions = await db.getSessionsByWeek(weekNumber);

    // Mettre à jour le résumé des feedbacks dans la semaine
    if (data.feedback && data.type !== 'test_max') {
      await this._updateWeekFeedbackSummary(weekNumber);
    }

    this.notify(TOPICS.SESSION);
  }

  /**
   * Passe au jour suivant dans la semaine.
   *
   * @returns {Promise<void>}
   */
  async advanceDay() {
    this._ensureInitialized();

    const currentDay = this.getCurrentDayNumber();
    const nextDay = currentDay + 1;

    if (nextDay > 7) {
      // Semaine terminée — marquer comme complétée
      await this._completeCurrentWeek();
      return;
    }

    await this.updateProfile({ currentDay: nextDay });
  }

  /**
   * Passe à la semaine suivante.
   * Remet le jour à 1 (test max).
   *
   * @returns {Promise<void>}
   */
  async advanceWeek() {
    this._ensureInitialized();

    // Marquer la semaine courante comme terminée si nécessaire
    if (this._cache.currentWeek?.status !== 'completed') {
      await this._completeCurrentWeek();
    }

    const nextWeek = this.getCurrentWeekNumber() + 1;

    await this.updateProfile({
      currentWeek: nextWeek,
      currentDay: 1
    });

    // La semaine sera créée lors du saveTestMax
    this._cache.currentWeek = null;
    this._cache.sessions = [];

    this.notify(TOPICS.WEEK);
  }

  /**
   * Définit l'algorithme actif et enregistre les scores.
   *
   * @param {string} algorithmName — Nom de l'algorithme sélectionné
   * @param {Object} scores        — Scores de tous les algorithmes
   * @param {Object} predictions   — Prédictions de tous les algorithmes
   * @param {string} [reason]      — Raison de la sélection
   * @returns {Promise<void>}
   */
  async setAlgorithm(algorithmName, scores, predictions, reason = '') {
    this._ensureInitialized();

    const weekNumber = this.getCurrentWeekNumber();

    // Mettre à jour le profil
    await this.updateProfile({
      selectedAlgorithm: algorithmName
    });

    // Mettre à jour la semaine courante
    if (this._cache.currentWeek) {
      await this.setCurrentWeek({
        ...this._cache.currentWeek,
        selectedAlgorithm: algorithmName,
        algorithmScores: scores,
        predictions
      });
    }

    // Enregistrer dans l'historique de scoring
    const scoringEntry = {
      weekNumber,
      calculations: scores,
      predictions,
      selectedAlgorithm: algorithmName,
      reasoning: reason,
      actual: this._cache.currentWeek?.testMax || null
    };

    await db.saveScoringEntry(scoringEntry);
    this._cache.scoringHistory = await db.getScoringHistory();

    this.notify(TOPICS.ALGORITHM);
  }

  /**
   * Enregistre le plan d'entraînement de la semaine.
   *
   * @param {Object} plan — Plan J2-J7
   * @returns {Promise<void>}
   */
  async saveWeekPlan(plan) {
    this._ensureInitialized();

    if (!this._cache.currentWeek) {
      throw new Error('Impossible de sauvegarder le plan : aucune semaine courante.');
    }

    await this.setCurrentWeek({
      ...this._cache.currentWeek,
      plan
    });
  }

  /**
   * Réinitialise toutes les données (factory reset).
   *
   * @returns {Promise<void>}
   */
  async reset() {
    await db.clearAll();

    this._cache = {
      profile: null,
      currentWeek: null,
      sessions: [],
      weeks: [],
      scoringHistory: []
    };

    this._initialized = false;
    this.clearSubscribers();
  }

  /**
   * Importe des données complètes (écrase tout).
   *
   * @param {Object} data — Données au format exportAll()
   * @returns {Promise<void>}
   */
  async importData(data) {
    await db.importAll(data);

    // Recharger tout le cache
    this._initialized = false;
    await this.init();

    // Notifier tous les topics
    this.notify(TOPICS.PROFILE);
    this.notify(TOPICS.WEEK);
    this.notify(TOPICS.SESSION);
    this.notify(TOPICS.HISTORY);
    this.notify(TOPICS.SETTINGS);
    this.notify(TOPICS.ALGORITHM);
  }

  /**
   * Exporte toutes les données.
   *
   * @returns {Promise<Object>}
   */
  async exportData() {
    return db.exportAll();
  }


  /* ──────────────────────────────────────────────────────────
     ÉTAT DÉRIVÉ — VALEURS CALCULÉES
     
     Ces méthodes ne modifient rien. Elles calculent des
     valeurs à partir de l'état brut en cache.
     ────────────────────────────────────────────────────────── */

  /**
   * Vérifie si c'est la première utilisation.
   * @returns {boolean}
   */
  isFirstLaunch() {
    return this._cache.profile === null;
  }

  /**
   * Vérifie si le jour courant est un jour de test max (J1).
   * @returns {boolean}
   */
  isTestMaxDay() {
    this._ensureInitialized();
    return this.getCurrentDayNumber() === 1;
  }

  /**
   * Vérifie si la semaine courante est terminée.
   * @returns {boolean}
   */
  isWeekCompleted() {
    this._ensureInitialized();
    return this._cache.currentWeek?.status === 'completed';
  }

  /**
   * Retourne le plan du jour courant.
   *
   * @returns {Object|null} { series, reps, rest, type }
   */
  getCurrentDayPlan() {
    this._ensureInitialized();

    const day = this.getCurrentDayNumber();
    const plan = this._cache.currentWeek?.plan;

    if (!plan || day === 1) return null;

    return plan[`day${day}`] || null;
  }

  /**
   * Calcule le pourcentage de progression depuis le premier test max.
   *
   * @returns {number} Pourcentage (ex: 25 pour +25%)
   */
  getProgressionPercent() {
    this._ensureInitialized();

    if (this._cache.weeks.length < 2) return 0;

    const firstMax = this._cache.weeks[0].testMax;
    const currentMax = this._cache.currentWeek?.testMax
      || this._cache.weeks[this._cache.weeks.length - 1].testMax;

    if (!firstMax || firstMax === 0) return 0;

    return Math.round(((currentMax - firstMax) / firstMax) * 100);
  }

  /**
   * Retourne l'état de complétion de chaque jour de la semaine.
   *
   * @returns {Array<Object>} 7 entrées : { day, status, feedback }
   *   status: 'done' | 'current' | 'pending' | 'failed' | 'skipped'
   */
  getWeekCompletionStatus() {
    this._ensureInitialized();

    const currentDay = this.getCurrentDayNumber();
    const sessions = this._cache.sessions;
    const status = [];

    for (let day = 1; day <= 7; day++) {
      const session = sessions.find(s => s.dayNumber === day);

      let dayStatus;
      if (session?.status === 'completed') {
        dayStatus = session.feedback === 'impossible' ? 'failed' : 'done';
      } else if (session?.status === 'skipped') {
        dayStatus = 'skipped';
      } else if (day === currentDay) {
        dayStatus = 'current';
      } else if (day < currentDay) {
        // Jour passé sans séance → skipped
        dayStatus = 'skipped';
      } else {
        dayStatus = 'pending';
      }

      status.push({
        day,
        status: dayStatus,
        feedback: session?.feedback || null
      });
    }

    return status;
  }

  /**
   * Vérifie si au moins une séance "impossible" a eu lieu
   * dans la semaine courante.
   *
   * @returns {boolean}
   */
  hasImpossibleThisWeek() {
    this._ensureInitialized();
    return this._cache.sessions.some(
      s => s.feedback === 'impossible' && s.type !== 'test_max'
    );
  }

  /**
   * Calcule le résumé des feedbacks de la semaine courante.
   *
   * @returns {Object} { facile, parfait, impossible, total, rirMoyen, volumeTotal, volumeRealiseTotale }
   */
  getWeekFeedbackSummary() {
    this._ensureInitialized();

    const sessions = this._cache.sessions.filter(
      s => s.type !== 'test_max' && s.status === 'completed'
    );

    const summary = {
      facile: 0,
      parfait: 0,
      impossible: 0,
      total: sessions.length,
      rirMoyen: 2,
      volumeTotal: 0,
      volumeRealiseTotale: 0
    };

    const rirValues = [];

    sessions.forEach(session => {
      // Comptage feedbacks
      if (session.feedback) {
        summary[session.feedback] = (summary[session.feedback] || 0) + 1;
      }

      // Volume
      if (session.actual) {
        summary.volumeRealiseTotale += session.actual.totalRepsCompleted || 0;
        summary.volumeTotal += session.actual.totalVolumePlanned || 0;
      }

      // RIR
      if (typeof session.rirEstimated === 'number') {
        rirValues.push(session.rirEstimated);
      }
    });

    // Calculer le RIR moyen
    if (rirValues.length > 0) {
      summary.rirMoyen = rirValues.reduce((a, b) => a + b, 0) / rirValues.length;
      summary.rirMoyen = Math.round(summary.rirMoyen * 10) / 10;
    }

    return summary;
  }

  /**
   * Vérifie si une séance spécifique a déjà été complétée.
   *
   * @param {number} dayNumber — Numéro de jour (1-7)
   * @returns {boolean}
   */
  isSessionCompleted(dayNumber) {
    this._ensureInitialized();
    return this._cache.sessions.some(
      s => s.dayNumber === dayNumber && s.status === 'completed'
    );
  }

  /**
   * Retourne le nombre de jours consécutifs manqués.
   *
   * @returns {number}
   */
  getConsecutiveSkippedDays() {
    this._ensureInitialized();

    const currentDay = this.getCurrentDayNumber();
    let skipped = 0;

    for (let day = currentDay - 1; day >= 2; day--) {
      const session = this._cache.sessions.find(s => s.dayNumber === day);
      if (!session || session.status === 'skipped') {
        skipped++;
      } else {
        break;
      }
    }

    return skipped;
  }

  /**
   * Vérifie si l'utilisateur devrait refaire un test max
   * (3+ jours consécutifs manqués).
   *
   * @returns {boolean}
   */
  shouldRetestMax() {
    return this.getConsecutiveSkippedDays() >= 3;
  }

  /**
   * Construit l'historique pour les algorithmes.
   * Format attendu par les algorithmes : tableau de semaines
   * avec testMax, feedbackSummary, sessions, etc.
   *
   * @returns {Array<Object>}
   */
  async getAlgorithmHistory() {
    this._ensureInitialized();

    const history = [];

    for (const week of this._cache.weeks) {
      const sessions = await db.getSessionsByWeek(week.weekNumber);
      const feedbackCounts = await db.countFeedbacksByWeek(week.weekNumber);

      history.push({
        weekNumber: week.weekNumber,
        testMax: week.testMax,
        selectedAlgorithm: week.selectedAlgorithm,
        plan: week.plan,
        feedbackSummary: {
          facile: feedbackCounts.facile,
          parfait: feedbackCounts.parfait,
          impossible: feedbackCounts.impossible,
          rirMoyen: week.feedbackSummary?.rirMoyen ?? 2
        },
        sessions: sessions.map(s => ({
          dayNumber: s.dayNumber,
          type: s.type,
          feedback: s.feedback,
          actual: s.actual,
          status: s.status
        })),
        status: week.status
      });
    }

    return history;
  }

  /**
   * Retourne le test max actuel (dernière valeur connue).
   *
   * @returns {number|null}
   */
  getCurrentTestMax() {
    this._ensureInitialized();

    // Priorité : semaine courante, puis dernière semaine avec test max
    if (this._cache.currentWeek?.testMax) {
      return this._cache.currentWeek.testMax;
    }

    for (let i = this._cache.weeks.length - 1; i >= 0; i--) {
      if (this._cache.weeks[i].testMax) {
        return this._cache.weeks[i].testMax;
      }
    }

    return null;
  }


  /* ──────────────────────────────────────────────────────────
     MÉTHODES PRIVÉES
     ────────────────────────────────────────────────────────── */

  /**
   * Marque la semaine courante comme terminée.
   * @private
   */
  async _completeCurrentWeek() {
    if (!this._cache.currentWeek) return;

    const summary = this.getWeekFeedbackSummary();

    await this.setCurrentWeek({
      ...this._cache.currentWeek,
      status: 'completed',
      feedbackSummary: summary
    });

    this.notify(TOPICS.HISTORY);
  }

  /**
   * Met à jour le résumé des feedbacks dans la semaine courante.
   *
   * @param {number} weekNumber
   * @private
   */
  async _updateWeekFeedbackSummary(weekNumber) {
    const week = await db.getWeek(weekNumber);
    if (!week) return;

    const summary = this.getWeekFeedbackSummary();

    await db.saveWeek({
      ...week,
      feedbackSummary: summary
    });

    // Rafraîchir le cache
    this._cache.currentWeek = await db.getWeek(weekNumber);
  }

  /**
   * Rafraîchit le cache des semaines depuis la DB.
   * @private
   */
  async _refreshWeeksCache() {
    this._cache.weeks = await db.getAllWeeks();
  }
}


// ── Export singleton ──

const state = new State();

export { state, TOPICS };
export default state;