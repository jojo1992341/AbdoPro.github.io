/* ════════════════════════════════════════════════════════════════
   AbdoPro — algorithms/scoring.js

   Responsabilité unique : scoring comparatif des algorithmes.
   ─────────────────────────────────────────────────────────────
   Évalue et compare les 5 algorithmes de progression en
   calculant un score composite pour chacun.

   Le score composite combine trois dimensions :
   1. Précision (50%) — Écart entre prédiction et test max réel
   2. Feedback (30%) — Qualité des feedbacks sous cet algorithme
   3. Tendance (20%) — Direction de la progression globale

   Chaque dimension produit un score de 0 à 100.
   La pondération temporelle fait que les semaines récentes
   comptent plus que les anciennes.

   ─────────────────────────────────────────────────────────────
   API publique :

     scorer.calculatePrecisionScore(history, algoName, actualTestMax) → number
     scorer.calculateFeedbackScore(history, algoName)                → number
     scorer.calculateTrendScore(history)                             → number
     scorer.calculateCompositeScore(precision, feedback, trend)      → number
     scorer.scoreAllAlgorithms(history, predictions, actualTestMax)  → Object
     scorer.selectBestAlgorithm(scores)                              → {name, score, reason}
   ════════════════════════════════════════════════════════════════ */

import {
  clamp,
  round,
  mean,
  exponentialWeight,
  progressionRate,
  detectTrend
} from '../utils/math.js';


// ── Constantes ──

/**
 * Pondération des dimensions du score composite.
 *
 * Précision = 50% → La capacité à prédire le test max est primordiale
 * Feedback  = 30% → Un bon algorithme génère des séances "parfaites"
 * Tendance  = 20% → La direction globale de progression compte
 */
const SCORE_WEIGHTS = {
  PRECISION: 0.50,
  FEEDBACK:  0.30,
  TREND:     0.20
};

Object.freeze(SCORE_WEIGHTS);

/** Score neutre attribué quand il n'y a pas assez de données */
const NEUTRAL_SCORE = 50;

/**
 * Facteur de pénalité pour l'erreur relative dans le score de précision.
 *
 * Score = max(0, 100 - erreur_relative × PENALTY_FACTOR)
 * Avec 200 : une erreur de 50% donne un score de 0
 */
const PRECISION_PENALTY_FACTOR = 200;

/**
 * Facteur de décroissance temporelle.
 *
 * poids(k) = DECAY^(semaine_courante - k)
 * 0.9 → la semaine précédente vaut 90% de la semaine courante
 */
const TEMPORAL_DECAY = 0.9;

/**
 * Pénalité par feedback "impossible" dans le score feedback.
 *
 * Un "impossible" pèse 1.5× plus qu'un "parfait" en négatif.
 */
const IMPOSSIBLE_PENALTY = 150;

/**
 * Bonus par feedback "parfait" dans le score feedback.
 */
const PARFAIT_BONUS = 100;

/**
 * Seuil de variation (%) sous lequel la tendance est "stagnante".
 */
const STAGNATION_THRESHOLD = 0.05;

/**
 * Nombre minimum de semaines avec des données pour que le
 * score de tendance soit significatif.
 */
const MIN_TREND_WEEKS = 2;

/**
 * Nombre de semaines récentes à considérer pour le score de tendance.
 */
const TREND_WINDOW = 3;


// ── Classe AlgorithmScorer ──

class AlgorithmScorer {

  /* ──────────────────────────────────────────────────────────
     1. SCORE DE PRÉCISION
     
     Mesure la capacité d'un algorithme à prédire le test max.
     
     Pour chaque semaine où l'algorithme a fait une prédiction :
       erreur_relative = |prédit - réel| / réel
       score = max(0, 100 - erreur_relative × 200)
     
     Les scores sont pondérés temporellement (semaines récentes
     comptent plus).
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule le score de précision d'un algorithme.
   *
   * @param {Array<Object>} scoringHistory — Historique de scoring
   *   Chaque entrée : { weekNumber, calculations: { algoName: { prediction, actual } } }
   * @param {string} algoName — Nom de l'algorithme à évaluer
   * @param {number} actualTestMax — Test max réel de la semaine courante
   * @returns {number} Score de 0 à 100
   */
  calculatePrecisionScore(scoringHistory, algoName, actualTestMax) {
    // Collecter toutes les prédictions passées de cet algorithme
    const predictions = this._collectPredictions(scoringHistory, algoName);

    // Ajouter la prédiction courante si disponible
    if (actualTestMax > 0) {
      const currentWeek = this._getCurrentWeekFromHistory(scoringHistory);
      const currentPrediction = this._getCurrentPrediction(scoringHistory, algoName, currentWeek);

      if (currentPrediction !== null) {
        predictions.push({
          predicted: currentPrediction,
          actual: actualTestMax,
          week: currentWeek
        });
      }
    }

    // Pas de prédiction → score neutre
    if (predictions.length === 0) {
      return NEUTRAL_SCORE;
    }

    // Calculer le score pondéré
    const currentWeek = predictions[predictions.length - 1].week;
    let weightedScore = 0;
    let totalWeight = 0;

    predictions.forEach(prediction => {
      const score = this._singlePrecisionScore(prediction.predicted, prediction.actual);
      const weight = exponentialWeight(currentWeek, prediction.week, TEMPORAL_DECAY);

      weightedScore += score * weight;
      totalWeight += weight;
    });

    return totalWeight > 0
      ? clamp(round(weightedScore / totalWeight, 1), 0, 100)
      : NEUTRAL_SCORE;
  }

