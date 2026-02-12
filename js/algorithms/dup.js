/* ════════════════════════════════════════════════════════════════
   AbdoPro — algorithms/dup.js

   ALGORITHME 3 — Periodisation Ondulatoire Quotidienne
                  (Daily Undulating Periodization)
   ─────────────────────────────────────────────────────────────
   Source scientifique :
   Rhea et al. (2002, "A comparison of linear and daily
   undulating periodized programs with equated volume and
   intensity for strength"). La périodisation ondulatoire
   quotidienne produit des gains supérieurs à la périodisation
   linéaire, particulièrement pour les sujets intermédiaires.

   Principe :
   Au lieu d'augmenter linéairement, chaque jour alterne entre
   endurance (beaucoup de reps, peu de séries), hypertrophie
   (volume modéré), et force (peu de reps, plus de séries
   intensives).

   Quand cet algorithme est optimal :
   Plateau détecté (test_max stagnant sur 2+ semaines),
   utilisateur intermédiaire. Éligible à partir de la semaine 3.

   ─────────────────────────────────────────────────────────────
   Contrat d'interface :
     algo.getName()         → 'dup'
     algo.getLabel()        → 'Ondulation Quotidienne (DUP)'
     algo.getDescription()  → string
     algo.predictTestMax(weekNumber, history)           → number
     algo.generatePlan(weekNumber, testMax, history)    → Object
   ════════════════════════════════════════════════════════════════ */

import {
  clamp,
  round,
  detectTrend,
  calculateRest
} from '../utils/math.js';


// ── Constantes ──

/** Taux de progression de base par semaine (+5%) */
const BASE_PROGRESSION_RATE = 0.05;

/** Ajustements du taux de progression selon les feedbacks */
const FEEDBACK_ADJUSTMENTS = {
  /** Bonus si ≥4 feedbacks "facile" dans la semaine */
  MANY_EASY:         0.02,
  /** Malus si ≥1 feedback "impossible" dans la semaine */
  ANY_IMPOSSIBLE:   -0.02,
  /** Bonus si tendance croissante sur 3 semaines */
  TREND_INCREASING:  0.01,
  /** Malus si tendance stagnante */
  TREND_STAGNANT:   -0.01
};

Object.freeze(FEEDBACK_ADJUSTMENTS);

/** Seuil de feedbacks "facile" pour le bonus */
const EASY_FEEDBACK_THRESHOLD = 4;

/** Facteur de progression des reps par semaine (+5%) */
const WEEKLY_REPS_PROGRESSION = 0.05;

/**
 * Profils d'entraînement quotidiens.
 *
 * Chaque profil définit :
 * - seriesBase  : nombre de séries
 * - repsRatio   : ratio de reps par rapport au test max
 * - restConfig  : paramètres de calcul du repos
 * - label       : nom lisible
 */
const TRAINING_PROFILES = {
  ENDURANCE: {
    seriesBase: 5,
    repsRatio: 0.65,
    restConfig: {
      baseRest: 40,
      threshold: 15,
      addPer: 3,
      chunkSize: 1
    },
    label: 'Endurance'
  },
  HYPERTROPHIE: {
    seriesBase: 4,
    repsRatio: 0.75,
    restConfig: {
      baseRest: 70,
      threshold: 20,
      addPer: 2,
      chunkSize: 1
    },
    label: 'Hypertrophie'
  },
  FORCE: {
    seriesBase: 3,
    repsRatio: 0.90,
    restConfig: {
      baseRest: 100,
      threshold: 25,
      addPer: 2,
      chunkSize: 1
    },
    label: 'Force'
  }
};

Object.freeze(TRAINING_PROFILES);

/**
 * Rotation des profils sur 6 jours (J2-J7).
 *
 * Logique :
 * - J2 : ENDURANCE   (récupération active post-test)
 * - J3 : HYPERTROPHIE
 * - J4 : FORCE        (pic d'intensité mi-semaine)
 * - J5 : ENDURANCE   (récupération)
 * - J6 : HYPERTROPHIE
 * - J7 : ENDURANCE   (récupération pré-test)
 */
const DAILY_ROTATION = [
  'ENDURANCE',      // J2
  'HYPERTROPHIE',   // J3
  'FORCE',          // J4
  'ENDURANCE',      // J5
  'HYPERTROPHIE',   // J6
  'ENDURANCE'       // J7
];

Object.freeze(DAILY_ROTATION);

/** Nombre minimum de semaines pour analyser la tendance */
const TREND_MIN_WEEKS = 3;


