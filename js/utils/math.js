/* ════════════════════════════════════════════════════════════════
   AbdoPro — utils/math.js

   Responsabilité unique : fonctions mathématiques pures.
   ─────────────────────────────────────────────────────────────
   Aucun effet de bord, aucune dépendance, aucun état.
   Chaque fonction prend des entrées et retourne un résultat.
   Testable unitairement sans aucun mock.

   ─────────────────────────────────────────────────────────────
   Contenu :
     1. Arrondis et bornage
     2. Statistiques de base
     3. Algèbre linéaire (déterminants)
     4. Régression linéaire (moindres carrés)
     5. Régression polynomiale d'ordre 2 (moindres carrés)
     6. Calculs exponentiels (modèle Banister)
     7. Utilitaires de progression
   ════════════════════════════════════════════════════════════════ */


/* ──────────────────────────────────────────────────────────────
   1. ARRONDIS ET BORNAGE
   ────────────────────────────────────────────────────────────── */

/**
 * Borne une valeur entre un minimum et un maximum.
 *
 * @param {number} value — Valeur à borner
 * @param {number} min   — Borne inférieure
 * @param {number} max   — Borne supérieure
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Arrondi un nombre à N décimales.
 *
 * @param {number} value    — Valeur à arrondir
 * @param {number} decimals — Nombre de décimales (défaut: 0)
 * @returns {number}
 */
export function round(value, decimals = 0) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Arrondi supérieur (ceil) un nombre à N décimales.
 *
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
export function ceilTo(value, decimals = 0) {
  const factor = Math.pow(10, decimals);
  return Math.ceil(value * factor) / factor;
}

/**
 * Arrondi inférieur (floor) un nombre à N décimales.
 *
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
export function floorTo(value, decimals = 0) {
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor) / factor;
}


/* ──────────────────────────────────────────────────────────────
   2. STATISTIQUES DE BASE
   ────────────────────────────────────────────────────────────── */

/**
 * Calcule la somme d'un tableau de nombres.
 *
 * @param {number[]} values
 * @returns {number}
 */
export function sum(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((acc, val) => acc + val, 0);
}

/**
 * Calcule la moyenne arithmétique.
 *
 * @param {number[]} values
 * @returns {number} Moyenne, ou 0 si tableau vide
 */
export function mean(values) {
  if (!values || values.length === 0) return 0;
  return sum(values) / values.length;
}

/**
 * Calcule la variance (population).
 *
 * @param {number[]} values
 * @returns {number}
 */
export function variance(values) {
  if (!values || values.length < 2) return 0;

  const avg = mean(values);
  const squaredDiffs = values.map(v => (v - avg) ** 2);
  return sum(squaredDiffs) / values.length;
}

/**
 * Calcule l'écart-type (population).
 *
 * @param {number[]} values
 * @returns {number}
 */
export function standardDeviation(values) {
  return Math.sqrt(variance(values));
}

/**
 * Calcule la médiane d'un tableau de nombres.
 *
 * @param {number[]} values
 * @returns {number}
 */