  /**
   * Calcule le score de précision pour une seule prédiction.
   *
   * @param {number} predicted — Valeur prédite
   * @param {number} actual — Valeur réelle
   * @returns {number} Score de 0 à 100
   * @private
   */
  _singlePrecisionScore(predicted, actual) {
    if (actual <= 0) return NEUTRAL_SCORE;

    const errorRelative = Math.abs(predicted - actual) / actual;
    const score = 100 - errorRelative * PRECISION_PENALTY_FACTOR;

    return clamp(round(score, 1), 0, 100);
  }

  /**
   * Collecte toutes les prédictions passées d'un algorithme.
   *
   * @param {Array<Object>} scoringHistory
   * @param {string} algoName
   * @returns {Array<{predicted: number, actual: number, week: number}>}
   * @private
   */
  _collectPredictions(scoringHistory, algoName) {
    if (!scoringHistory || !Array.isArray(scoringHistory)) return [];

    const predictions = [];

    scoringHistory.forEach(entry => {
      if (!entry.calculations || !entry.calculations[algoName]) return;

      const calc = entry.calculations[algoName];
      const actual = entry.actual || calc.actual;

      if (typeof calc.prediction === 'number' && typeof actual === 'number' && actual > 0) {
        predictions.push({
          predicted: calc.prediction,
          actual,
          week: entry.weekNumber
        });
      }
    });

    return predictions;
  }

  /**
   * Récupère le numéro de semaine le plus élevé dans l'historique de scoring.
   *
   * @param {Array<Object>} scoringHistory
   * @returns {number}
   * @private
   */
  _getCurrentWeekFromHistory(scoringHistory) {
    if (!scoringHistory || scoringHistory.length === 0) return 1;

    let maxWeek = 1;
    scoringHistory.forEach(entry => {
      if (entry.weekNumber > maxWeek) maxWeek = entry.weekNumber;
    });

    return maxWeek;
  }

  /**
   * Récupère la prédiction courante d'un algorithme.
   *
   * @param {Array<Object>} scoringHistory
   * @param {string} algoName
   * @param {number} currentWeek
   * @returns {number|null}
   * @private
   */
  _getCurrentPrediction(scoringHistory, algoName, currentWeek) {
    if (!scoringHistory) return null;

    const currentEntry = scoringHistory.find(e => e.weekNumber === currentWeek);
    if (!currentEntry) return null;

    // Chercher dans les prédictions
    if (currentEntry.predictions && typeof currentEntry.predictions[algoName] === 'number') {
      return currentEntry.predictions[algoName];
    }

    // Chercher dans les calculations
    if (currentEntry.calculations &&
        currentEntry.calculations[algoName] &&
        typeof currentEntry.calculations[algoName].prediction === 'number') {
      return currentEntry.calculations[algoName].prediction;
    }

    return null;
  }


