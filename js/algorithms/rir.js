/* ════════════════════════════════════════════════════════════════
   AbdoPro — algorithms/rir.js

   ALGORITHME 4 — Modèle Répétitions en Réserve (RIR / RPE)
   ─────────────────────────────────────────────────────────────
   Source scientifique :
   Zourdos et al. (2016, "Novel Resistance Training–Specific
   Rating of Perceived Exertion Scale Measuring Repetitions
   in Reserve"). L'autorégulation de la charge via la proximité
   de l'échec musculaire, mesurée par les répétitions restantes
   en réserve (RIR).

   Principe :
   Le feedback utilisateur ("Facile", "Parfait", "Impossible")
   est mappé sur une échelle RIR qui ajuste le volume de la
   séance suivante en temps réel et le plan hebdomadaire.

   Cible optimale : RIR = 2 (2 reps en réserve)

   Quand cet algorithme est optimal :
   Utilisateur qui donne des feedbacks cohérents, détection fine
   de la fatigue cumulée. Éligible à partir de la semaine 2.

   ─────────────────────────────────────────────────────────────
   Contrat d'interface :
     algo.getName()         → 'rir'
     algo.getLabel()        → 'Autorégulation (RIR)'
     algo.getDescription()  → string
     algo.predictTestMax(weekNumber, history)           → number
     algo.generatePlan(weekNumber, testMax, history)    → Object
   ════════════════════════════════════════════════════════════════ */

import {
  clamp,
  round,
  mean,
  calculateRest
} from '../utils/math.js';


// ── Constantes ──

/**
 * Mapping feedback → RIR estimé.
 *
 * RIR = Repetitions In Reserve (nombre de reps que l'utilisateur
 * aurait pu faire en plus avant l'échec musculaire).
 *
 * - "facile"     → RIR 4+ (trop facile, sous-stimulation)
 * - "parfait"    → RIR 1-3 (zone optimale, représenté par 2)
 * - "impossible" → RIR 0 (échec musculaire, surstimulation)
 */
const FEEDBACK_TO_RIR = {
  facile:     4,
  parfait:    2,
  impossible: 0
};

Object.freeze(FEEDBACK_TO_RIR);

/** Cible RIR optimale (2 reps en réserve) */
const TARGET_RIR = 2;

/**
 * Multiplicateurs de volume selon le RIR moyen.
 *
 * Plus le RIR moyen est haut, plus l'utilisateur est
 * sous-entraîné → on augmente le volume.
 * Plus le RIR est bas, plus la fatigue est élevée → on réduit.
 *
 * | RIR moyen  | Multiplicateur | Interprétation       |
 * |------------|----------------|----------------------|
 * | > 3.5      | 4.0            | Fort sous-entraînement |
 * | 2.0 - 3.5  | 3.5            | Volume optimal       |
 * | 1.0 - 2.0  | 3.0            | Volume modéré        |
 * | < 1.0      | 2.0            | Deload nécessaire    |
 */
const VOLUME_MULTIPLIERS = [
  { minRIR: 3.5,  multiplier: 4.0, label: 'Fort volume',    status: 'under' },
  { minRIR: 2.0,  multiplier: 3.5, label: 'Volume optimal', status: 'optimal' },
  { minRIR: 1.0,  multiplier: 3.0, label: 'Volume modéré',  status: 'moderate' },
  { minRIR: -Infinity, multiplier: 2.0, label: 'Deload', status: 'deload' }
];

Object.freeze(VOLUME_MULTIPLIERS);

/**
 * Ajustements inter-séance basés sur le dernier feedback.
 *
 * Quand le feedback de la dernière séance est connu,
 * on ajuste les reps de la séance suivante.
 *
 * - "facile"     → +10% reps
 * - "parfait"    → +5% reps
 * - "impossible" → Géré par la règle Impossible (engine.js)
 */
const INTER_SESSION_ADJUSTMENTS = {
  facile:  1.10,
  parfait: 1.05
};

Object.freeze(INTER_SESSION_ADJUSTMENTS);

/** Taux de progression de base pour la prédiction */
const BASE_PREDICTION_RATE = 0.03;