export function median(values) {
  if (!values || values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Calcule le minimum d'un tableau de nombres.
 *
 * @param {number[]} values
 * @returns {number}
 */
export function min(values) {
  if (!values || values.length === 0) return 0;
  return Math.min(...values);
}

/**
 * Calcule le maximum d'un tableau de nombres.
 *
 * @param {number[]} values
 * @returns {number}
 */
export function max(values) {
  if (!values || values.length === 0) return 0;
  return Math.max(...values);
}

/**
 * Calcule la moyenne pondérée.
 * Chaque valeur est associée à un poids.
 *
 * @param {number[]} values  — Valeurs
 * @param {number[]} weights — Poids correspondants
 * @returns {number}
 */
export function weightedMean(values, weights) {
  if (!values || !weights || values.length === 0) return 0;
  if (values.length !== weights.length) {
    throw new Error(
      `weightedMean : values (${values.length}) et weights (${weights.length}) ` +
      `doivent avoir la même taille.`
    );
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < values.length; i++) {
    weightedSum += values[i] * weights[i];
    totalWeight += weights[i];
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}


/* ──────────────────────────────────────────────────────────────
   3. ALGÈBRE LINÉAIRE — DÉTERMINANTS
   
   Utilisé par la régression polynomiale (résolution par Cramer).
   ────────────────────────────────────────────────────────────── */

/**
 * Calcule le déterminant d'une matrice 2×2.
 *
 * @param {number[][]} m — Matrice 2×2
 * @returns {number}
 */
export function determinant2x2(m) {
  return m[0][0] * m[1][1] - m[0][1] * m[1][0];
}

/**
 * Calcule le déterminant d'une matrice 3×3.
 * Développement selon la première ligne (règle de Sarrus).
 *
 * @param {number[][]} m — Matrice 3×3
 * @returns {number}
 */
export function determinant3x3(m) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}


/* ──────────────────────────────────────────────────────────────
   4. RÉGRESSION LINÉAIRE (MOINDRES CARRÉS)
   
   Modèle : y = bx + c
   
   Utilisé comme fallback quand il n'y a pas assez de points
   pour une régression polynomiale (< 3 points).
   ────────────────────────────────────────────────────────────── */

/**
 * Ajuste une droite y = bx + c par la méthode des moindres carrés.
 *
 * @param {Array<[number, number]>} points — Tableau de [x, y]
 * @returns {{a: number, b: number, c: number, stdError: number, type: string}}
 *   a = 0 (pas de terme quadratique),
 *   b = pente,
 *   c = ordonnée à l'origine,
 *   stdError = écart-type des résidus,
 *   type = 'linear'
 */
export function fitLinear(points) {
  const n = points.length;

  // Cas dégénérés
  if (n === 0) {
    return { a: 0, b: 0, c: 0, stdError: 0, type: 'linear' };
  }

  if (n === 1) {
    return { a: 0, b: 0, c: points[0][1], stdError: 0, type: 'linear' };
  }

  // Sommes nécessaires
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    const [x, y] = points[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  // Dénominateur
  const denom = n * sumX2 - sumX * sumX;

  // Si tous les x sont identiques, pas de pente
  if (Math.abs(denom) < 1e-10) {
    return { a: 0, b: 0, c: sumY / n, stdError: 0, type: 'linear' };
  }

  // Coefficients
  const b = (n * sumXY - sumX * sumY) / denom;
  const c = (sumY - b * sumX) / n;

  // Écart-type des résidus
  let sumResiduals2 = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = points[i];
    const predicted = b * x + c;
    sumResiduals2 += (y - predicted) ** 2;
  }
  const stdError = Math.sqrt(sumResiduals2 / Math.max(1, n - 2));

  return { a: 0, b, c, stdError, type: 'linear' };
}


/* ──────────────────────────────────────────────────────────────
   5. RÉGRESSION POLYNOMIALE D'ORDRE 2 (MOINDRES CARRÉS)
   
   Modèle : y = ax² + bx + c
   
   Résolution par la méthode de Cramer appliquée au système
   d'équations normales.
   
   Utilisé par l'algorithme 5 (Régression Adaptative) pour
   modéliser la trajectoire de progression du test_max.
   ────────────────────────────────────────────────────────────── */

/**
 * Ajuste un polynôme y = ax² + bx + c par les moindres carrés.
 *
 * Le système d'équations normales est :
 *   |Σx⁴  Σx³  Σx²| |a|   |Σx²y|
 *   |Σx³  Σx²  Σx | |b| = |Σxy |
 *   |Σx²  Σx   n  | |c|   |Σy  |
 *
 * Résolu par la règle de Cramer (déterminants 3×3).
 *
 * @param {Array<[number, number]>} points — Tableau de [x, y] (≥ 3 points idéalement)
 * @returns {{a: number, b: number, c: number, stdError: number, type: string}}
 *   a = coefficient quadratique,
 *   b = coefficient linéaire,
 *   c = constante,
 *   stdError = écart-type des résidus,
 *   type = 'polynomial' | 'linear'
 */
export function fitPolynomial(points) {
  const n = points.length;

  // Pas assez de points pour une régression polynomiale
  if (n < 3) {
    return fitLinear(points);
  }

  // Calcul des sommes
  let sumX = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0;
  let sumY = 0, sumXY = 0, sumX2Y = 0;

  for (let i = 0; i < n; i++) {
    const [x, y] = points[i];
    const x2 = x * x;
    const x3 = x2 * x;
    const x4 = x3 * x;

    sumX += x;
    sumX2 += x2;
    sumX3 += x3;
    sumX4 += x4;
    sumY += y;
    sumXY += x * y;
    sumX2Y += x2 * y;
  }

  // Matrice du système normal
  const M = [
    [sumX4, sumX3, sumX2],
    [sumX3, sumX2, sumX],
    [sumX2, sumX, n]
  ];

  // Vecteur des seconds membres
  const V = [sumX2Y, sumXY, sumY];

  // Déterminant principal
  const det = determinant3x3(M);

  // Si le déterminant est nul (points colinéaires ou dégénérés),
  // fallback vers la régression linéaire
  if (Math.abs(det) < 1e-10) {
    return fitLinear(points);
  }

  // Résolution par Cramer
  const a = determinant3x3([
    [V[0], M[0][1], M[0][2]],
    [V[1], M[1][1], M[1][2]],
    [V[2], M[2][1], M[2][2]]
  ]) / det;

  const b = determinant3x3([
    [M[0][0], V[0], M[0][2]],
    [M[1][0], V[1], M[1][2]],
    [M[2][0], V[2], M[2][2]]
  ]) / det;

  const c = determinant3x3([
    [M[0][0], M[0][1], V[0]],
    [M[1][0], M[1][1], V[1]],
    [M[2][0], M[2][1], V[2]]
  ]) / det;

  // Écart-type des résidus
  let sumResiduals2 = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = points[i];
    const predicted = a * x * x + b * x + c;
    sumResiduals2 += (y - predicted) ** 2;
  }
  const stdError = Math.sqrt(sumResiduals2 / Math.max(1, n - 3));

  return { a, b, c, stdError, type: 'polynomial' };
}

/**
 * Évalue un polynôme ax² + bx + c pour une valeur x donnée.
 *
 * @param {{a: number, b: number, c: number}} model — Coefficients
 * @param {number} x — Valeur à évaluer
 * @returns {number}
 */
export function evaluatePolynomial(model, x) {
  return model.a * x * x + model.b * x + model.c;
}

/**
 * Calcule l'intervalle de confiance à 95% pour une prédiction.
 *
 * @param {{stdError: number}} model — Modèle avec écart-type des résidus
 * @returns {number} Marge d'erreur (± cette valeur)
 */
export function confidenceInterval95(model) {
  return 1.96 * (model.stdError || 0);
}


/* ──────────────────────────────────────────────────────────────
   6. CALCULS EXPONENTIELS (MODÈLE BANISTER)
   
   Fonctions pour le modèle fitness-fatigue bi-exponentiel.
   Performance(t) = P_base + Fitness(t) - Fatigue(t)
   ────────────────────────────────────────────────────────────── */

/**
 * Calcule la contribution fitness d'une séance à un instant t.
 *
 * Fitness_contribution = charge × k1 × e^(-dt / τ1)
 *
 * @param {number} charge  — Volume de la séance (séries × reps)
 * @param {number} dt      — Nombre de jours depuis la séance
 * @param {number} k1      — Gain fitness par unité de charge (défaut: 1)
 * @param {number} tau1    — Constante de temps fitness en jours (défaut: 45)
 * @returns {number}
 */
export function fitnessContribution(charge, dt, k1 = 1, tau1 = 45) {
  if (dt <= 0) return 0;
  return charge * k1 * Math.exp(-dt / tau1);
}

/**
 * Calcule la contribution fatigue d'une séance à un instant t.
 *
 * Fatigue_contribution = charge × k2 × e^(-dt / τ2)
 *
 * @param {number} charge  — Volume de la séance
 * @param {number} dt      — Nombre de jours depuis la séance
 * @param {number} k2      — Gain fatigue par unité de charge (défaut: 2)
 * @param {number} tau2    — Constante de temps fatigue en jours (défaut: 15)
 * @returns {number}
 */
export function fatigueContribution(charge, dt, k2 = 2, tau2 = 15) {
  if (dt <= 0) return 0;
  return charge * k2 * Math.exp(-dt / tau2);
}

/**
 * Calcule la performance nette (fitness - fatigue) pour un ensemble
 * de séances à un instant t donné.
 *
 * @param {number} pBase    — Performance de base (test_max initial)
 * @param {Array<{day: number, volume: number}>} sessions — Historique
 * @param {number} targetDay — Jour pour lequel calculer la performance
 * @param {Object} [params]  — Paramètres optionnels {k1, k2, tau1, tau2}
 * @returns {{performance: number, fitness: number, fatigue: number}}
 */
export function banisterPerformance(pBase, sessions, targetDay, params = {}) {
  const { k1 = 1, k2 = 2, tau1 = 45, tau2 = 15 } = params;

  let totalFitness = 0;
  let totalFatigue = 0;

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const dt = targetDay - session.day;

    if (dt > 0 && session.volume > 0) {
      totalFitness += fitnessContribution(session.volume, dt, k1, tau1);
      totalFatigue += fatigueContribution(session.volume, dt, k2, tau2);
    }
  }

  const performance = pBase + totalFitness - totalFatigue;

  return {
    performance: Math.max(1, performance),
    fitness: totalFitness,
    fatigue: totalFatigue
  };
}

