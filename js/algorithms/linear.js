/* ════════════════════════════════════════════════════════════════
   AbdoPro — algorithms/linear.js

   ALGORITHME 1 — Progression Linéaire Périodisée (Prilepin adapté)
   ─────────────────────────────────────────────────────────────
   Source scientifique :
   Tables de Prilepin (A.S. Prilepin, 1974), issues de la
   recherche soviétique en haltérophilie. Adaptées au poids
   du corps : l'intensité est exprimée comme le ratio
   répétitions cibles / répétitions maximales.

   Principe :
   Augmentation linéaire du volume total de 10% par semaine,
   redistribué entre séries et répétitions selon les zones
   d'intensité de Prilepin.

   Quand cet algorithme est optimal :
   Débutant pur (semaines 1-4), progression régulière sans échec.

   ─────────────────────────────────────────────────────────────
   Contrat d'interface (commun à tous les algorithmes) :

     algo.predictTestMax(weekNumber, history)  → number
     algo.generatePlan(weekNumber, testMax, history) → Object
     algo.getName()    → string (identifiant machine)
     algo.getLabel()   → string (nom lisible)
     algo.getDescription() → string

   Ce contrat est vérifié par engine.js lors de l'enregistrement.
   ════════════════════════════════════════════════════════════════ */

import {
  clamp,
  round,
  calculateRest,
  distributeVolume
} from '../utils/math.js';


// ── Constantes ──

/** Taux de progression linéaire par semaine (+10%) */
const WEEKLY_PROGRESSION_RATE = 0.10;

/** Multiplicateur de volume de base (volume = testMax × BASE_VOLUME_MULTIPLIER) */
const BASE_VOLUME_MULTIPLIER = 3;

/**
 * Distribution du volume hebdomadaire sur 6 jours (J2-J7).
 *
 * Rationale :
 * - J2 (20%) : Récupération post-test, volume modéré
 * - J3 (18%) : Montée progressive
 * - J4 (15%) : Récupération mi-semaine
 * - J5 (18%) : Pic de la semaine
 * - J6 (17%) : Maintien
 * - J7 (12%) : Pré-test semaine suivante, volume réduit
 */
const DAILY_VOLUME_RATIOS = [0.20, 0.18, 0.15, 0.18, 0.17, 0.12];

/**
 * Zones d'intensité Prilepin adaptées au poids du corps.
 *
 * Chaque zone définit :
 * - repsRatio : ratio de reps par série par rapport au test max
 * - seriesRange : [min, max] séries possibles
 * - type : nom de la zone pour l'affichage
 *
 * Index : 0 = J2, 1 = J3, ..., 5 = J7
 */
const INTENSITY_ZONES = [
  {
    repsRatio: 0.60,
    seriesRange: [5, 6],
    type: 'ENDURANCE',
    label: 'Endurance'
  },
  {
    repsRatio: 0.70,
    seriesRange: [4, 5],
    type: 'MIXTE',
    label: 'Mixte'
  },
  {
    repsRatio: 0.80,
    seriesRange: [3, 4],
    type: 'FORCE',
    label: 'Force'
  },
  {
    repsRatio: 0.65,
    seriesRange: [4, 5],
    type: 'ENDURANCE',
    label: 'Endurance'
  },
  {
    repsRatio: 0.70,
    seriesRange: [4, 5],
    type: 'MIXTE',
    label: 'Mixte'
  },
  {
    repsRatio: 0.55,
    seriesRange: [5, 6],
    type: 'ENDURANCE',
    label: 'Endurance'
  }
];

Object.freeze(DAILY_VOLUME_RATIOS);
Object.freeze(INTENSITY_ZONES);

/**
 * Paramètres de repos par zone.
 *
 * - baseRest   : repos de base en secondes
 * - threshold  : seuil de reps avant ajustement
 * - addPer     : secondes ajoutées par tranche au-dessus du seuil
 * - chunkSize  : taille de la tranche
 */
const REST_CONFIG = {
  ENDURANCE:    { baseRest: 50, threshold: 15, addPer: 8, chunkSize: 5 },
  MIXTE:        { baseRest: 60, threshold: 20, addPer: 10, chunkSize: 5 },
  FORCE:        { baseRest: 75, threshold: 20, addPer: 10, chunkSize: 5 }
};