  /* ──────────────────────────────────────────────────────────
     2. SCORE DE FEEDBACK
     
     Mesure la qualité des feedbacks quand cet algorithme
     était actif.
     
     score = taux_parfait × 100 - taux_impossible × 150
     
     Un algorithme qui génère beaucoup de "parfait" et peu
     d'"impossible" est bien calibré.
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule le score de feedback d'un algorithme.
   *
   * @param {Array<Object>} history — Historique des semaines
   *   Chaque entrée : { selectedAlgorithm, feedbackSummary: { facile, parfait, impossible } }
   * @param {string} algoName — Nom de l'algorithme à évaluer
   * @returns {number} Score de 0 à 100
   */
  calculateFeedbackScore(history, algoName) {
    if (!history || !Array.isArray(history)) return NEUTRAL_SCORE;

    // Filtrer les semaines où cet algorithme était actif
    const relevantWeeks = history.filter(
      week => week.selectedAlgorithm === algoName
    );

    // Pas de semaine avec cet algorithme → score neutre
    if (relevantWeeks.length === 0) {
      return NEUTRAL_SCORE;
    }

    let totalScore = 0;
    let weekCount = 0;

    relevantWeeks.forEach(week => {
      const score = this._singleFeedbackScore(week.feedbackSummary);
      if (score !== null) {
        totalScore += score;
        weekCount++;
      }
    });

    if (weekCount === 0) return NEUTRAL_SCORE;

    return clamp(round(totalScore / weekCount, 1), 0, 100);
  }

  /**
   * Calcule le score de feedback pour une seule semaine.
   *
   * @param {Object|null} feedbackSummary — { facile, parfait, impossible }
   * @returns {number|null} Score ou null si pas de données
   * @private
   */
  _singleFeedbackScore(feedbackSummary) {
    if (!feedbackSummary) return null;

    const { facile = 0, parfait = 0, impossible = 0 } = feedbackSummary;
    const total = facile + parfait + impossible;

    if (total === 0) return null;

    const tauxParfait = parfait / total;
    const tauxImpossible = impossible / total;

    const score = tauxParfait * PARFAIT_BONUS - tauxImpossible * IMPOSSIBLE_PENALTY;

    return clamp(round(score, 1), 0, 100);
  }


  /* ──────────────────────────────────────────────────────────
     3. SCORE DE TENDANCE
     
     Mesure la direction de progression du test max
     sur les 3 dernières semaines.
     
     - Croissant  → 80 + bonus
     - Stagnant   → 40
     - Décroissant → 20 - malus
     
     Ce score est IDENTIQUE pour tous les algorithmes
     (c'est un indicateur global, pas spécifique à un algo).
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule le score de tendance basé sur l'historique des test max.
   *
   * @param {Array<Object>} history — Historique des semaines
   * @returns {number} Score de 0 à 100
   */
  calculateTrendScore(history) {
    if (!history || history.length < MIN_TREND_WEEKS) {
      return NEUTRAL_SCORE;
    }

    // Extraire les test max récents
    const recentMaxes = this._extractRecentTestMaxes(history, TREND_WINDOW);

    if (recentMaxes.length < MIN_TREND_WEEKS) {
      return NEUTRAL_SCORE;
    }

    const trend = detectTrend(recentMaxes);

    switch (trend) {
      case 'increasing':
        return this._scoreTrendIncreasing(recentMaxes);

      case 'stagnant':
        return 40;

      case 'decreasing':
        return this._scoreTrendDecreasing(recentMaxes);

      default:
        return NEUTRAL_SCORE;
    }
  }

  /**
   * Score pour une tendance croissante.
   *
   * Score = 80 + taux_croissance_moyen × 200
   * Borné à 100.
   *
   * @param {number[]} maxes
   * @returns {number}
   * @private
   */
  _scoreTrendIncreasing(maxes) {
    const first = maxes[0];
    const last = maxes[maxes.length - 1];

    if (first <= 0) return 80;

    const avgGrowth = (last - first) / first / maxes.length;
    const score = 80 + avgGrowth * 200;

    return clamp(round(score, 1), 80, 100);
  }

  /**
   * Score pour une tendance décroissante.
   *
   * Score = 20 - taux_régression × 100
   * Borné à 0.
   *
   * @param {number[]} maxes
   * @returns {number}
   * @private
   */
  _scoreTrendDecreasing(maxes) {
    const first = maxes[0];
    const last = maxes[maxes.length - 1];

    if (first <= 0) return 20;

    const avgDecline = (first - last) / first / maxes.length;
    const score = 20 - avgDecline * 100;

    return clamp(round(score, 1), 0, 20);
  }

  /**
   * Extrait les N derniers test max de l'historique.
   *
   * @param {Array<Object>} history
   * @param {number} count
   * @returns {number[]}
   * @private
   */
  _extractRecentTestMaxes(history, count) {
    const maxes = [];

    for (let i = history.length - 1; i >= 0 && maxes.length < count; i--) {
      if (typeof history[i].testMax === 'number' && history[i].testMax > 0) {
        maxes.unshift(history[i].testMax);
      }
    }

    return maxes;
  }


