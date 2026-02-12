/* ════════════════════════════════════════════════════════════════
   AbdoPro — algorithms/regression.js

   ALGORITHME 5 — Régression Adaptative Personnalisée
   ─────────────────────────────────────────────────────────────
   Source scientifique :
   Inspiré de Mann et al. (2010, "The effect of autoregulatory
   progressive resistance exercise vs. linear periodization on
   strength improvement in college athletes") et des méthodes
   APRE (Autoregulatory Progressive Resistance Exercise).

   Principe :
   Régression polynomiale d'ordre 2 sur l'historique complet
   des test_max pour prédire la trajectoire de progression,
   combinée à l'analyse des patterns d'échec pour moduler
   le volume.

   Quand cet algorithme est optimal :
   Historique de 4+ semaines, trajectoire de progression
   établie, utilisateur avec pattern personnel identifiable.
   Éligible à partir de la semaine 4.

   ─────────────────────────────────────────────────────────────
   Contrat d'interface :
     algo.getName()         → 'regression'
     algo.getLabel()        → 'Régression Adaptative'
     algo.getDescription()  → string
     algo.predictTestMax(weekNumber, history)           → number
     algo.generatePlan(weekNumber, testMax, history)    → Object
   ════════════════════════════════════════════════════════════════ */

import {
  clamp,
  round,
  fitPolynomial,
  evaluatePolynomial,
  confidenceInterval95,
  progressionRate,
  calculateRest
} from '../utils/math.js';


// ── Constantes ──

/** Multiplicateur de volume de base (volume = testMax_prédit × BASE_MULTIPLIER) */
const BASE_VOLUME_MULTIPLIER = 3;

/**
 * Bornes du facteur d'ajustement réel/théorique.
 *
 * F_adjust = τ_réel / τ_théo
 * Si l'utilisateur progresse plus vite que prévu → F > 1 → plus de volume
 * Si l'utilisateur progresse moins vite → F < 1 → moins de volume
 */
const ADJUST_FACTOR_BOUNDS = {
  MIN: 0.5,
  MAX: 2.0
};

Object.freeze(ADJUST_FACTOR_BOUNDS);

/**
 * Seuils de taux d'échec et leurs réductions de volume.
 *
 * | Taux d'échec | Réduction | Interprétation          |
 * |------------- |-----------|-------------------------|
 * | > 30%        | ×0.70     | Réduction significative |
 * | > 15%        | ×0.85     | Réduction modérée       |
 * | ≤ 15%        | ×1.00     | Pas de réduction        |
 */
const FAILURE_RATE_ADJUSTMENTS = [
  { threshold: 0.30, multiplier: 0.70, label: 'Réduction significative' },
  { threshold: 0.15, multiplier: 0.85, label: 'Réduction modérée' },
  { threshold: 0.00, multiplier: 1.00, label: 'Aucune réduction' }
];

Object.freeze(FAILURE_RATE_ADJUSTMENTS);

/** Ratio de reps par série par rapport au test max prédit */
const REPS_RATIO = 0.70;

/** Paramètres de repos */
const REST_CONFIG = {
  baseRest: 60,
  threshold: 15,
  addPer: 3,
  chunkSize: 1
};

Object.freeze(REST_CONFIG);

/** Taux de progression par défaut (quand pas assez de données) */
const DEFAULT_PROGRESSION_RATE = 0.10;

/** Nombre minimum de points pour la régression polynomiale */
const MIN_POINTS_POLYNOMIAL = 3;


// ── Classe RegressionAlgorithm ──

class RegressionAlgorithm {

  /* ──────────────────────────────────────────────────────────
     IDENTITÉ
     ────────────────────────────────────────────────────────── */

  getName() {
    return 'regression';
  }

  getLabel() {
    return 'Régression Adaptative';
  }

  getDescription() {
    return 'Modèle personnalisé basé sur votre historique complet. ' +
           'Prédit votre trajectoire de progression par régression ' +
           'polynomiale et ajuste le volume selon vos patterns d\'échec.';
  }