// ── Classe DUPAlgorithm ──

class DUPAlgorithm {

  /* ──────────────────────────────────────────────────────────
     IDENTITÉ
     ────────────────────────────────────────────────────────── */

  getName() {
    return 'dup';
  }

  getLabel() {
    return 'Ondulation Quotidienne (DUP)';
  }

  getDescription() {
    return 'Alternance quotidienne entre endurance, hypertrophie et force. ' +
           'Ajuste la progression selon les feedbacks et détecte les plateaux.';
  }


  /* ──────────────────────────────────────────────────────────
     PRÉDICTION DU TEST MAX
     
     Taux de progression = base (5%)
       + ajustement feedbacks
       + ajustement tendance
     
     test_max_prédit = dernier_test_max × (1 + taux)
     ────────────────────────────────────────────────────────── */

  /**
   * Prédit le test max pour la semaine donnée.
   *
   * @param {number} weekNumber — Semaine à prédire
   * @param {Array<Object>} history — Historique
   * @returns {number}
   */
  predictTestMax(weekNumber, history) {
    if (!history || history.length === 0) {
      return 1;
    }

    const lastWeek = history[history.length - 1];
    const lastMax = this._getLastTestMax(history);

    // Calculer le taux de progression ajusté
    const progressionRate = this._calculateProgressionRate(lastWeek, history);

    // Prédiction
    const predicted = lastMax * (1 + progressionRate);

    return Math.max(1, round(predicted));
  }


  /* ──────────────────────────────────────────────────────────
     GÉNÉRATION DU PLAN HEBDOMADAIRE
     
     Pour chaque jour J2-J7 :
     1. Déterminer le profil (rotation ENDURANCE/HYPERTROPHIE/FORCE)
     2. Calculer les reps selon le ratio et le facteur de progression
     3. Appliquer les séries du profil
     4. Calculer le repos selon la zone
     ────────────────────────────────────────────────────────── */

  /**
   * Génère le plan d'entraînement J2-J7.
   *
   * @param {number} weekNumber
   * @param {number} testMax
   * @param {Array<Object>} history
   * @returns {Object}
   */
  generatePlan(weekNumber, testMax, history) {
    // Mode grand débutant
    if (testMax < 5) {
      return this._generateBeginnerPlan();
    }

    // Facteur de progression cumulé
    const progressionFactor = this._calculateProgressionFactor(weekNumber);

    const plan = {};

    for (let i = 0; i < DAILY_ROTATION.length; i++) {
      const dayNumber = i + 2; // J2 à J7
      const profileName = DAILY_ROTATION[i];
      const profile = TRAINING_PROFILES[profileName];

      const dayPlan = this._generateDayPlan(
        testMax,
        profile,
        profileName,
        progressionFactor
      );

      plan[`day${dayNumber}`] = dayPlan;
    }

    return plan;
  }


  /* ──────────────────────────────────────────────────────────
     CALCUL DU TAUX DE PROGRESSION
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule le taux de progression ajusté pour la prédiction.
   *
   * Base : 5%
   * Ajustements :
   *   + 2% si ≥4 feedbacks "facile"
   *   - 2% si ≥1 feedback "impossible"
   *   + 1% si tendance croissante sur 3 semaines
   *   - 1% si tendance stagnante
   *
   * @param {Object} lastWeek — Dernière semaine complétée
   * @param {Array<Object>} history — Historique complet
   * @returns {number} Taux de progression (ex: 0.07 pour +7%)
   * @private
   */
  _calculateProgressionRate(lastWeek, history) {
    let rate = BASE_PROGRESSION_RATE;

    // Ajustement selon les feedbacks de la dernière semaine
    rate += this._feedbackAdjustment(lastWeek);

    // Ajustement selon la tendance sur 3 semaines
    rate += this._trendAdjustment(history);

    // Borner le taux entre 0% et 15%
    return clamp(rate, 0, 0.15);
  }

  /**
   * Calcule l'ajustement de progression basé sur les feedbacks.
   *
   * @param {Object} week — Semaine à analyser
   * @returns {number} Ajustement (positif ou négatif)
   * @private
   */
  _feedbackAdjustment(week) {
    if (!week || !week.feedbackSummary) return 0;

    const { facile = 0, impossible = 0 } = week.feedbackSummary;
    let adjustment = 0;

    // Bonus si beaucoup de séances faciles
    if (facile >= EASY_FEEDBACK_THRESHOLD) {
      adjustment += FEEDBACK_ADJUSTMENTS.MANY_EASY;
    }

    // Malus si au moins une séance impossible
    if (impossible >= 1) {
      adjustment += FEEDBACK_ADJUSTMENTS.ANY_IMPOSSIBLE;
    }

    return adjustment;
  }