  /* ──────────────────────────────────────────────────────────
     4. SCORE COMPOSITE
     
     Combine les trois dimensions avec pondération.
     
     composite = 0.50 × précision
               + 0.30 × feedback
               + 0.20 × tendance
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule le score composite à partir des trois sous-scores.
   *
   * @param {number} precision — Score de précision (0-100)
   * @param {number} feedback — Score de feedback (0-100)
   * @param {number} trend — Score de tendance (0-100)
   * @returns {number} Score composite (0-100)
   */
  calculateCompositeScore(precision, feedback, trend) {
    const composite =
      SCORE_WEIGHTS.PRECISION * precision +
      SCORE_WEIGHTS.FEEDBACK  * feedback +
      SCORE_WEIGHTS.TREND     * trend;

    return clamp(round(composite, 1), 0, 100);
  }


  /* ──────────────────────────────────────────────────────────
     5. SCORING DE TOUS LES ALGORITHMES
     
     Calcule le score complet pour chaque algorithme éligible.
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule les scores de tous les algorithmes fournis.
   *
   * @param {Array<Object>} weekHistory — Historique des semaines
   * @param {Array<Object>} scoringHistory — Historique de scoring
   * @param {Object} predictions — { algoName: predictedTestMax, ... }
   * @param {number} actualTestMax — Test max réel de la semaine courante
   * @param {string[]} eligibleAlgorithms — Liste des algorithmes éligibles
   * @returns {Object} { algoName: { prediction, precision, feedback, trend, composite }, ... }
   */
  scoreAllAlgorithms(weekHistory, scoringHistory, predictions, actualTestMax, eligibleAlgorithms) {
    const scores = {};
    const trendScore = this.calculateTrendScore(weekHistory);

    for (const algoName of eligibleAlgorithms) {
      const prediction = predictions[algoName] ?? null;

      // Score de précision
      const precisionScore = this.calculatePrecisionScore(
        scoringHistory,
        algoName,
        actualTestMax
      );

      // Score de feedback
      const feedbackScore = this.calculateFeedbackScore(weekHistory, algoName);

      // Score composite
      const compositeScore = this.calculateCompositeScore(
        precisionScore,
        feedbackScore,
        trendScore
      );

      scores[algoName] = {
        prediction,
        scorePrecision: precisionScore,
        scoreFeedback: feedbackScore,
        scoreTendance: trendScore,
        composite: compositeScore
      };
    }

    return scores;
  }


  /* ──────────────────────────────────────────────────────────
     6. SÉLECTION DU MEILLEUR ALGORITHME
     ────────────────────────────────────────────────────────── */

  /**
   * Sélectionne l'algorithme avec le meilleur score composite.
   *
   * @param {Object} scores — Résultat de scoreAllAlgorithms()
   * @returns {{name: string, score: number, reason: string}}
   */
  selectBestAlgorithm(scores) {
    if (!scores || Object.keys(scores).length === 0) {
      return {
        name: 'linear',
        score: NEUTRAL_SCORE,
        reason: 'Aucun score disponible. Algorithme linéaire par défaut.'
      };
    }

    // Trier par score composite décroissant
    const sorted = Object.entries(scores)
      .sort(([, a], [, b]) => b.composite - a.composite);

    const [bestName, bestScores] = sorted[0];

    // Générer la raison
    const reason = this._generateReason(bestName, bestScores, sorted);

    return {
      name: bestName,
      score: bestScores.composite,
      reason
    };
  }

  /**
   * Génère une explication lisible de la sélection.
   *
   * @param {string} bestName — Nom du meilleur algorithme
   * @param {Object} bestScores — Scores du meilleur algorithme
   * @param {Array} sorted — Tous les algorithmes triés
   * @returns {string}
   * @private
   */
  _generateReason(bestName, bestScores, sorted) {
    const parts = [];

    // Score composite
    parts.push(`Score composite : ${bestScores.composite}/100`);

    // Meilleur critère
    const criteria = [
      { name: 'précision', score: bestScores.scorePrecision },
      { name: 'feedback', score: bestScores.scoreFeedback },
      { name: 'tendance', score: bestScores.scoreTendance }
    ];

    const bestCriterion = criteria.reduce((a, b) => a.score > b.score ? a : b);
    parts.push(`Meilleur en ${bestCriterion.name} (${bestCriterion.score}/100)`);

    // Écart avec le second
    if (sorted.length > 1) {
      const [, secondScores] = sorted[1];
      const gap = round(bestScores.composite - secondScores.composite, 1);

      if (gap > 10) {
        parts.push(`Avance nette (+${gap} pts)`);
      } else if (gap > 3) {
        parts.push(`Légère avance (+${gap} pts)`);
      } else {
        parts.push(`Avance serrée (+${gap} pts)`);
      }
    }

    // Prédiction si disponible
    if (bestScores.prediction !== null) {
      parts.push(`Prédiction : ${bestScores.prediction} reps`);
    }

    return parts.join('. ') + '.';
  }


