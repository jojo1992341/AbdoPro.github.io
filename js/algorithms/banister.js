/* ════════════════════════════════════════════════════════════════
   AbdoPro — algorithms/banister.js

   ALGORITHME 2 — Modèle de Surcompensation Exponentielle
                  Décroissante (Fitness-Fatigue)
   ─────────────────────────────────────────────────────────────
   Source scientifique :
   Modèle fitness-fatigue de Banister (1975, "Training Theory
   and Methods"). La performance est la différence entre un
   effet positif d'entraînement (fitness) et un effet négatif
   (fatigue), suivant des courbes exponentielles décroissantes
   avec des constantes de temps différentes.

   Principe :
   Performance(t) = P_base + Fitness(t) - Fatigue(t)
   - Fitness persiste longtemps (τ1 = 45 jours)
   - Fatigue se dissipe vite (τ2 = 15 jours)
   - Chaque séance génère plus de fatigue que de fitness (k2 > k1)
   - Mais la fatigue disparaît plus vite → surcompensation

   Quand cet algorithme est optimal :
   Utilisateur avec historique de 3+ semaines, détection de
   surmenage, patterns non-linéaires.
   Éligible à partir de la semaine 4.

   ─────────────────────────────────────────────────────────────
   Contrat d'interface :
     algo.getName()         → 'banister'
     algo.getLabel()        → 'Fitness-Fatigue (Banister)'
     algo.getDescription()  → string
     algo.predictTestMax(weekNumber, history)           → number
     algo.generatePlan(weekNumber, testMax, history)    → Object
   ════════════════════════════════════════════════════════════════ */

import {
  clamp,
  round,
  banisterPerformance,
  netEffectPerUnit,
  volumeToSeriesReps,
  calculateRest
} from '../utils/math.js';


// ── Constantes du modèle ──

/** Paramètres par défaut du modèle Banister */
const MODEL_PARAMS = {
  /** Gain fitness par unité de charge */
  k1: 1,
  /** Gain fatigue par unité de charge (monte plus vite que fitness) */
  k2: 2,
  /** Constante de temps fitness en jours (persiste longtemps) */
  tau1: 45,
  /** Constante de temps fatigue en jours (se dissipe plus vite) */
  tau2: 15
};

Object.freeze(MODEL_PARAMS);

/**
 * Plages de charge optimale selon l'effet net.
 *
 * - Si l'effet net est positif (fitness > fatigue au jour du test),
 *   on peut charger davantage (80% de la performance estimée).
 * - Si l'effet net est négatif (fatigue domine),
 *   on réduit la charge (60% de la performance estimée).
 */
const CHARGE_RATIOS = {
  POSITIVE_NET: 0.80,
  NEGATIVE_NET: 0.60
};

Object.freeze(CHARGE_RATIOS);

/** Types de jours selon leur position dans la semaine */
const DAY_TYPES = {
  2: { type: 'RECOVERY',  label: 'Récupération' },
  3: { type: 'MODERATE',  label: 'Modéré' },
  4: { type: 'INTENSE',   label: 'Intense' },
  5: { type: 'MODERATE',  label: 'Modéré' },
  6: { type: 'MODERATE',  label: 'Modéré' },
  7: { type: 'LIGHT',     label: 'Léger' }
};

Object.freeze(DAY_TYPES);

/**
 * Facteurs de modulation de charge par type de jour.
 * Permettent de varier l'intensité dans la semaine
 * même quand le modèle Banister est le moteur principal.
 */
const DAY_CHARGE_MODIFIERS = {
  RECOVERY: 0.70,
  MODERATE: 0.85,
  INTENSE:  1.00,
  LIGHT:    0.60
};

Object.freeze(DAY_CHARGE_MODIFIERS);

/** Volume minimum par jour (en reps) */
const MIN_DAILY_VOLUME = 6;


// ── Classe BanisterAlgorithm ──

class BanisterAlgorithm {