  /**
   * Calcule l'ajustement basé sur la tendance des test max.
   *
   * @param {Array<Object>} history
   * @returns {number}
   * @private
   */
  _trendAdjustment(history) {
    if (!history || history.length < TREND_MIN_WEEKS) return 0;

    // Prendre les 3 dernières semaines avec test max
    const recentMaxes = this._getRecentTestMaxes(history, TREND_MIN_WEEKS);

    if (recentMaxes.length < TREND_MIN_WEEKS) return 0;

    const trend = detectTrend(recentMaxes);

    switch (trend) {
      case 'increasing':
        return FEEDBACK_ADJUSTMENTS.TREND_INCREASING;
      case 'stagnant':
        return FEEDBACK_ADJUSTMENTS.TREND_STAGNANT;
      case 'decreasing':
        return FEEDBACK_ADJUSTMENTS.TREND_STAGNANT; // Même malus que stagnation
      default:
        return 0;
    }
  }

  /**
   * Calcule le facteur de progression cumulé pour les reps.
   *
   * Chaque semaine, les reps de chaque profil augmentent de 5%.
   * Facteur = 1 + (weekNumber - 1) × 0.05
   *
   * @param {number} weekNumber
   * @returns {number}
   * @private
   */
  _calculateProgressionFactor(weekNumber) {
    return 1 + (weekNumber - 1) * WEEKLY_REPS_PROGRESSION;
  }


  /* ──────────────────────────────────────────────────────────
     GÉNÉRATION D'UN JOUR
     ────────────────────────────────────────────────────────── */

  /**
   * Génère le plan d'un jour selon son profil.
   *
   * @param {number} testMax — Test max actuel
   * @param {Object} profile — Profil d'entraînement (TRAINING_PROFILES[type])
   * @param {string} profileName — Nom du profil (ENDURANCE, HYPERTROPHIE, FORCE)
   * @param {number} progressionFactor — Facteur de progression cumulé
   * @returns {{series: number, reps: number, rest: number, type: string}}
   * @private
   */
  _generateDayPlan(testMax, profile, profileName, progressionFactor) {
    // Calculer les reps cibles
    let reps = round(testMax * profile.repsRatio * progressionFactor);

    // Borner les reps
    reps = clamp(reps, 3, Math.ceil(testMax * 1.2));

    // Séries fixes selon le profil
    const series = clamp(profile.seriesBase, 2, 10);

    // Calculer le repos selon la zone
    const rest = this._calculateProfileRest(reps, profile.restConfig);

    return {
      series,
      reps,
      rest,
      type: profileName
    };
  }

  /**
   * Calcule le repos pour un profil donné.
   *
   * @param {number} reps — Nombre de reps par série
   * @param {Object} restConfig — Configuration du repos pour ce profil
   * @returns {number} Repos en secondes
   * @private
   */
  _calculateProfileRest(reps, restConfig) {
    const rest = calculateRest(
      reps,
      restConfig.baseRest,
      restConfig.threshold,
      restConfig.addPer,
      restConfig.chunkSize
    );

    return clamp(round(rest), 20, 180);
  }


  /* ──────────────────────────────────────────────────────────
     UTILITAIRES
     ────────────────────────────────────────────────────────── */

  /**
   * Récupère les N derniers test max de l'historique.
   *
   * @param {Array<Object>} history
   * @param {number} count
   * @returns {number[]}
   * @private
   */
  _getRecentTestMaxes(history, count) {
    const maxes = [];

    for (let i = history.length - 1; i >= 0 && maxes.length < count; i--) {
      if (typeof history[i].testMax === 'number' && history[i].testMax > 0) {
        maxes.unshift(history[i].testMax);
      }
    }

    return maxes;
  }