/**
 * Calcule l'effet net d'une séance hypothétique à un jour donné
 * sur la performance à un jour cible.
 *
 * Utile pour déterminer la charge optimale quotidienne.
 *
 * @param {number} sessionDay — Jour de la séance hypothétique
 * @param {number} targetDay  — Jour cible (ex: jour du prochain test)
 * @param {Object} [params]   — Paramètres {k1, k2, tau1, tau2}
 * @returns {number} Effet net par unité de charge (positif = bénéfique)
 */
export function netEffectPerUnit(sessionDay, targetDay, params = {}) {
  const { k1 = 1, k2 = 2, tau1 = 45, tau2 = 15 } = params;

  const dt = targetDay - sessionDay;
  if (dt <= 0) return 0;

  const fitnessEffect = k1 * Math.exp(-dt / tau1);
  const fatigueEffect = k2 * Math.exp(-dt / tau2);

  return fitnessEffect - fatigueEffect;
}


/* ──────────────────────────────────────────────────────────────
   7. UTILITAIRES DE PROGRESSION
   
   Calculs utilisés par plusieurs algorithmes.
   ────────────────────────────────────────────────────────────── */

/**
 * Calcule le taux de progression entre deux valeurs.
 *
 * @param {number} previous — Valeur précédente
 * @param {number} current  — Valeur actuelle
 * @returns {number} Taux (ex: 0.25 pour +25%)
 */
