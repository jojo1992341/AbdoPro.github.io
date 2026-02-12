/* ════════════════════════════════════════════════════════════════
   AbdoPro — algorithms/engine.js

   Responsabilité unique : orchestration du moteur algorithmique.
   ─────────────────────────────────────────────────────────────
   Point d'entrée unique pour toute interaction avec les
   algorithmes de progression. Aucun autre module ne devrait
   instancier ou appeler directement les algorithmes individuels.

   Responsabilités :
   1. Instancier et enregistrer les 5 algorithmes
   2. Déterminer les algorithmes éligibles par semaine
   3. Collecter les prédictions de chaque algorithme
   4. Déclencher le scoring comparatif
   5. Sélectionner le meilleur algorithme
   6. Générer le plan hebdomadaire
   7. Appliquer la règle "Impossible"
   8. Appliquer les bornes de sécurité
   9. Gérer le mode grand débutant

   ─────────────────────────────────────────────────────────────
   API publique :

     engine.initialize()
     engine.selectBestAlgorithm(weekNumber, testMax, weekHistory, scoringHistory)
     engine.generateWeekPlan(algoName, weekNumber, testMax, history, hasImpossible)
     engine.getAllPredictions(weekNumber, history)
     engine.getAlgorithm(name)
     engine.getEligibleAlgorithms(weekNumber)
     engine.getAlgorithmInfo(name)
     engine.getAllAlgorithmsInfo()
   ════════════════════════════════════════════════════════════════ */

import { LinearAlgorithm }     from './linear.js';
import { BanisterAlgorithm }   from './banister.js';
import { DUPAlgorithm }        from './dup.js';
import { RIRAlgorithm }        from './rir.js';
import { RegressionAlgorithm } from './regression.js';
import { AlgorithmScorer }     from './scoring.js';
import { clamp, round }        from '../utils/math.js';


// ── Constantes ──

/**
 * Stratégie d'éligibilité par semaine.
 *
 * Semaine 1 : Linéaire uniquement (pas de données)
 * Semaine 2 : Linéaire + RIR (1 feedback disponible)
 * Semaine 3 : Linéaire + DUP + RIR (patterns suffisants)
 * Semaine 4+: Tous les 5 (régression et Banister ont assez de données)
 */
const ELIGIBILITY_MAP = [
  { maxWeek: 1,  algorithms: ['linear'] },
  { maxWeek: 2,  algorithms: ['linear', 'rir'] },
  { maxWeek: 3,  algorithms: ['linear', 'dup', 'rir'] },
  { maxWeek: Infinity, algorithms: ['linear', 'banister', 'dup', 'rir', 'regression'] }
];

Object.freeze(ELIGIBILITY_MAP);

/**
 * Bornes de sécurité pour le plan d'entraînement.
 *
 * Appliquées APRÈS la génération du plan par l'algorithme
 * et APRÈS la règle Impossible.
 */
const SAFETY_BOUNDS = {
  REPS_MIN: 3,
  REPS_MAX_RATIO: 1.2,   // testMax × 1.2
  SERIES_MIN: 2,
  SERIES_MAX: 10,
  REST_MIN: 20,           // secondes
  REST_MAX: 180            // secondes
};

Object.freeze(SAFETY_BOUNDS);

/**
 * Règle "Impossible" : ajustement quand une séance a été
 * marquée impossible dans la semaine précédente.
 *
 * Séries × 2, Reps ÷ 2 → Volume similaire, difficulté par série réduite.
 * Repos légèrement réduit car les séries sont plus courtes.
 */
const IMPOSSIBLE_RULE = {
  SERIES_MULTIPLIER: 2,
  REPS_DIVISOR: 2,
  REST_REDUCTION: 15      // secondes en moins
};

Object.freeze(IMPOSSIBLE_RULE);

/** Seuil de test max pour le mode grand débutant */
const BEGINNER_THRESHOLD = 5;

/** Plan fixe pour les grands débutants */
const BEGINNER_PLAN = {
  series: 5,
  reps: 3,
  rest: 90,
  type: 'DEBUTANT'
};