/** Bonus de progression par point de RIR */
const RIR_PREDICTION_BONUS = 0.015;

/**
 * Distribution du volume sur 6 jours (J2-J7).
 * Légèrement décroissante pour favoriser la récupération en fin de semaine.
 */
const DAILY_DISTRIBUTION = [0.18, 0.17, 0.17, 0.17, 0.16, 0.15];

Object.freeze(DAILY_DISTRIBUTION);

/** Seuil de RIR pour déclencher le mode deload */
const DELOAD_RIR_THRESHOLD = 1.5;


// ── Classe RIRAlgorithm ──

class RIRAlgorithm {

  /* ──────────────────────────────────────────────────────────
     IDENTITÉ
     ────────────────────────────────────────────────────────── */

  getName() {
    return 'rir';
  }

  getLabel() {
    return 'Autorégulation (RIR)';
  }

  getDescription() {
    return 'Ajuste automatiquement le volume et l\'intensité ' +
           'en fonction de vos feedbacks. Détecte la fatigue ' +
           'cumulée et adapte la charge en temps réel.';
  }


  /* ──────────────────────────────────────────────────────────
     PRÉDICTION DU TEST MAX
     
     Le RIR moyen indique la marge de progression :
     - RIR élevé (4+) → forte marge → progression rapide
     - RIR bas (0-1) → pas de marge → progression lente
     
     taux = 3% + (RIR_moyen × 1.5%)
     prédit = dernier_max × (1 + taux)
     ────────────────────────────────────────────────────────── */

  /**
   * Prédit le test max pour la semaine donnée.
   *
   * @param {number} weekNumber
   * @param {Array<Object>} history
   * @returns {number}
   */
  predictTestMax(weekNumber, history) {
    if (!history || history.length === 0) {
      return 1;
    }

    const lastWeek = history[history.length - 1];
    const lastMax = this._getLastTestMax(history);

    // Récupérer le RIR moyen de la dernière semaine
    const rirMoyen = this._getWeekRIR(lastWeek);

    // Taux de progression basé sur le RIR
    const progressRate = BASE_PREDICTION_RATE + rirMoyen * RIR_PREDICTION_BONUS;

    // Borner le taux entre 0% et 12%
    const clampedRate = clamp(progressRate, 0, 0.12);

    return Math.max(1, round(lastMax * (1 + clampedRate)));
  }


  /* ──────────────────────────────────────────────────────────
     GÉNÉRATION DU PLAN HEBDOMADAIRE
     
     1. Calculer le RIR moyen de la semaine précédente
     2. Déterminer le multiplicateur de volume
     3. Calculer le volume total
     4. Distribuer sur 6 jours
     5. Appliquer les ajustements inter-séance
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

    // 1. Calculer le RIR moyen
    const lastWeek = history && history.length > 0
      ? history[history.length - 1]
      : null;
    const rirMoyen = this._getWeekRIR(lastWeek);

    // 2. Déterminer le multiplicateur de volume
    const volumeConfig = this._getVolumeMultiplier(rirMoyen);

    // 3. Calculer le volume total et les reps cibles
    const volumeTotal = testMax * volumeConfig.multiplier;
    const repsCible = this._calculateTargetReps(testMax, rirMoyen);

    // 4. Générer le plan jour par jour
    const plan = {};

    for (let i = 0; i < DAILY_DISTRIBUTION.length; i++) {
      const dayNumber = i + 2;
      const dayVolume = round(volumeTotal * DAILY_DISTRIBUTION[i]);

      const dayPlan = this._generateDayPlan(
        dayVolume,
        repsCible,
        testMax,
        volumeConfig.status
      );

      plan[`day${dayNumber}`] = dayPlan;
    }

    // 5. Appliquer les ajustements inter-séance
    this._applyInterSessionAdjustments(plan, lastWeek, testMax);

    return plan;
  }


  /* ──────────────────────────────────────────────────────────
     CALCUL DU RIR
     ────────────────────────────────────────────────────────── */