Object.freeze(REST_CONFIG);


// ── Classe LinearAlgorithm ──

class LinearAlgorithm {

  /* ──────────────────────────────────────────────────────────
     IDENTITÉ
     ────────────────────────────────────────────────────────── */

  /**
   * Identifiant machine unique.
   * @returns {string}
   */
  getName() {
    return 'linear';
  }

  /**
   * Nom lisible pour l'interface.
   * @returns {string}
   */
  getLabel() {
    return 'Progression Linéaire';
  }

  /**
   * Description courte pour l'écran de résultats.
   * @returns {string}
   */
  getDescription() {
    return 'Augmentation linéaire du volume de 10% par semaine, ' +
           'distribuée selon les zones d\'intensité de Prilepin.';
  }


  /* ──────────────────────────────────────────────────────────
     PRÉDICTION DU TEST MAX
     
     Modèle : progression linéaire de 10% par semaine.
     test_max_prédit(N) = dernier_test_max × 1.10
     
     Simple mais efficace pour les débutants (semaines 1-4).
     ────────────────────────────────────────────────────────── */

  /**
   * Prédit le test max pour la semaine donnée.
   *
   * @param {number} weekNumber — Numéro de la semaine à prédire
   * @param {Array<Object>} history — Historique des semaines passées
   *   Chaque entrée : { weekNumber, testMax, feedbackSummary, ... }
   * @returns {number} Prédiction du test max (entier ≥ 1)
   */
  predictTestMax(weekNumber, history) {
    // Pas d'historique → impossible de prédire
    if (!history || history.length === 0) {
      return 1;
    }

    const lastTestMax = this._getLastTestMax(history);

    // Prédiction : +10% par semaine depuis le dernier test
    const lastWeekNumber = history[history.length - 1].weekNumber || 1;
    const weeksDelta = Math.max(1, weekNumber - lastWeekNumber);
    const predicted = lastTestMax * Math.pow(1 + WEEKLY_PROGRESSION_RATE, weeksDelta);

    return Math.max(1, round(predicted));
  }


  /* ──────────────────────────────────────────────────────────
     GÉNÉRATION DU PLAN HEBDOMADAIRE
     
     Formules du PRD :
     - Volume_semaine_N = Volume_semaine_1 × (1.10)^(N-1)
     - Volume_semaine_1 = test_max × 3
     - Distribution sur 6 jours selon DAILY_VOLUME_RATIOS
     - Reps par série selon la zone d'intensité
     - Séries = volume_jour / reps_par_série
     - Repos = f(zone, reps)
     ────────────────────────────────────────────────────────── */

  /**
   * Génère le plan d'entraînement J2-J7 pour la semaine.
   *
   * @param {number} weekNumber — Numéro de la semaine
   * @param {number} testMax    — Résultat du test max de cette semaine
   * @param {Array<Object>} history — Historique des semaines passées
   * @returns {Object} Plan { day2: {series, reps, rest, type}, ..., day7: {...} }
   */
  generatePlan(weekNumber, testMax, history) {
    // Mode grand débutant (test_max < 5)
    if (testMax < 5) {
      return this._generateBeginnerPlan();
    }

    // Calculer le volume hebdomadaire total
    const weeklyVolume = this._calculateWeeklyVolume(weekNumber, testMax);

    // Distribuer le volume sur les 6 jours
    const dailyVolumes = distributeVolume(weeklyVolume, DAILY_VOLUME_RATIOS);

    // Générer le plan pour chaque jour
    const plan = {};

    for (let i = 0; i < 6; i++) {
      const dayNumber = i + 2; // J2 à J7
      const dayVolume = dailyVolumes[i];
      const zone = INTENSITY_ZONES[i];

      const dayPlan = this._generateDayPlan(
        dayVolume,
        testMax,
        zone
      );

      plan[`day${dayNumber}`] = dayPlan;
    }

    return plan;
  }