Object.freeze(BEGINNER_PLAN);


// ── Classe AlgorithmEngine ──

class AlgorithmEngine {

  constructor() {
    /** @type {Map<string, Object>} Algorithmes enregistrés */
    this._algorithms = new Map();

    /** @type {AlgorithmScorer} Système de scoring */
    this._scorer = new AlgorithmScorer();

    /** @type {boolean} Initialisé */
    this._initialized = false;
  }


  /* ──────────────────────────────────────────────────────────
     INITIALISATION
     ────────────────────────────────────────────────────────── */

  /**
   * Initialise le moteur en instanciant et enregistrant
   * tous les algorithmes.
   */
  initialize() {
    if (this._initialized) return;

    // Instancier les 5 algorithmes
    const algorithms = [
      new LinearAlgorithm(),
      new BanisterAlgorithm(),
      new DUPAlgorithm(),
      new RIRAlgorithm(),
      new RegressionAlgorithm()
    ];

    // Enregistrer et valider chacun
    algorithms.forEach(algo => {
      this._validateAlgorithm(algo);
      this._algorithms.set(algo.getName(), algo);
    });

    this._initialized = true;
  }

  /**
   * Vérifie qu'un algorithme respecte le contrat d'interface.
   *
   * @param {Object} algo
   * @throws {Error} Si le contrat n'est pas respecté
   * @private
   */
  _validateAlgorithm(algo) {
    const required = ['getName', 'getLabel', 'getDescription', 'predictTestMax', 'generatePlan'];

    for (const method of required) {
      if (typeof algo[method] !== 'function') {
        throw new Error(
          `Algorithme invalide : méthode "${method}" manquante ` +
          `sur ${algo.constructor?.name || 'inconnu'}.`
        );
      }
    }

    const name = algo.getName();
    if (!name || typeof name !== 'string') {
      throw new Error('Algorithme invalide : getName() doit retourner une chaîne non vide.');
    }
  }

  /**
   * Vérifie que le moteur est initialisé.
   * @private
   */
  _ensureInitialized() {
    if (!this._initialized) {
      this.initialize();
    }
  }


  /* ──────────────────────────────────────────────────────────
     ÉLIGIBILITÉ
     ────────────────────────────────────────────────────────── */

  /**
   * Retourne la liste des algorithmes éligibles pour une semaine.
   *
   * @param {number} weekNumber
   * @returns {string[]} Noms des algorithmes éligibles
   */
  getEligibleAlgorithms(weekNumber) {
    for (const entry of ELIGIBILITY_MAP) {
      if (weekNumber <= entry.maxWeek) {
        return [...entry.algorithms];
      }
    }

    // Fallback : tous les algorithmes
    return ELIGIBILITY_MAP[ELIGIBILITY_MAP.length - 1].algorithms;
  }


  /* ──────────────────────────────────────────────────────────
     PRÉDICTIONS
     ────────────────────────────────────────────────────────── */

  /**
   * Collecte les prédictions de test max de tous les
   * algorithmes éligibles.
   *
   * @param {number} weekNumber — Semaine à prédire
   * @param {Array<Object>} history — Historique des semaines
   * @returns {Object} { algoName: predictedTestMax, ... }
   */
  getAllPredictions(weekNumber, history) {
    this._ensureInitialized();

    const eligible = this.getEligibleAlgorithms(weekNumber);
    const predictions = {};

    for (const name of eligible) {
      const algo = this._algorithms.get(name);
      if (!algo) continue;

      try {
        const predicted = algo.predictTestMax(weekNumber, history);
        predictions[name] = Math.max(1, round(predicted));
      } catch (error) {
        console.error(`Erreur de prédiction pour "${name}" :`, error);
        predictions[name] = null;
      }
    }

    return predictions;
  }