  /* ──────────────────────────────────────────────────────────
     PRÉDICTION DU TEST MAX
     
     1. Extraire les points (semaine, testMax) de l'historique
     2. Ajuster un polynôme d'ordre 2
     3. Évaluer au point weekNumber
     
     Modèle : testMax(N) = a×N² + b×N + c
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

    // Extraire les points pour la régression
    const points = this._extractPoints(history);

    if (points.length === 0) {
      return 1;
    }

    // Cas avec un seul point : progression linéaire par défaut
    if (points.length === 1) {
      return Math.max(1, round(
        points[0][1] * (1 + DEFAULT_PROGRESSION_RATE)
      ));
    }

    // Ajuster le modèle
    const model = fitPolynomial(points);

    // Évaluer au point demandé
    const predicted = evaluatePolynomial(model, weekNumber);

    // Protéger contre les prédictions absurdes
    // (le polynôme peut diverger si la courbure est forte)
    const lastMax = points[points.length - 1][1];
    const safePredicted = this._safeguardPrediction(predicted, lastMax, weekNumber, points);

    return Math.max(1, round(safePredicted));
  }


  /* ──────────────────────────────────────────────────────────
     GÉNÉRATION DU PLAN HEBDOMADAIRE
     
     1. Prédire le testMax de la semaine suivante
     2. Calculer le facteur d'ajustement réel/théorique
     3. Calculer le volume total = testMax_prédit × 3 × F_adjust
     4. Appliquer la réduction selon le taux d'échec
     5. Distribuer uniformément sur 6 jours
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

    // 1. Prédire le test max de la semaine suivante
    const predictedNext = this.predictTestMax(weekNumber + 1, history);

    // 2. Calculer le facteur d'ajustement
    const adjustFactor = this._calculateAdjustFactor(
      testMax,
      predictedNext,
      history
    );

    // 3. Calculer le volume brut
    let volume = predictedNext * BASE_VOLUME_MULTIPLIER * adjustFactor;

    // 4. Appliquer la réduction selon le taux d'échec
    const failureRate = this._calculateFailureRate(history);
    const failureAdjustment = this._getFailureAdjustment(failureRate);
    volume *= failureAdjustment.multiplier;

    // 5. Calculer reps et séries par jour
    const repsBase = clamp(
      round(predictedNext * REPS_RATIO),
      3,
      Math.ceil(testMax * 1.2)
    );

    const seriesPerDay = clamp(
      round(volume / repsBase / 6),
      2,
      10
    );

    // 6. Calculer le repos
    const rest = clamp(
      calculateRest(
        repsBase,
        REST_CONFIG.baseRest,
        REST_CONFIG.threshold,
        REST_CONFIG.addPer,
        REST_CONFIG.chunkSize
      ),
      20,
      180
    );

    // 7. Construire le plan (uniforme car la régression ne distingue pas les types)
    const plan = {};

    for (let d = 2; d <= 7; d++) {
      plan[`day${d}`] = {
        series: seriesPerDay,
        reps: repsBase,
        rest,
        type: 'ADAPTATIF'
      };
    }

    return plan;
  }


  /* ──────────────────────────────────────────────────────────
     FACTEUR D'AJUSTEMENT
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule le facteur d'ajustement réel/théorique.
   *
   * F_adjust = τ_réel / τ_théo
   *
   * - τ_réel = progression réelle entre les deux dernières semaines
   * - τ_théo = progression prédite par le modèle
   *
   * Si F > 1 → l'utilisateur progresse plus vite que prévu → plus de volume
   * Si F < 1 → progression plus lente → moins de volume
   *
   * @param {number} testMax — Test max actuel
   * @param {number} predictedNext — Test max prédit pour la semaine suivante
   * @param {Array<Object>} history
   * @returns {number} Facteur borné entre 0.5 et 2.0
   * @private
   */
  _calculateAdjustFactor(testMax, predictedNext, history) {
    if (!history || history.length < 2) {
      return 1.0; // Pas assez de données → facteur neutre
    }

    // Taux de progression réel (entre les deux dernières semaines)
    const previousMax = this._getPreviousTestMax(history);
    const tauReel = progressionRate(previousMax, testMax);

    // Taux de progression théorique (prédit par le modèle)
    const tauTheo = progressionRate(testMax, predictedNext);

    // Éviter la division par zéro
    if (Math.abs(tauTheo) < 0.001) {
      // Si la prédiction est plate, utiliser le taux réel comme indicateur
      if (tauReel > 0.05) return 1.5;  // Progresse bien malgré prédiction plate
      if (tauReel < -0.05) return 0.7; // Régresse malgré prédiction plate
      return 1.0;
    }

    const factor = tauReel / tauTheo;

    return clamp(factor, ADJUST_FACTOR_BOUNDS.MIN, ADJUST_FACTOR_BOUNDS.MAX);
  }

  /**
   * Récupère le test max de l'avant-dernière semaine.
   *
   * @param {Array<Object>} history
   * @returns {number}
   * @private
   */
  _getPreviousTestMax(history) {
    if (history.length < 2) return 10;

    // Parcourir depuis l'avant-dernier
    for (let i = history.length - 2; i >= 0; i--) {
      if (typeof history[i].testMax === 'number' && history[i].testMax > 0) {
        return history[i].testMax;
      }
    }

    return 10;
  }