  /* ──────────────────────────────────────────────────────────
     IDENTITÉ
     ────────────────────────────────────────────────────────── */

  getName() {
    return 'banister';
  }

  getLabel() {
    return 'Fitness-Fatigue (Banister)';
  }

  getDescription() {
    return 'Modèle bi-exponentiel de surcompensation. ' +
           'Optimise la charge quotidienne pour maximiser ' +
           'la performance au prochain test en équilibrant ' +
           'fitness accumulée et fatigue résiduelle.';
  }


  /* ──────────────────────────────────────────────────────────
     PRÉDICTION DU TEST MAX
     
     Utilise le modèle fitness-fatigue pour estimer la
     performance au jour du prochain test.
     
     Performance(t_test) = P_base + Σ fitness_i - Σ fatigue_i
     ────────────────────────────────────────────────────────── */

  /**
   * Prédit le test max pour la semaine donnée.
   *
   * @param {number} weekNumber — Numéro de la semaine à prédire
   * @param {Array<Object>} history — Historique des semaines passées
   * @returns {number} Prédiction (entier ≥ 1)
   */
  predictTestMax(weekNumber, history) {
    if (!history || history.length === 0) {
      return 1;
    }

    const pBase = this._getBasePerformance(history);
    const sessions = this._flattenSessions(history);

    // Le test a lieu le jour 1 de la semaine N = jour (N-1)*7 + 1
    const testDay = (weekNumber - 1) * 7 + 1;

    // Calculer performance au jour du test
    const result = banisterPerformance(
      pBase,
      sessions,
      testDay,
      MODEL_PARAMS
    );

    return Math.max(1, round(result.performance));
  }


  /* ──────────────────────────────────────────────────────────
     GÉNÉRATION DU PLAN HEBDOMADAIRE
     
     Pour chaque jour J2-J7 :
     1. Calculer l'effet net de l'entraînement ce jour-là
        sur la performance au jour du prochain test
     2. Estimer la performance courante à ce jour
     3. Déterminer la charge optimale
     4. Convertir en séries × reps + repos
     ────────────────────────────────────────────────────────── */

  /**
   * Génère le plan d'entraînement J2-J7.
   *
   * @param {number} weekNumber — Numéro de la semaine
   * @param {number} testMax    — Résultat du test max
   * @param {Array<Object>} history — Historique
   * @returns {Object} Plan { day2: {series, reps, rest, type}, ..., day7: {...} }
   */
  generatePlan(weekNumber, testMax, history) {
    // Mode grand débutant
    if (testMax < 5) {
      return this._generateBeginnerPlan();
    }

    const pBase = this._getBasePerformance(history);
    const sessions = this._flattenSessions(history);

    // Jour du prochain test (semaine N+1, jour 1)
    const nextTestDay = weekNumber * 7 + 1;

    const plan = {};

    for (let d = 2; d <= 7; d++) {
      const sessionDay = (weekNumber - 1) * 7 + d;
      const dayConfig = DAY_TYPES[d];

      // 1. Calculer l'effet net de cet entraînement
      //    sur la performance au jour du prochain test
      const netEffect = netEffectPerUnit(
        sessionDay,
        nextTestDay,
        MODEL_PARAMS
      );

      // 2. Estimer la performance courante à ce jour
      const currentPerf = banisterPerformance(
        pBase,
        sessions,
        sessionDay,
        MODEL_PARAMS
      );

      // 3. Déterminer la charge optimale
      const chargeOptimale = this._calculateOptimalCharge(
        currentPerf.performance,
        netEffect,
        dayConfig.type
      );

      // 4. Convertir en séries × reps
      const { series, reps } = volumeToSeriesReps(chargeOptimale, testMax);

      // 5. Calculer le repos
      const rest = this._calculateDayRest(reps, dayConfig.type);

      plan[`day${d}`] = {
        series,
        reps,
        rest,
        type: dayConfig.type
      };
    }

    return plan;
  }