  /* ──────────────────────────────────────────────────────────
     SÉLECTION DU MEILLEUR ALGORITHME
     
     Processus complet :
     1. Déterminer les algorithmes éligibles
     2. Collecter les prédictions
     3. Calculer les scores de chaque algorithme
     4. Sélectionner le meilleur
     ────────────────────────────────────────────────────────── */

  /**
   * Sélectionne le meilleur algorithme pour la semaine courante.
   *
   * @param {number} weekNumber — Numéro de la semaine courante
   * @param {number} testMax — Test max réel de cette semaine
   * @param {Array<Object>} weekHistory — Historique des semaines
   * @param {Array<Object>} scoringHistory — Historique de scoring
   * @returns {{
   *   algorithm: string,
   *   scores: Object,
   *   predictions: Object,
   *   reason: string,
   *   reliability: Object
   * }}
   */
  selectBestAlgorithm(weekNumber, testMax, weekHistory, scoringHistory) {
    this._ensureInitialized();

    // Semaine 1 : pas de données, linéaire par défaut
    if (weekNumber <= 1 || !weekHistory || weekHistory.length === 0) {
      return {
        algorithm: 'linear',
        scores: null,
        predictions: null,
        reason: 'Première semaine — algorithme linéaire par défaut.',
        reliability: { reliable: false, reason: 'Première semaine.', dataPoints: 0 }
      };
    }

    // 1. Algorithmes éligibles
    const eligible = this.getEligibleAlgorithms(weekNumber);

    // 2. Prédictions
    const predictions = this.getAllPredictions(weekNumber, weekHistory);

    // 3. Scoring
    const scores = this._scorer.scoreAllAlgorithms(
      weekHistory,
      scoringHistory || [],
      predictions,
      testMax,
      eligible
    );

    // 4. Sélection
    const best = this._scorer.selectBestAlgorithm(scores);

    // 5. Fiabilité
    const reliability = this._scorer.assessReliability(
      scoringHistory || [],
      eligible
    );

    return {
      algorithm: best.name,
      scores,
      predictions,
      reason: best.reason,
      reliability
    };
  }


  /* ──────────────────────────────────────────────────────────
     GÉNÉRATION DU PLAN HEBDOMADAIRE
     
     Pipeline :
     1. Vérifier le mode grand débutant
     2. Générer le plan via l'algorithme sélectionné
     3. Appliquer la règle "Impossible" si nécessaire
     4. Appliquer les bornes de sécurité
     ────────────────────────────────────────────────────────── */

  /**
   * Génère le plan d'entraînement complet J2-J7.
   *
   * @param {string} algorithmName — Nom de l'algorithme à utiliser
   * @param {number} weekNumber — Numéro de la semaine
   * @param {number} testMax — Test max de cette semaine
   * @param {Array<Object>} history — Historique des semaines
   * @param {boolean} hasImpossible — Au moins 1 séance impossible la semaine précédente
   * @returns {Object} Plan { day2: {series, reps, rest, type}, ..., day7: {...} }
   */
  generateWeekPlan(algorithmName, weekNumber, testMax, history, hasImpossible) {
    this._ensureInitialized();

    // 1. Mode grand débutant
    if (testMax < BEGINNER_THRESHOLD) {
      return this._generateBeginnerPlan();
    }

    // 2. Générer le plan via l'algorithme
    let plan = this._generateRawPlan(algorithmName, weekNumber, testMax, history);

    // 3. Appliquer la règle Impossible
    if (hasImpossible) {
      plan = this._applyImpossibleRule(plan);
    }

    // 4. Appliquer les bornes de sécurité
    plan = this._applySafetyBounds(plan, testMax);

    return plan;
  }

  /**
   * Génère le plan brut via l'algorithme sélectionné.
   *
   * @param {string} algorithmName
   * @param {number} weekNumber
   * @param {number} testMax
   * @param {Array<Object>} history
   * @returns {Object}
   * @private
   */
  _generateRawPlan(algorithmName, weekNumber, testMax, history) {
    const algo = this._algorithms.get(algorithmName);

    if (!algo) {
      console.warn(
        `Algorithme "${algorithmName}" inconnu. Fallback vers "linear".`
      );
      return this._algorithms.get('linear').generatePlan(weekNumber, testMax, history);
    }

    try {
      return algo.generatePlan(weekNumber, testMax, history);
    } catch (error) {
      console.error(
        `Erreur de génération pour "${algorithmName}" :`, error,
        'Fallback vers "linear".'
      );
      return this._algorithms.get('linear').generatePlan(weekNumber, testMax, history);
    }
  }