export function progressionRate(previous, current) {
  if (!previous || previous === 0) return 0;
  return (current - previous) / previous;
}

/**
 * Calcule le taux de progression moyen sur une série de valeurs.
 *
 * @param {number[]} values — Série chronologique de valeurs
 * @returns {number} Taux moyen entre chaque paire consécutive
 */
export function averageProgressionRate(values) {
  if (!values || values.length < 2) return 0;

  let totalRate = 0;
  let count = 0;

  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) {
      totalRate += (values[i] - values[i - 1]) / values[i - 1];
      count++;
    }
  }

  return count > 0 ? totalRate / count : 0;
}

/**
 * Détermine la tendance d'une série de valeurs.
 *
 * @param {number[]} values — Au moins 2 valeurs chronologiques
 * @returns {'increasing' | 'decreasing' | 'stagnant' | 'insufficient'}
 */
export function detectTrend(values) {
  if (!values || values.length < 2) return 'insufficient';

  const first = values[0];
  const last = values[values.length - 1];

  if (first === 0) return 'insufficient';

  const variation = Math.abs(last - first) / first;

  // Stagnation si variation < 5%
  if (variation < 0.05) return 'stagnant';

  // Vérifier monotonie
  let increasing = true;
  let decreasing = true;

  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) increasing = false;
    if (values[i] > values[i - 1]) decreasing = false;
  }

  if (increasing) return 'increasing';
  if (decreasing) return 'decreasing';

  // Ni monotone croissant, ni décroissant → on regarde la tendance globale
  return last > first ? 'increasing' : 'decreasing';
}