  /* ──────────────────────────────────────────────────────────
     CALCULS INTERNES
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule la charge optimale pour un jour donné.
   *
   * La charge dépend de :
   * - La performance estimée ce jour-là
   * - L'effet net de l'entraînement (fitness vs fatigue)
   * - Le type de jour (recovery, intense, etc.)
   *
   * @param {number} estimatedPerformance — Performance estimée
   * @param {number} netEffect — Effet net par unité de charge
   * @param {string} dayType — Type de jour (RECOVERY, INTENSE, etc.)
   * @returns {number} Charge optimale (volume total en reps)
   * @private
   */
  _calculateOptimalCharge(estimatedPerformance, netEffect, dayType) {
    // Ratio de charge selon l'effet net
    const chargeRatio = netEffect > 0
      ? CHARGE_RATIOS.POSITIVE_NET
      : CHARGE_RATIOS.NEGATIVE_NET;

    // Charge brute
    let charge = estimatedPerformance * chargeRatio;

    // Moduler selon le type de jour
    const dayModifier = DAY_CHARGE_MODIFIERS[dayType] || 0.85;
    charge *= dayModifier;

    // Borner
    return Math.max(MIN_DAILY_VOLUME, round(charge));
  }

  /**
   * Calcule le temps de repos adapté au type de jour et aux reps.
   *
   * Formule du PRD : repos = 45s + (nombre_reps × 2)s
   * Modulé par le type de jour.
   *
   * @param {number} reps — Reps par série
   * @param {string} dayType — Type de jour
   * @returns {number} Repos en secondes
   * @private
   */
  _calculateDayRest(reps, dayType) {
    // Base : 45s + 2s par rep
    let rest = 45 + reps * 2;

    // Modulation par type de jour
    switch (dayType) {
      case 'RECOVERY':
        rest *= 0.85; // Repos plus court en récupération
        break;
      case 'INTENSE':
        rest *= 1.15; // Repos plus long en jour intense
        break;
      case 'LIGHT':
        rest *= 0.80; // Repos court en jour léger
        break;
      case 'MODERATE':
      default:
        // Pas de modification
        break;
    }

    return clamp(round(rest), 20, 180);
  }

  /**
   * Récupère la performance de base (premier test max).
   *
   * @param {Array<Object>} history
   * @returns {number}
   * @private
   */
  _getBasePerformance(history) {
    if (!history || history.length === 0) return 10;

    // Premier test max valide
    for (let i = 0; i < history.length; i++) {
      if (typeof history[i].testMax === 'number' && history[i].testMax > 0) {
        return history[i].testMax;
      }
    }

    return 10;
  }