  /* ──────────────────────────────────────────────────────────
     RÈGLE IMPOSSIBLE
     
     SI au_moins_une_séance_impossible(semaine_précédente) :
       séries = séries × 2
       reps = arrondi_sup(reps ÷ 2)
       repos = max(30, repos - 15)
     
     Le volume total reste similaire mais la difficulté
     par série diminue fortement.
     ────────────────────────────────────────────────────────── */

  /**
   * Applique la règle Impossible à un plan.
   *
   * @param {Object} plan — Plan brut { day2: {...}, ..., day7: {...} }
   * @returns {Object} Plan ajusté
   * @private
   */
  _applyImpossibleRule(plan) {
    const adjusted = {};

    for (const [dayKey, dayPlan] of Object.entries(plan)) {
      adjusted[dayKey] = {
        ...dayPlan,
        series: dayPlan.series * IMPOSSIBLE_RULE.SERIES_MULTIPLIER,
        reps: Math.ceil(dayPlan.reps / IMPOSSIBLE_RULE.REPS_DIVISOR),
        rest: Math.max(30, dayPlan.rest - IMPOSSIBLE_RULE.REST_REDUCTION)
      };
    }

    return adjusted;
  }


  /* ──────────────────────────────────────────────────────────
     BORNES DE SÉCURITÉ
     
     Empêchent les valeurs absurdes quelle que soit la sortie
     de l'algorithme.
     
     - reps : [3, testMax × 1.2]
     - séries : [2, 10]
     - repos : [20s, 180s]
     ────────────────────────────────────────────────────────── */

  /**
   * Applique les bornes de sécurité à un plan.
   *
   * @param {Object} plan — Plan (peut être post-Impossible)
   * @param {number} testMax
   * @returns {Object} Plan borné
   * @private
   */
  _applySafetyBounds(plan, testMax) {
    const maxReps = Math.ceil(testMax * SAFETY_BOUNDS.REPS_MAX_RATIO);
    const bounded = {};

    for (const [dayKey, dayPlan] of Object.entries(plan)) {
      bounded[dayKey] = {
        ...dayPlan,
        reps: clamp(dayPlan.reps, SAFETY_BOUNDS.REPS_MIN, maxReps),
        series: clamp(dayPlan.series, SAFETY_BOUNDS.SERIES_MIN, SAFETY_BOUNDS.SERIES_MAX),
        rest: clamp(round(dayPlan.rest), SAFETY_BOUNDS.REST_MIN, SAFETY_BOUNDS.REST_MAX)
      };
    }

    return bounded;
  }


  /* ──────────────────────────────────────────────────────────
     MODE GRAND DÉBUTANT
     ────────────────────────────────────────────────────────── */

  /**
   * Génère le plan fixe pour les grands débutants.
   *
   * @returns {Object}
   * @private
   */
  _generateBeginnerPlan() {
    const plan = {};

    for (let d = 2; d <= 7; d++) {
      plan[`day${d}`] = { ...BEGINNER_PLAN };
    }

    return plan;
  }


  /* ──────────────────────────────────────────────────────────
     PROCESSUS COMPLET DE DÉBUT DE SEMAINE
     
     Orchestre toute la logique de transition entre semaines :
     1. Collecter les prédictions
     2. Sélectionner le meilleur algorithme
     3. Générer le plan
     4. Retourner le tout en un seul objet
     ────────────────────────────────────────────────────────── */