/**
 * Calcule le poids de décroissance exponentielle pour le scoring.
 * Les semaines récentes comptent plus que les anciennes.
 *
 * poids = decay^(currentWeek - targetWeek)
 *
 * @param {number} currentWeek — Semaine courante
 * @param {number} targetWeek  — Semaine cible
 * @param {number} decay       — Facteur de décroissance (défaut: 0.9)
 * @returns {number}
 */
export function exponentialWeight(currentWeek, targetWeek, decay = 0.9) {
  const distance = Math.abs(currentWeek - targetWeek);
  return Math.pow(decay, distance);
}

/**
 * Calcule le temps de repos selon le nombre de reps.
 * Formule de base avec ajustement par tranche.
 *
 * @param {number} reps         — Nombre de répétitions
 * @param {number} baseRest     — Repos de base en secondes (défaut: 60)
 * @param {number} threshold    — Seuil de reps avant ajustement (défaut: 20)
 * @param {number} addPerChunk  — Secondes ajoutées par tranche (défaut: 10)
 * @param {number} chunkSize    — Taille de la tranche (défaut: 5)
 * @returns {number} Temps de repos en secondes
 */
export function calculateRest(reps, baseRest = 60, threshold = 20, addPerChunk = 10, chunkSize = 5) {
  if (reps <= threshold) return baseRest;
  const extraChunks = Math.floor((reps - threshold) / chunkSize);
  return baseRest + extraChunks * addPerChunk;
}

/**
 * Distribue un volume total sur N jours selon des ratios donnés.
 *
 * @param {number}   totalVolume  — Volume total à distribuer
 * @param {number[]} ratios       — Ratios par jour (seront normalisés)
 * @returns {number[]} Volume par jour (entiers arrondis)
 */
export function distributeVolume(totalVolume, ratios) {
  if (!ratios || ratios.length === 0) return [];

  // Normaliser les ratios
  const totalRatio = sum(ratios);
  if (totalRatio === 0) return ratios.map(() => 0);

  const normalized = ratios.map(r => r / totalRatio);

  // Distribuer en arrondissant
  const distributed = normalized.map(r => Math.round(totalVolume * r));

  // Corriger l'erreur d'arrondi sur le dernier jour
  const actualTotal = sum(distributed);
  const diff = Math.round(totalVolume) - actualTotal;
  if (diff !== 0 && distributed.length > 0) {
    // Ajouter/retirer la différence au jour le plus gros
    const maxIndex = distributed.indexOf(Math.max(...distributed));
    distributed[maxIndex] += diff;
  }

  return distributed;
}

/**
 * Calcule le nombre de séries et reps à partir d'un volume cible.
 * Répartit intelligemment selon la plage de volume.
 *
 * @param {number} targetVolume — Volume total cible (reps totales)
 * @param {number} testMax      — Test max actuel
 * @returns {{series: number, reps: number}}
 */
export function volumeToSeriesReps(targetVolume, testMax) {
  // Bornes de sécurité
  const safeVolume = Math.max(6, targetVolume);

  let series;
  if (safeVolume < 30) {
    series = 3;
  } else if (safeVolume < 60) {
    series = 4;
  } else {
    series = 5;
  }

  let reps = Math.round(safeVolume / series);

  // Borner les reps
  reps = clamp(reps, 3, Math.ceil(testMax * 1.2));

  // Recalculer les séries si reps a été borné
  if (reps * series !== safeVolume) {
    series = clamp(Math.round(safeVolume / reps), 2, 10);
  }

  return { series, reps };
}