  /**
   * Récupère le dernier test max valide.
   *
   * @param {Array<Object>} history
   * @returns {number}
   * @private
   */
  _getLastTestMax(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (typeof history[i].testMax === 'number' && history[i].testMax > 0) {
        return history[i].testMax;
      }
    }
    return 10;
  }

  /**
   * Génère un plan simplifié pour les grands débutants.
   *
   * @returns {Object}
   * @private
   */
  _generateBeginnerPlan() {
    const plan = {};
    for (let i = 0; i < DAILY_ROTATION.length; i++) {
      const dayNumber = i + 2;
      plan[`day${dayNumber}`] = {
        series: 5,
        reps: 3,
        rest: 90,
        type: DAILY_ROTATION[i]
      };
    }
    return plan;
  }


  /* ──────────────────────────────────────────────────────────
     MÉTHODES D'ANALYSE (pour l'affichage)
     ────────────────────────────────────────────────────────── */

  /**
   * Retourne les détails du profil d'un jour spécifique.
   *
   * @param {number} dayNumber — Numéro du jour (2-7)
   * @param {number} testMax
   * @param {number} weekNumber
   * @returns {{profileName: string, profile: Object, reps: number, series: number, rest: number}}
   */
  getDayDetails(dayNumber, testMax, weekNumber) {
    const dayIndex = clamp(dayNumber - 2, 0, 5);
    const profileName = DAILY_ROTATION[dayIndex];
    const profile = TRAINING_PROFILES[profileName];
    const progressionFactor = this._calculateProgressionFactor(weekNumber);

    const reps = clamp(
      round(testMax * profile.repsRatio * progressionFactor),
      3,
      Math.ceil(testMax * 1.2)
    );

    const rest = this._calculateProfileRest(reps, profile.restConfig);

    return {
      profileName,
      profile,
      reps,
      series: profile.seriesBase,
      rest,
      label: profile.label
    };
  }

  /**
   * Retourne le résumé de la rotation hebdomadaire.
   * Utile pour l'affichage dans le dashboard.
   *
   * @returns {Array<{day: number, type: string, label: string}>}
   */
  getWeekRotation() {
    return DAILY_ROTATION.map((profileName, index) => ({
      day: index + 2,
      type: profileName,
      label: TRAINING_PROFILES[profileName].label
    }));
  }

  /**
   * Analyse la variété d'entraînement de la semaine.
   * Utile pour le scoring feedback (DUP devrait avoir
   * une bonne diversité de feedbacks).
   *
   * @param {Object} feedbackSummary
   * @returns {{diversity: string, score: number}}
   */
  analyzeFeedbackDiversity(feedbackSummary) {
    if (!feedbackSummary) {
      return { diversity: 'unknown', score: 50 };
    }

    const { facile = 0, parfait = 0, impossible = 0 } = feedbackSummary;
    const total = facile + parfait + impossible;

    if (total === 0) {
      return { diversity: 'none', score: 50 };
    }

    const parfaitRatio = parfait / total;
    const impossibleRatio = impossible / total;

    // Score de diversité :
    // Idéal DUP : mix de facile (endurance) et parfait (force/hypertrophie)
    // avec peu ou pas d'impossible
    let score = 50;

    // Bonus pour un bon taux de "parfait" (40-70%)
    if (parfaitRatio >= 0.4 && parfaitRatio <= 0.7) {
      score += 25;
    } else if (parfaitRatio > 0.7) {
      score += 15; // Trop de "parfait" → peut-être sous-stimulé en endurance
    }

    // Bonus pour un peu de "facile" (les jours endurance devraient être faciles)
    if (facile > 0 && facile <= 3) {
      score += 15;
    }

    // Malus pour les impossibles
    score -= impossibleRatio * 40;

    let diversity;
    if (parfaitRatio > 0.6 && impossibleRatio === 0) {
      diversity = 'optimal';
    } else if (impossibleRatio > 0.3) {
      diversity = 'too_hard';
    } else if (facile / total > 0.7) {
      diversity = 'too_easy';
    } else {
      diversity = 'balanced';
    }

    return {
      diversity,
      score: clamp(round(score), 0, 100)
    };
  }

  /**
   * Calcule le volume total prédit pour la semaine.
   *
   * @param {number} weekNumber
   * @param {number} testMax
   * @returns {number}
   */
  getPredictedWeeklyVolume(weekNumber, testMax) {
    const progressionFactor = this._calculateProgressionFactor(weekNumber);
    let total = 0;

    for (let i = 0; i < DAILY_ROTATION.length; i++) {
      const profileName = DAILY_ROTATION[i];
      const profile = TRAINING_PROFILES[profileName];
      const reps = clamp(
        round(testMax * profile.repsRatio * progressionFactor),
        3,
        Math.ceil(testMax * 1.2)
      );
      total += profile.seriesBase * reps;
    }

    return total;
  }
}


// ── Export ──

export { DUPAlgorithm, TRAINING_PROFILES, DAILY_ROTATION };
export default DUPAlgorithm;