  /**
   * Processus complet appelé après la saisie du test max.
   *
   * C'est le point d'entrée principal utilisé par test-max.js.
   * Il encapsule toute la logique de début de semaine.
   *
   * @param {number} weekNumber — Numéro de la semaine qui commence
   * @param {number} testMax — Test max venant d'être saisi
   * @param {Array<Object>} weekHistory — Historique complet des semaines
   * @param {Array<Object>} scoringHistory — Historique de scoring
   * @param {boolean} hasImpossibleLastWeek — Séance impossible la semaine précédente
   * @returns {{
   *   algorithm: string,
   *   algorithmLabel: string,
   *   scores: Object,
   *   predictions: Object,
   *   plan: Object,
   *   reason: string,
   *   reliability: Object,
   *   isBeginnerMode: boolean
   * }}
   */
  processNewWeek(weekNumber, testMax, weekHistory, scoringHistory, hasImpossibleLastWeek) {
    this._ensureInitialized();

    // Mode grand débutant
    if (testMax < BEGINNER_THRESHOLD) {
      const plan = this._generateBeginnerPlan();
      return {
        algorithm: 'linear',
        algorithmLabel: this._algorithms.get('linear').getLabel(),
        scores: null,
        predictions: null,
        plan,
        reason: 'Mode grand débutant activé (test max < 5 reps). Plan fixe.',
        reliability: { reliable: false, reason: 'Mode débutant.', dataPoints: 0 },
        isBeginnerMode: true
      };
    }

    // 1. Sélection de l'algorithme
    const selection = this.selectBestAlgorithm(
      weekNumber,
      testMax,
      weekHistory,
      scoringHistory
    );

    // 2. Génération du plan
    const plan = this.generateWeekPlan(
      selection.algorithm,
      weekNumber,
      testMax,
      weekHistory,
      hasImpossibleLastWeek
    );

    // 3. Récupérer le label de l'algorithme
    const algo = this._algorithms.get(selection.algorithm);
    const algorithmLabel = algo ? algo.getLabel() : selection.algorithm;

    return {
      algorithm: selection.algorithm,
      algorithmLabel,
      scores: selection.scores,
      predictions: selection.predictions,
      plan,
      reason: selection.reason,
      reliability: selection.reliability,
      isBeginnerMode: false
    };
  }


  /* ──────────────────────────────────────────────────────────
     ACCÈS AUX ALGORITHMES
     ────────────────────────────────────────────────────────── */

  /**
   * Retourne une instance d'algorithme par son nom.
   *
   * @param {string} name
   * @returns {Object|null}
   */
  getAlgorithm(name) {
    this._ensureInitialized();
    return this._algorithms.get(name) || null;
  }

  /**
   * Retourne les informations d'un algorithme.
   *
   * @param {string} name
   * @returns {{name: string, label: string, description: string}|null}
   */
  getAlgorithmInfo(name) {
    this._ensureInitialized();
    const algo = this._algorithms.get(name);

    if (!algo) return null;

    return {
      name: algo.getName(),
      label: algo.getLabel(),
      description: algo.getDescription()
    };
  }

  /**
   * Retourne les informations de tous les algorithmes.
   *
   * @returns {Array<{name: string, label: string, description: string}>}
   */
  getAllAlgorithmsInfo() {
    this._ensureInitialized();

    const infos = [];
    for (const algo of this._algorithms.values()) {
      infos.push({
        name: algo.getName(),
        label: algo.getLabel(),
        description: algo.getDescription()
      });
    }

    return infos;
  }

  /**
   * Retourne le scorer (pour les analyses dans history.js).
   *
   * @returns {AlgorithmScorer}
   */
  getScorer() {
    return this._scorer;
  }

  /**
   * Retourne les bornes de sécurité (pour l'affichage).
   *
   * @returns {Object}
   */
  getSafetyBounds() {
    return { ...SAFETY_BOUNDS };
  }

  /**
   * Retourne les paramètres de la règle Impossible (pour l'affichage).
   *
   * @returns {Object}
   */
  getImpossibleRule() {
    return { ...IMPOSSIBLE_RULE };
  }