  /**
   * Convertit un feedback en valeur RIR.
   *
   * @param {string} feedback — 'facile', 'parfait', ou 'impossible'
   * @returns {number} Valeur RIR estimée
   */
  mapFeedbackToRIR(feedback) {
    if (!feedback || typeof feedback !== 'string') return TARGET_RIR;
    return FEEDBACK_TO_RIR[feedback] ?? TARGET_RIR;
  }

  /**
   * Calcule le RIR moyen d'une semaine à partir de son feedbackSummary.
   *
   * Si le feedbackSummary contient un rirMoyen pré-calculé, l'utilise.
   * Sinon, calcule à partir des compteurs de feedbacks.
   *
   * @param {Object|null} week — Données de la semaine
   * @returns {number} RIR moyen (défaut: 2 = optimal)
   * @private
   */
  _getWeekRIR(week) {
    if (!week) return TARGET_RIR;

    const summary = week.feedbackSummary;
    if (!summary) return TARGET_RIR;

    // Utiliser le RIR moyen pré-calculé s'il existe
    if (typeof summary.rirMoyen === 'number') {
      return summary.rirMoyen;
    }

    // Calculer à partir des feedbacks
    return this._calculateRIRFromFeedbacks(summary);
  }

  /**
   * Calcule le RIR moyen à partir des compteurs de feedbacks.
   *
   * @param {Object} summary — { facile, parfait, impossible }
   * @returns {number}
   * @private
   */
  _calculateRIRFromFeedbacks(summary) {
    const { facile = 0, parfait = 0, impossible = 0 } = summary;
    const total = facile + parfait + impossible;

    if (total === 0) return TARGET_RIR;

    const rirValues = [
      ...Array(facile).fill(FEEDBACK_TO_RIR.facile),
      ...Array(parfait).fill(FEEDBACK_TO_RIR.parfait),
      ...Array(impossible).fill(FEEDBACK_TO_RIR.impossible)
    ];

    return round(mean(rirValues), 1);
  }


  /* ──────────────────────────────────────────────────────────
     CALCUL DU VOLUME
     ────────────────────────────────────────────────────────── */

  /**
   * Détermine le multiplicateur de volume selon le RIR moyen.
   *
   * @param {number} rirMoyen
   * @returns {{multiplier: number, label: string, status: string}}
   * @private
   */
  _getVolumeMultiplier(rirMoyen) {
    for (const config of VOLUME_MULTIPLIERS) {
      if (rirMoyen >= config.minRIR) {
        return config;
      }
    }

    // Fallback (ne devrait jamais arriver grâce à -Infinity)
    return VOLUME_MULTIPLIERS[VOLUME_MULTIPLIERS.length - 1];
  }

  /**
   * Calcule les reps cibles par série selon le RIR moyen.
   *
   * Formule du PRD :
   * reps = testMax × (0.6 + RIR_moyen × 0.05)
   *
   * - RIR 0 → 60% du max (facile, récupération)
   * - RIR 2 → 70% du max (optimal)
   * - RIR 4 → 80% du max (challenge)
   *
   * @param {number} testMax
   * @param {number} rirMoyen
   * @returns {number}
   * @private
   */
  _calculateTargetReps(testMax, rirMoyen) {
    const ratio = 0.6 + rirMoyen * 0.05;
    const reps = round(testMax * ratio);
    return clamp(reps, 3, Math.ceil(testMax * 1.2));
  }


  /* ──────────────────────────────────────────────────────────
     GÉNÉRATION D'UN JOUR
     ────────────────────────────────────────────────────────── */

  /**
   * Génère le plan d'un jour.
   *
   * @param {number} dayVolume — Volume cible pour ce jour
   * @param {number} repsCible — Reps cibles par série
   * @param {number} testMax
   * @param {string} status — Status du volume (optimal, deload, etc.)
   * @returns {{series: number, reps: number, rest: number, type: string}}
   * @private
   */
  _generateDayPlan(dayVolume, repsCible, testMax, status) {
    // Calculer le nombre de séries
    let series = repsCible > 0 ? round(dayVolume / repsCible) : 3;

    // Borner
    series = clamp(series, 2, 10);
    const reps = clamp(repsCible, 3, Math.ceil(testMax * 1.2));

    // Calculer le repos basé sur le RIR
    const rest = this._calculateRIRBasedRest(reps, status);

    // Déterminer le type
    const type = status === 'deload' ? 'DELOAD' : 'STANDARD';

    return { series, reps, rest, type };
  }