  /* ──────────────────────────────────────────────────────────
     TAUX D'ÉCHEC
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule le taux d'échec global (séances "impossible" / total).
   *
   * @param {Array<Object>} history
   * @returns {number} Ratio entre 0 et 1
   * @private
   */
  _calculateFailureRate(history) {
    if (!history || history.length === 0) return 0;

    let totalSessions = 0;
    let impossibleSessions = 0;

    history.forEach(week => {
      if (week.feedbackSummary) {
        const { facile = 0, parfait = 0, impossible = 0 } = week.feedbackSummary;
        totalSessions += facile + parfait + impossible;
        impossibleSessions += impossible;
      } else if (week.sessions && Array.isArray(week.sessions)) {
        week.sessions.forEach(session => {
          if (session.type !== 'test_max' && session.status === 'completed') {
            totalSessions++;
            if (session.feedback === 'impossible') {
              impossibleSessions++;
            }
          }
        });
      }
    });

    return totalSessions > 0 ? impossibleSessions / totalSessions : 0;
  }

  /**
   * Détermine la réduction de volume basée sur le taux d'échec.
   *
   * @param {number} failureRate
   * @returns {{threshold: number, multiplier: number, label: string}}
   * @private
   */
  _getFailureAdjustment(failureRate) {
    for (const adjustment of FAILURE_RATE_ADJUSTMENTS) {
      if (failureRate > adjustment.threshold) {
        return adjustment;
      }
    }

    // Fallback (le dernier seuil est 0, donc toujours atteint)
    return FAILURE_RATE_ADJUSTMENTS[FAILURE_RATE_ADJUSTMENTS.length - 1];
  }


  /* ──────────────────────────────────────────────────────────
     EXTRACTION DES POINTS ET SÉCURITÉ
     ────────────────────────────────────────────────────────── */

  /**
   * Extrait les points (weekNumber, testMax) de l'historique
   * pour la régression.
   *
   * @param {Array<Object>} history
   * @returns {Array<[number, number]>}
   * @private
   */
  _extractPoints(history) {
    const points = [];

    history.forEach(week => {
      if (typeof week.weekNumber === 'number' &&
          typeof week.testMax === 'number' &&
          week.testMax > 0) {
        points.push([week.weekNumber, week.testMax]);
      }
    });

    // Trier par numéro de semaine croissant
    points.sort((a, b) => a[0] - b[0]);

    return points;
  }

  /**
   * Protège la prédiction contre les valeurs absurdes.
   *
   * Un polynôme d'ordre 2 peut :
   * - Diverger vers +∞ ou -∞ si la courbure est forte
   * - Prédire un test max négatif
   * - Prédire un saut irréaliste (+50% en une semaine)
   *
   * Cette méthode borne la prédiction dans une plage raisonnable.
   *
   * @param {number} predicted — Valeur prédite par le polynôme
   * @param {number} lastMax — Dernier test max connu
   * @param {number} weekNumber — Semaine à prédire
   * @param {Array<[number, number]>} points — Points de données
   * @returns {number} Prédiction sécurisée
   * @private
   */
  _safeguardPrediction(predicted, lastMax, weekNumber, points) {
    // Borne inférieure : au minimum 50% du dernier test max
    const lowerBound = lastMax * 0.5;

    // Borne supérieure : au maximum +30% par semaine depuis le dernier point
    const lastWeek = points[points.length - 1][0];
    const weeksDelta = Math.max(1, weekNumber - lastWeek);
    const upperBound = lastMax * Math.pow(1.30, weeksDelta);

    return clamp(predicted, lowerBound, upperBound);
  }