  /**
   * Aplatit l'historique des semaines en une liste de séances
   * avec leur jour absolu et leur volume.
   *
   * Convertit la structure hiérarchique (semaines → séances)
   * en liste plate nécessaire au modèle Banister.
   *
   * @param {Array<Object>} history — Historique des semaines
   * @returns {Array<{day: number, volume: number}>}
   * @private
   */
  _flattenSessions(history) {
    const sessions = [];

    if (!history) return sessions;

    history.forEach(week => {
      if (!week.sessions || !Array.isArray(week.sessions)) return;

      const weekNumber = week.weekNumber || 1;

      week.sessions.forEach(session => {
        // Calculer le jour absolu
        const dayNumber = session.dayNumber || 1;
        const absoluteDay = (weekNumber - 1) * 7 + dayNumber;

        // Calculer le volume réalisé
        let volume = 0;
        if (session.actual && typeof session.actual.totalRepsCompleted === 'number') {
          volume = session.actual.totalRepsCompleted;
        } else if (session.type === 'test_max' && week.testMax) {
          // Le test max compte comme une séance avec volume = testMax
          volume = week.testMax;
        }

        // N'ajouter que les séances avec du volume
        if (volume > 0) {
          sessions.push({
            day: absoluteDay,
            volume
          });
        }
      });
    });

    // Trier par jour croissant
    sessions.sort((a, b) => a.day - b.day);

    return sessions;
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
        type: DAY_TYPES[d].type
      };
    }
    return plan;
  }


  /* ──────────────────────────────────────────────────────────
     MÉTHODES D'ANALYSE (pour le debug et l'affichage)
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule l'état fitness/fatigue à un jour donné.
   * Utile pour l'affichage dans l'historique.
   *
   * @param {Array<Object>} history — Historique des semaines
   * @param {number} targetDay — Jour absolu
   * @returns {{performance: number, fitness: number, fatigue: number}}
   */
  getStateAtDay(history, targetDay) {
    const pBase = this._getBasePerformance(history);
    const sessions = this._flattenSessions(history);

    return banisterPerformance(
      pBase,
      sessions,
      targetDay,
      MODEL_PARAMS
    );
  }

  /**
   * Calcule la courbe de performance prédite sur un intervalle.
   * Utile pour le graphique dans l'historique.
   *
   * @param {Array<Object>} history — Historique
   * @param {number} fromDay — Jour de début
   * @param {number} toDay — Jour de fin
   * @param {number} [step=1] — Pas entre les points
   * @returns {Array<{day: number, performance: number, fitness: number, fatigue: number}>}
   */
  getPerformanceCurve(history, fromDay, toDay, step = 1) {
    const pBase = this._getBasePerformance(history);
    const sessions = this._flattenSessions(history);
    const curve = [];

    for (let day = fromDay; day <= toDay; day += step) {
      const result = banisterPerformance(
        pBase,
        sessions,
        day,
        MODEL_PARAMS
      );

      curve.push({
        day,
        performance: round(result.performance, 1),
        fitness: round(result.fitness, 1),
        fatigue: round(result.fatigue, 1)
      });
    }

    return curve;
  }

  /**
   * Analyse l'état de surmenage de l'utilisateur.
   * Retourne un diagnostic basé sur le ratio fitness/fatigue.
   *
   * @param {Array<Object>} history
   * @returns {{status: string, ratio: number, recommendation: string}}
   *   status : 'optimal' | 'overreaching' | 'undertrained' | 'peaking'
   */
  analyzeTrainingStatus(history) {
    if (!history || history.length === 0) {
      return {
        status: 'undertrained',
        ratio: 0,
        recommendation: 'Commencez par un test max.'
      };
    }

    const lastWeek = history[history.length - 1];
    const weekNumber = lastWeek.weekNumber || 1;
    const currentDay = (weekNumber - 1) * 7 + 7; // Fin de semaine

    const state = this.getStateAtDay(history, currentDay);

    // Ratio fitness / fatigue
    const ratio = state.fatigue > 0
      ? round(state.fitness / state.fatigue, 2)
      : state.fitness > 0 ? 999 : 0;

    let status;
    let recommendation;

    if (ratio > 2.0) {
      // Fitness domine largement → sous-entraînement ou pic
      status = 'peaking';
      recommendation = 'Performance au pic. Bon moment pour un test max ambitieux.';
    } else if (ratio > 1.2) {
      // Bon équilibre
      status = 'optimal';
      recommendation = 'Équilibre fitness/fatigue optimal. Continuez le programme.';
    } else if (ratio > 0.8) {
      // Fatigue élevée mais gérable
      status = 'overreaching';
      recommendation = 'Fatigue accumulée détectée. Réduisez le volume cette semaine.';
    } else {
      // Fatigue domine → surmenage
      status = 'overtrained';
      recommendation = 'Surmenage probable. Envisagez une semaine de deload.';
    }

    return { status, ratio, recommendation };
  }

  /**
   * Retourne les paramètres du modèle.
   * Utile pour l'affichage dans les crédits scientifiques.
   *
   * @returns {Object}
   */
  getModelParams() {
    return { ...MODEL_PARAMS };
  }
}


// ── Export ──

export { BanisterAlgorithm, MODEL_PARAMS, DAY_TYPES };
export default BanisterAlgorithm;