  /**
   * Calcule le repos basé sur le RIR et le statut de volume.
   *
   * Formule du PRD :
   * repos = 60s + (10 - RIR_moyen × 2) × 10s
   *
   * Simplifié en fonction du statut :
   * - deload   : repos long (récupération)
   * - under    : repos court (sous-entraînement, pas fatigué)
   * - optimal  : repos standard
   * - moderate : repos légèrement allongé
   *
   * @param {number} reps
   * @param {string} status
   * @returns {number} Repos en secondes
   * @private
   */
  _calculateRIRBasedRest(reps, status) {
    let baseRest;

    switch (status) {
      case 'deload':
        baseRest = 90;
        break;
      case 'under':
        baseRest = 45;
        break;
      case 'moderate':
        baseRest = 70;
        break;
      case 'optimal':
      default:
        baseRest = 60;
        break;
    }

    // Ajustement par nombre de reps
    const rest = calculateRest(reps, baseRest, 15, 5, 5);

    return clamp(round(rest), 20, 180);
  }


  /* ──────────────────────────────────────────────────────────
     AJUSTEMENTS INTER-SÉANCE
     ────────────────────────────────────────────────────────── */

  /**
   * Applique les ajustements de reps basés sur le dernier feedback.
   *
   * Si le dernier feedback est "facile" → +10% reps
   * Si le dernier feedback est "parfait" → +5% reps
   * "impossible" est géré par la règle Impossible dans engine.js
   *
   * @param {Object} plan — Plan J2-J7 (modifié en place)
   * @param {Object|null} lastWeek — Dernière semaine
   * @param {number} testMax
   * @private
   */
  _applyInterSessionAdjustments(plan, lastWeek, testMax) {
    if (!lastWeek || !lastWeek.sessions || !Array.isArray(lastWeek.sessions)) {
      return;
    }

    // Trouver le dernier feedback
    const lastFeedback = this._getLastSessionFeedback(lastWeek.sessions);

    if (!lastFeedback || !INTER_SESSION_ADJUSTMENTS[lastFeedback]) {
      return;
    }

    const multiplier = INTER_SESSION_ADJUSTMENTS[lastFeedback];
    const maxReps = Math.ceil(testMax * 1.2);

    // Appliquer le multiplicateur à tous les jours
    for (const dayKey of Object.keys(plan)) {
      const day = plan[dayKey];
      day.reps = clamp(round(day.reps * multiplier), 3, maxReps);
    }
  }

  /**
   * Récupère le feedback de la dernière séance complétée.
   *
   * @param {Array<Object>} sessions
   * @returns {string|null}
   * @private
   */
  _getLastSessionFeedback(sessions) {
    // Parcourir en sens inverse pour trouver la dernière séance avec feedback
    for (let i = sessions.length - 1; i >= 0; i--) {
      const session = sessions[i];
      if (session.feedback &&
          session.status === 'completed' &&
          session.type !== 'test_max') {
        return session.feedback;
      }
    }
    return null;
  }