  /* ──────────────────────────────────────────────────────────
     ANALYSE & DIAGNOSTIC
     ────────────────────────────────────────────────────────── */

  /**
   * Simule le scoring pour toutes les semaines de l'historique.
   * Utile pour le graphique d'évolution des scores.
   *
   * @param {Array<Object>} weekHistory
   * @param {Array<Object>} scoringHistory
   * @returns {Array<{week: number, scores: Object, selected: string}>}
   */
  simulateHistoricalScoring(weekHistory, scoringHistory) {
    this._ensureInitialized();

    if (!weekHistory || weekHistory.length < 2) return [];

    const results = [];

    for (let i = 1; i < weekHistory.length; i++) {
      const week = weekHistory[i];
      const previousHistory = weekHistory.slice(0, i);
      const previousScoring = (scoringHistory || []).filter(
        s => s.weekNumber < week.weekNumber
      );

      const eligible = this.getEligibleAlgorithms(week.weekNumber);
      const predictions = this.getAllPredictions(week.weekNumber, previousHistory);

      const scores = this._scorer.scoreAllAlgorithms(
        previousHistory,
        previousScoring,
        predictions,
        week.testMax,
        eligible
      );

      const best = this._scorer.selectBestAlgorithm(scores);

      results.push({
        week: week.weekNumber,
        scores,
        predictions,
        selected: best.name,
        actual: week.testMax
      });
    }

    return results;
  }

  /**
   * Calcule les métriques de performance globale du moteur.
   *
   * @param {Array<Object>} weekHistory
   * @param {Array<Object>} scoringHistory
   * @returns {{
   *   averagePrecision: number,
   *   algorithmChanges: number,
   *   dominantAlgorithm: string,
   *   failureRate: number
   * }}
   */
  getEngineMetrics(weekHistory, scoringHistory) {
    this._ensureInitialized();

    if (!weekHistory || weekHistory.length < 2) {
      return {
        averagePrecision: 0,
        algorithmChanges: 0,
        dominantAlgorithm: 'linear',
        failureRate: 0
      };
    }

    // Compter les changements d'algorithme
    let changes = 0;
    const algoCounts = {};

    for (let i = 1; i < weekHistory.length; i++) {
      const current = weekHistory[i].selectedAlgorithm;
      const previous = weekHistory[i - 1].selectedAlgorithm;

      if (current && previous && current !== previous) {
        changes++;
      }

      if (current) {
        algoCounts[current] = (algoCounts[current] || 0) + 1;
      }
    }

    // Algorithme dominant
    const dominant = Object.entries(algoCounts)
      .sort(([, a], [, b]) => b - a)[0];

    // Précision moyenne
    let totalPrecision = 0;
    let precisionCount = 0;

    if (scoringHistory) {
      scoringHistory.forEach(entry => {
        if (entry.selectedAlgorithm && entry.calculations) {
          const calc = entry.calculations[entry.selectedAlgorithm];
          if (calc && typeof calc.scorePrecision === 'number') {
            totalPrecision += calc.scorePrecision;
            precisionCount++;
          }
        }
      });
    }

    // Taux d'échec global
    let totalSessions = 0;
    let impossibleSessions = 0;

    weekHistory.forEach(week => {
      if (week.feedbackSummary) {
        const fb = week.feedbackSummary;
        totalSessions += (fb.facile || 0) + (fb.parfait || 0) + (fb.impossible || 0);
        impossibleSessions += fb.impossible || 0;
      }
    });

    return {
      averagePrecision: precisionCount > 0 ? round(totalPrecision / precisionCount, 1) : 0,
      algorithmChanges: changes,
      dominantAlgorithm: dominant ? dominant[0] : 'linear',
      failureRate: totalSessions > 0 ? round(impossibleSessions / totalSessions * 100, 1) : 0
    };
  }
}


// ── Export singleton ──

const engine = new AlgorithmEngine();

export { engine, AlgorithmEngine, SAFETY_BOUNDS, IMPOSSIBLE_RULE, ELIGIBILITY_MAP };
export default engine;