  /* ──────────────────────────────────────────────────────────
     UTILITAIRES
     ────────────────────────────────────────────────────────── */

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
     MÉTHODES D'ANALYSE (pour l'affichage et le debug)
     ────────────────────────────────────────────────────────── */

  /**
   * Retourne le modèle de régression ajusté sur l'historique.
   *
   * @param {Array<Object>} history
   * @returns {{model: Object, points: Array, type: string}}
   */
  getModel(history) {
    const points = this._extractPoints(history);

    if (points.length === 0) {
      return {
        model: { a: 0, b: 0, c: 0, stdError: 0, type: 'none' },
        points: [],
        type: 'none'
      };
    }

    const model = fitPolynomial(points);

    return {
      model,
      points,
      type: model.type
    };
  }

  /**
   * Génère la courbe de prédiction sur un intervalle de semaines.
   * Utile pour le graphique dans l'historique.
   *
   * @param {Array<Object>} history
   * @param {number} fromWeek — Semaine de début
   * @param {number} toWeek — Semaine de fin
   * @returns {Array<{week: number, predicted: number, lower: number, upper: number}>}
   */
  getPredictionCurve(history, fromWeek, toWeek) {
    const points = this._extractPoints(history);

    if (points.length === 0) return [];

    const model = fitPolynomial(points);
    const ci = confidenceInterval95(model);
    const lastMax = points[points.length - 1][1];
    const curve = [];

    for (let week = fromWeek; week <= toWeek; week++) {
      const raw = evaluatePolynomial(model, week);
      const predicted = this._safeguardPrediction(raw, lastMax, week, points);

      curve.push({
        week,
        predicted: round(predicted, 1),
        lower: round(Math.max(1, predicted - ci), 1),
        upper: round(predicted + ci, 1)
      });
    }

    return curve;
  }

  /**
   * Analyse la qualité du modèle de régression.
   *
   * @param {Array<Object>} history
   * @returns {{quality: string, stdError: number, pointCount: number, confidence: number, equation: string}}
   */
  analyzeModelQuality(history) {
    const points = this._extractPoints(history);

    if (points.length < 2) {
      return {
        quality: 'insufficient',
        stdError: 0,
        pointCount: points.length,
        confidence: 0,
        equation: 'Pas assez de données'
      };
    }

    const model = fitPolynomial(points);
    const ci = confidenceInterval95(model);

    // Dernière valeur connue pour évaluer la précision relative
    const lastMax = points[points.length - 1][1];
    const relativeError = lastMax > 0 ? model.stdError / lastMax : 1;

    // Score de confiance (0-100)
    let confidence = 100 - relativeError * 200;
    confidence = clamp(round(confidence), 0, 100);

    // Qualité
    let quality;
    if (points.length < MIN_POINTS_POLYNOMIAL) {
      quality = 'linear_only';
    } else if (relativeError < 0.05) {
      quality = 'excellent';
    } else if (relativeError < 0.10) {
      quality = 'good';
    } else if (relativeError < 0.20) {
      quality = 'fair';
    } else {
      quality = 'poor';
    }

    // Équation lisible
    const equation = this._formatEquation(model);

    return {
      quality,
      stdError: round(model.stdError, 2),
      pointCount: points.length,
      confidence,
      equation
    };
  }

  /**
   * Analyse le facteur d'ajustement et son interprétation.
   *
   * @param {number} testMax
   * @param {Array<Object>} history
   * @returns {{factor: number, interpretation: string, failureRate: number, failureLabel: string}}
   */
  analyzeAdjustment(testMax, history) {
    const predictedNext = this.predictTestMax(
      (history[history.length - 1]?.weekNumber || 1) + 1,
      history
    );

    const factor = this._calculateAdjustFactor(testMax, predictedNext, history);
    const failureRate = this._calculateFailureRate(history);
    const failureAdj = this._getFailureAdjustment(failureRate);

    let interpretation;
    if (factor > 1.3) {
      interpretation = 'Progression plus rapide que prévu. Volume augmenté.';
    } else if (factor > 0.9) {
      interpretation = 'Progression conforme aux prédictions.';
    } else if (factor > 0.6) {
      interpretation = 'Progression plus lente que prévu. Volume réduit.';
    } else {
      interpretation = 'Régression détectée. Volume fortement réduit.';
    }

    return {
      factor: round(factor, 2),
      interpretation,
      failureRate: round(failureRate * 100, 1),
      failureLabel: failureAdj.label
    };
  }

  /**
   * Formate l'équation du modèle en chaîne lisible.
   *
   * @param {Object} model — { a, b, c, type }
   * @returns {string} Ex: "y = 0.5x² + 3.2x + 8.0"
   * @private
   */
  _formatEquation(model) {
    if (model.type === 'linear') {
      const b = round(model.b, 2);
      const c = round(model.c, 1);
      const sign = c >= 0 ? '+' : '';
      return `y = ${b}x ${sign}${c}`;
    }

    const a = round(model.a, 3);
    const b = round(model.b, 2);
    const c = round(model.c, 1);
    const signB = b >= 0 ? '+' : '';
    const signC = c >= 0 ? '+' : '';

    return `y = ${a}x² ${signB}${b}x ${signC}${c}`;
  }

  /**
   * Calcule le volume total prédit pour la semaine.
   *
   * @param {number} weekNumber
   * @param {number} testMax
   * @param {Array<Object>} history
   * @returns {number}
   */
  getPredictedWeeklyVolume(weekNumber, testMax, history) {
    const predictedNext = this.predictTestMax(weekNumber + 1, history);
    const adjustFactor = this._calculateAdjustFactor(testMax, predictedNext, history);
    const failureRate = this._calculateFailureRate(history);
    const failureAdj = this._getFailureAdjustment(failureRate);

    return round(predictedNext * BASE_VOLUME_MULTIPLIER * adjustFactor * failureAdj.multiplier);
  }
}


// ── Export ──

export { RegressionAlgorithm, FAILURE_RATE_ADJUSTMENTS, ADJUST_FACTOR_BOUNDS };
export default RegressionAlgorithm;