  /* ──────────────────────────────────────────────────────────
     UTILITAIRES
     ────────────────────────────────────────────────────────── */

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
    for (let d = 2; d <= 7; d++) {
      plan[`day${d}`] = {
        series: 5,
        reps: 3,
        rest: 90,
        type: 'DEBUTANT'
      };
    }
    return plan;
  }


  /* ──────────────────────────────────────────────────────────
     MÉTHODES D'ANALYSE (pour l'affichage)
     ────────────────────────────────────────────────────────── */

  /**
   * Analyse l'état d'entraînement basé sur le RIR.
   *
   * @param {Array<Object>} history
   * @returns {{rirMoyen: number, status: string, recommendation: string, volumeLabel: string}}
   */
  analyzeTrainingLoad(history) {
    if (!history || history.length === 0) {
      return {
        rirMoyen: TARGET_RIR,
        status: 'unknown',
        recommendation: 'Pas assez de données.',
        volumeLabel: 'Volume standard'
      };
    }

    const lastWeek = history[history.length - 1];
    const rirMoyen = this._getWeekRIR(lastWeek);
    const volumeConfig = this._getVolumeMultiplier(rirMoyen);

    let recommendation;

    if (rirMoyen >= 3.5) {
      recommendation = 'Sous-entraînement détecté. Le programme augmente le volume.';
    } else if (rirMoyen >= 2.0) {
      recommendation = 'Charge optimale. Continuez ainsi.';
    } else if (rirMoyen >= 1.0) {
      recommendation = 'Fatigue modérée détectée. Volume légèrement réduit.';
    } else {
      recommendation = 'Fatigue élevée. Semaine de deload programmée.';
    }

    return {
      rirMoyen: round(rirMoyen, 1),
      status: volumeConfig.status,
      recommendation,
      volumeLabel: volumeConfig.label
    };
  }

  /**
   * Calcule la tendance du RIR sur les dernières semaines.
   * Un RIR qui diminue régulièrement indique une fatigue croissante.
   *
   * @param {Array<Object>} history
   * @param {number} [count=4] — Nombre de semaines à analyser
   * @returns {{values: number[], trend: string}}
   */
  getRIRTrend(history, count = 4) {
    if (!history || history.length === 0) {
      return { values: [], trend: 'insufficient' };
    }

    const recentWeeks = history.slice(-count);
    const rirValues = recentWeeks.map(week => this._getWeekRIR(week));

    if (rirValues.length < 2) {
      return { values: rirValues, trend: 'insufficient' };
    }

    // Analyser la tendance
    let decreasing = true;
    let increasing = true;

    for (let i = 1; i < rirValues.length; i++) {
      if (rirValues[i] >= rirValues[i - 1]) decreasing = false;
      if (rirValues[i] <= rirValues[i - 1]) increasing = false;
    }

    let trend;

    if (decreasing) {
      trend = 'fatigue_accumulating';
    } else if (increasing) {
      trend = 'recovery';
    } else {
      trend = 'stable';
    }

    return {
      values: rirValues.map(v => round(v, 1)),
      trend
    };
  }

  /**
   * Estime le nombre de reps en réserve pour une séance donnée.
   *
   * @param {Object} planned — { series, reps }
   * @param {Object} actual — { totalRepsCompleted, totalVolumePlanned }
   * @returns {number} RIR estimé
   */
  estimateSessionRIR(planned, actual) {
    if (!planned || !actual) return TARGET_RIR;

    const planned_total = planned.series * planned.reps;
    const completed = actual.totalRepsCompleted || 0;

    if (planned_total === 0) return TARGET_RIR;

    // Ratio de complétion
    const ratio = completed / planned_total;

    if (ratio >= 1.0) {
      // Tout complété → au moins RIR 1
      // Plus le ratio est élevé, plus le RIR est élevé
      return clamp(round((ratio - 0.8) * 20), 1, 5);
    }

    // Séance incomplète → échec probable
    if (ratio < 0.5) return 0;
    if (ratio < 0.8) return 0;

    return 1;
  }

  /**
   * Calcule le volume total prédit pour la semaine.
   *
   * @param {number} testMax
   * @param {number} rirMoyen
   * @returns {number}
   */
  getPredictedWeeklyVolume(testMax, rirMoyen) {
    const config = this._getVolumeMultiplier(rirMoyen);
    return round(testMax * config.multiplier);
  }

  /**
   * Retourne le mapping feedback → RIR.
   * Utile pour l'affichage dans les crédits scientifiques.
   *
   * @returns {Object}
   */
  getFeedbackMapping() {
    return { ...FEEDBACK_TO_RIR };
  }
}


// ── Export ──

export { RIRAlgorithm, FEEDBACK_TO_RIR, VOLUME_MULTIPLIERS };
export default RIRAlgorithm;