  /* ──────────────────────────────────────────────────────────
     7. ANALYSE & DIAGNOSTICS
     ────────────────────────────────────────────────────────── */

  /**
   * Compare les scores de deux algorithmes.
   * Utile pour expliquer pourquoi un algorithme a été préféré.
   *
   * @param {Object} scores — Résultat de scoreAllAlgorithms()
   * @param {string} algo1
   * @param {string} algo2
   * @returns {{winner: string, gap: number, details: Object}}
   */
  compareAlgorithms(scores, algo1, algo2) {
    const s1 = scores[algo1];
    const s2 = scores[algo2];

    if (!s1 || !s2) {
      return {
        winner: s1 ? algo1 : algo2,
        gap: 0,
        details: { reason: 'Un des algorithmes n\'a pas de score.' }
      };
    }

    const winner = s1.composite >= s2.composite ? algo1 : algo2;
    const gap = round(Math.abs(s1.composite - s2.composite), 1);

    const details = {
      precisionGap: round(s1.scorePrecision - s2.scorePrecision, 1),
      feedbackGap: round(s1.scoreFeedback - s2.scoreFeedback, 1),
      trendGap: round(s1.scoreTendance - s2.scoreTendance, 1),
      reason: gap < 3
        ? 'Algorithmes très proches, le choix pourrait changer la semaine prochaine.'
        : gap < 10
          ? `${winner} a une avance modérée.`
          : `${winner} est nettement meilleur.`
    };

    return { winner, gap, details };
  }

  /**
   * Calcule un résumé statistique des scores de tous les algorithmes.
   *
   * @param {Object} scores — Résultat de scoreAllAlgorithms()
   * @returns {{best: string, worst: string, average: number, spread: number, ranking: Array}}
   */
  getScoringOverview(scores) {
    if (!scores || Object.keys(scores).length === 0) {
      return {
        best: null,
        worst: null,
        average: NEUTRAL_SCORE,
        spread: 0,
        ranking: []
      };
    }

    const entries = Object.entries(scores)
      .map(([name, s]) => ({ name, composite: s.composite }))
      .sort((a, b) => b.composite - a.composite);

    const composites = entries.map(e => e.composite);
    const avg = mean(composites);
    const spread = composites.length > 1
      ? composites[0] - composites[composites.length - 1]
      : 0;

    return {
      best: entries[0].name,
      worst: entries[entries.length - 1].name,
      average: round(avg, 1),
      spread: round(spread, 1),
      ranking: entries
    };
  }

  /**
   * Détermine si le scoring est fiable (assez de données).
   *
   * @param {Array<Object>} scoringHistory
   * @param {string[]} eligibleAlgorithms
   * @returns {{reliable: boolean, reason: string, dataPoints: number}}
   */
  assessReliability(scoringHistory, eligibleAlgorithms) {
    const dataPoints = scoringHistory ? scoringHistory.length : 0;

    if (dataPoints === 0) {
      return {
        reliable: false,
        reason: 'Aucune donnée de scoring. Première semaine.',
        dataPoints: 0
      };
    }

    if (dataPoints < 2) {
      return {
        reliable: false,
        reason: 'Seulement 1 semaine de données. Scoring peu fiable.',
        dataPoints
      };
    }

    if (eligibleAlgorithms.length < 3) {
      return {
        reliable: false,
        reason: `Seulement ${eligibleAlgorithms.length} algorithmes éligibles. Comparaison limitée.`,
        dataPoints
      };
    }

    if (dataPoints >= 4) {
      return {
        reliable: true,
        reason: 'Suffisamment de données pour un scoring fiable.',
        dataPoints
      };
    }

    return {
      reliable: false,
      reason: `${dataPoints} semaines de données. Scoring en amélioration.`,
      dataPoints
    };
  }

  /**
   * Retourne les pondérations utilisées (pour l'affichage).
   *
   * @returns {Object}
   */
  getWeights() {
    return { ...SCORE_WEIGHTS };
  }
}


// ── Export ──

export {
  AlgorithmScorer,
  SCORE_WEIGHTS,
  NEUTRAL_SCORE,
  TEMPORAL_DECAY,
  PRECISION_PENALTY_FACTOR
};
export default AlgorithmScorer;