  /* ──────────────────────────────────────────────────────────
     CALCULS INTERNES
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule le volume hebdomadaire total.
   *
   * Volume = testMax × 3 × (1.10)^(N-1)
   *
   * @param {number} weekNumber
   * @param {number} testMax
   * @returns {number} Volume total en reps
   * @private
   */
  _calculateWeeklyVolume(weekNumber, testMax) {
    const baseVolume = testMax * BASE_VOLUME_MULTIPLIER;
    const volume = baseVolume * Math.pow(1 + WEEKLY_PROGRESSION_RATE, weekNumber - 1);
    return round(volume);
  }

  /**
   * Génère le plan d'un jour à partir de son volume et sa zone d'intensité.
   *
   * @param {number} dayVolume — Volume cible pour ce jour
   * @param {number} testMax   — Test max actuel
   * @param {Object} zone      — Zone d'intensité (INTENSITY_ZONES[i])
   * @returns {{series: number, reps: number, rest: number, type: string}}
   * @private
   */
  _generateDayPlan(dayVolume, testMax, zone) {
    // Calculer les reps par série selon le ratio d'intensité
    let reps = round(testMax * zone.repsRatio);

    // Borner les reps
    reps = clamp(reps, 3, Math.ceil(testMax * 1.2));

    // Calculer le nombre de séries pour atteindre le volume cible
    let series = reps > 0 ? round(dayVolume / reps) : zone.seriesRange[0];

    // Borner les séries selon la zone
    series = clamp(series, zone.seriesRange[0], zone.seriesRange[1]);

    // Si les séries sont au minimum et le volume est encore trop haut,
    // augmenter les reps
    const actualVolume = series * reps;
    if (actualVolume < dayVolume * 0.8 && reps < Math.ceil(testMax * 1.2)) {
      reps = clamp(
        round(dayVolume / series),
        3,
        Math.ceil(testMax * 1.2)
      );
    }

    // Bornes de sécurité globales
    series = clamp(series, 2, 10);
    reps = clamp(reps, 3, Math.ceil(testMax * 1.2));

    // Calculer le repos selon la zone
    const restConfig = REST_CONFIG[zone.type] || REST_CONFIG.MIXTE;
    const rest = clamp(
      calculateRest(reps, restConfig.baseRest, restConfig.threshold, restConfig.addPer, restConfig.chunkSize),
      20,
      180
    );

    return {
      series,
      reps,
      rest,
      type: zone.type
    };
  }

  /**
   * Génère le plan pour les grands débutants (test_max < 5).
   *
   * Plan fixe : 5 × 3 reps avec 90s de repos.
   * Pas de variation par zone — priorité à l'apprentissage du mouvement.
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

  /**
   * Récupère le dernier test max valide de l'historique.
   *
   * @param {Array<Object>} history
   * @returns {number}
   * @private
   */
  _getLastTestMax(history) {
    // Parcourir l'historique en sens inverse pour trouver le dernier testMax
    for (let i = history.length - 1; i >= 0; i--) {
      if (typeof history[i].testMax === 'number' && history[i].testMax > 0) {
        return history[i].testMax;
      }
    }

    // Fallback
    return 10;
  }

  /**
   * Calcule les détails de la zone d'intensité pour un jour donné.
   * Utile pour l'affichage dans le dashboard et l'historique.
   *
   * @param {number} dayIndex — Index du jour (0 = J2, 5 = J7)
   * @param {number} testMax
   * @returns {{zone: Object, reps: number, intensity: number}}
   */
  getIntensityDetails(dayIndex, testMax) {
    const zone = INTENSITY_ZONES[clamp(dayIndex, 0, 5)];
    const reps = round(testMax * zone.repsRatio);
    const intensity = round(zone.repsRatio * 100, 1);

    return {
      zone,
      reps,
      intensity,
      label: zone.label,
      type: zone.type
    };
  }

  /**
   * Calcule la prédiction de volume total pour la semaine.
   * Utile pour le récapitulatif et les comparaisons.
   *
   * @param {number} weekNumber
   * @param {number} testMax
   * @returns {number}
   */
  getPredictedWeeklyVolume(weekNumber, testMax) {
    return this._calculateWeeklyVolume(weekNumber, testMax);
  }
}


// ── Export ──

export { LinearAlgorithm, INTENSITY_ZONES, DAILY_VOLUME_RATIOS };
export default LinearAlgorithm;