/* ════════════════════════════════════════════════════════════════
   AbdoPro — utils/timer.js

   Responsabilité unique : chronomètre de repos entre les séries.
   ─────────────────────────────────────────────────────────────
   Gère un décompte précis basé sur les timestamps réels
   (pas sur setInterval qui dérive).

   Découplé du DOM : communique via des callbacks.
   L'écran session.js est responsable de mettre à jour l'UI.

   ─────────────────────────────────────────────────────────────
   API publique :

     const timer = new RestTimer({
       duration: 60,                 // Durée en secondes
       onTick(remaining, fraction),  // Appelé chaque frame (~60fps)
       onWarning(),                  // Appelé quand < seuil critique
       onComplete(),                 // Appelé à la fin du décompte
     });

     timer.start()         → Démarre le décompte
     timer.pause()         → Met en pause
     timer.resume()        → Reprend après pause
     timer.skip()          → Arrête immédiatement (déclenche onComplete)
     timer.reset(duration) → Réinitialise avec une nouvelle durée
     timer.destroy()       → Nettoie les ressources

     // Lecture
     timer.getRemaining()  → Secondes restantes
     timer.isRunning()     → En cours ?
     timer.isPaused()      → En pause ?
     timer.getFraction()   → Fraction écoulée (0 → 1)
   ════════════════════════════════════════════════════════════════ */


// ── Constantes ──

/** Seuil en secondes sous lequel le warning est déclenché */
const WARNING_THRESHOLD = 5;

/** Intervalle minimum entre deux ticks (ms) — ~60fps */
const MIN_TICK_INTERVAL = 16;

/** États possibles du timer */
const TIMER_STATE = {
  IDLE:     'idle',
  RUNNING:  'running',
  PAUSED:   'paused',
  COMPLETE: 'complete'
};

Object.freeze(TIMER_STATE);


// ── Classe RestTimer ──

class RestTimer {

  /**
   * @param {Object} options
   * @param {number}   options.duration    — Durée en secondes
   * @param {Function} [options.onTick]    — Callback chaque frame (remaining, fraction)
   * @param {Function} [options.onWarning] — Callback quand remaining < seuil critique
   * @param {Function} [options.onComplete]— Callback quand le timer atteint 0
   */
  constructor(options = {}) {
    this._validateOptions(options);

    /** @type {number} Durée totale en secondes */
    this._duration = options.duration || 60;

    /** @type {Function|null} */
    this._onTick = options.onTick || null;

    /** @type {Function|null} */
    this._onWarning = options.onWarning || null;

    /** @type {Function|null} */
    this._onComplete = options.onComplete || null;

    /** @type {string} État courant */
    this._state = TIMER_STATE.IDLE;

    /** @type {number|null} Timestamp de début (ms) */
    this._startTime = null;

    /** @type {number} Temps écoulé avant la pause (ms) */
    this._elapsedBeforePause = 0;

    /** @type {number|null} ID du requestAnimationFrame */
    this._rafId = null;

    /** @type {boolean} Warning déjà déclenché pour ce cycle */
    this._warningFired = false;

    /** @type {number} Dernière valeur entière de remaining (pour détecter les changements) */
    this._lastWholeSecond = -1;

    // Binder la méthode _tick pour requestAnimationFrame
    this._tick = this._tick.bind(this);
  }

  /**
   * Valide les options du constructeur.
   *
   * @param {Object} options
   * @throws {Error}
   * @private
   */
  _validateOptions(options) {
    if (options.duration !== undefined) {
      if (typeof options.duration !== 'number' || options.duration < 0) {
        throw new Error(
          `RestTimer: duration doit être un nombre positif (reçu: ${options.duration}).`
        );
      }
    }

    if (options.onTick && typeof options.onTick !== 'function') {
      throw new Error('RestTimer: onTick doit être une fonction.');
    }

    if (options.onWarning && typeof options.onWarning !== 'function') {
      throw new Error('RestTimer: onWarning doit être une fonction.');
    }

    if (options.onComplete && typeof options.onComplete !== 'function') {
      throw new Error('RestTimer: onComplete doit être une fonction.');
    }
  }


  /* ──────────────────────────────────────────────────────────
     CONTRÔLE DU TIMER
     ────────────────────────────────────────────────────────── */

  /**
   * Démarre le décompte.
   * Si le timer est déjà en cours, ne fait rien.
   */
  start() {
    if (this._state === TIMER_STATE.RUNNING) return;

    // Si le timer est terminé ou idle, réinitialiser les compteurs
    if (this._state === TIMER_STATE.COMPLETE || this._state === TIMER_STATE.IDLE) {
      this._elapsedBeforePause = 0;
      this._warningFired = false;
      this._lastWholeSecond = -1;
    }

    this._state = TIMER_STATE.RUNNING;
    this._startTime = performance.now();

    // Lancer la boucle d'animation
    this._scheduleNextTick();
  }

  /**
   * Met le timer en pause.
   * Sauvegarde le temps écoulé pour pouvoir reprendre.
   */
  pause() {
    if (this._state !== TIMER_STATE.RUNNING) return;

    // Calculer le temps écoulé depuis le dernier start/resume
    const now = performance.now();
    this._elapsedBeforePause += now - this._startTime;

    // Annuler l'animation en cours
    this._cancelAnimation();

    this._state = TIMER_STATE.PAUSED;
  }

  /**
   * Reprend après une pause.
   */
  resume() {
    if (this._state !== TIMER_STATE.PAUSED) return;

    this._state = TIMER_STATE.RUNNING;
    this._startTime = performance.now();

    this._scheduleNextTick();
  }

  /**
   * Arrête immédiatement le timer et déclenche onComplete.
   */
  skip() {
    if (this._state === TIMER_STATE.COMPLETE) return;

    this._cancelAnimation();
    this._state = TIMER_STATE.COMPLETE;

    // Notifier un dernier tick à 0
    this._fireTick(0, 1);

    // Déclencher le callback de fin
    this._fireComplete();
  }

  /**
   * Réinitialise le timer avec une nouvelle durée (optionnelle).
   * Ne démarre pas automatiquement.
   *
   * @param {number} [duration] — Nouvelle durée en secondes
   */
  reset(duration) {
    this._cancelAnimation();

    if (typeof duration === 'number' && duration >= 0) {
      this._duration = duration;
    }

    this._state = TIMER_STATE.IDLE;
    this._startTime = null;
    this._elapsedBeforePause = 0;
    this._warningFired = false;
    this._lastWholeSecond = -1;
  }

  /**
   * Nettoie toutes les ressources.
   * Après destroy(), l'instance ne doit plus être utilisée.
   */
  destroy() {
    this._cancelAnimation();

    this._state = TIMER_STATE.COMPLETE;
    this._onTick = null;
    this._onWarning = null;
    this._onComplete = null;
    this._startTime = null;
  }


  /* ──────────────────────────────────────────────────────────
     LECTURE DE L'ÉTAT
     ────────────────────────────────────────────────────────── */

  /**
   * Retourne le nombre de secondes restantes.
   * @returns {number}
   */
  getRemaining() {
    const elapsed = this._getTotalElapsedMs() / 1000;
    return Math.max(0, this._duration - elapsed);
  }

  /**
   * Retourne la fraction du temps écoulé (0 = début, 1 = terminé).
   * @returns {number}
   */
  getFraction() {
    if (this._duration <= 0) return 1;
    const elapsed = this._getTotalElapsedMs() / 1000;
    return Math.min(1, elapsed / this._duration);
  }

  /**
   * Retourne la durée totale configurée.
   * @returns {number}
   */
  getDuration() {
    return this._duration;
  }

  /**
   * Vérifie si le timer est en cours.
   * @returns {boolean}
   */
  isRunning() {
    return this._state === TIMER_STATE.RUNNING;
  }

  /**
   * Vérifie si le timer est en pause.
   * @returns {boolean}
   */
  isPaused() {
    return this._state === TIMER_STATE.PAUSED;
  }

  /**
   * Vérifie si le timer est terminé.
   * @returns {boolean}
   */
  isComplete() {
    return this._state === TIMER_STATE.COMPLETE;
  }

  /**
   * Vérifie si le timer est en mode idle (pas encore démarré).
   * @returns {boolean}
   */
  isIdle() {
    return this._state === TIMER_STATE.IDLE;
  }

  /**
   * Retourne l'état courant.
   * @returns {string}
   */
  getState() {
    return this._state;
  }

  /**
   * Formate le temps restant en chaîne "M:SS".
   *
   * @param {number} [seconds] — Secondes à formater (défaut: remaining)
   * @returns {string} Ex: "1:24", "0:05"
   */
  formatRemaining(seconds) {
    const remaining = seconds !== undefined ? seconds : this.getRemaining();
    const totalSeconds = Math.ceil(remaining);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }


  /* ──────────────────────────────────────────────────────────
     BOUCLE D'ANIMATION INTERNE
     ────────────────────────────────────────────────────────── */

  /**
   * Calcule le temps total écoulé en millisecondes.
   *
   * @returns {number}
   * @private
   */
  _getTotalElapsedMs() {
    let total = this._elapsedBeforePause;

    if (this._state === TIMER_STATE.RUNNING && this._startTime !== null) {
      total += performance.now() - this._startTime;
    }

    return total;
  }

  /**
   * Programme le prochain tick via requestAnimationFrame.
   * @private
   */
  _scheduleNextTick() {
    this._rafId = requestAnimationFrame(this._tick);
  }

  /**
   * Callback de requestAnimationFrame.
   * Appelé ~60 fois par seconde pendant que le timer tourne.
   *
   * @private
   */
  _tick() {
    // Vérifier que le timer est toujours en cours
    if (this._state !== TIMER_STATE.RUNNING) return;

    const remaining = this.getRemaining();
    const fraction = this.getFraction();

    // Timer terminé ?
    if (remaining <= 0) {
      this._state = TIMER_STATE.COMPLETE;
      this._fireTick(0, 1);
      this._fireComplete();
      return;
    }

    // Notifier le tick
    this._fireTick(remaining, fraction);

    // Vérifier le seuil de warning
    if (!this._warningFired && remaining <= WARNING_THRESHOLD) {
      this._warningFired = true;
      this._fireWarning();
    }

    // Programmer le prochain tick
    this._scheduleNextTick();
  }

  /**
   * Annule l'animation requestAnimationFrame en cours.
   * @private
   */
  _cancelAnimation() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }


  /* ──────────────────────────────────────────────────────────
     DÉCLENCHEMENT DES CALLBACKS
     ────────────────────────────────────────────────────────── */

  /**
   * Déclenche le callback onTick.
   * Optimisation : n'appelle que lorsque la seconde entière change
   * ou que le fraction change significativement.
   *
   * @param {number} remaining — Secondes restantes
   * @param {number} fraction  — Fraction écoulée (0-1)
   * @private
   */
  _fireTick(remaining, fraction) {
    if (!this._onTick) return;

    // Toujours notifier pour l'animation fluide du cercle SVG
    // mais les infos de seconde sont optimisées
    const wholeSecond = Math.ceil(remaining);
    const secondChanged = wholeSecond !== this._lastWholeSecond;

    if (secondChanged) {
      this._lastWholeSecond = wholeSecond;
    }

    try {
      this._onTick({
        remaining,
        fraction,
        formattedTime: this.formatRemaining(remaining),
        wholeSecond,
        secondChanged,
        isCritical: remaining <= WARNING_THRESHOLD && remaining > 0
      });
    } catch (error) {
      console.error('RestTimer: erreur dans onTick :', error);
    }
  }

  /**
   * Déclenche le callback onWarning.
   * @private
   */
  _fireWarning() {
    if (!this._onWarning) return;

    try {
      this._onWarning();
    } catch (error) {
      console.error('RestTimer: erreur dans onWarning :', error);
    }
  }

  /**
   * Déclenche le callback onComplete.
   * @private
   */
  _fireComplete() {
    if (!this._onComplete) return;

    try {
      this._onComplete();
    } catch (error) {
      console.error('RestTimer: erreur dans onComplete :', error);
    }
  }
}


/* ──────────────────────────────────────────────────────────────
   UTILITAIRES SVG POUR LE TIMER CIRCULAIRE
   
   Fonctions helper pour mettre à jour le cercle SVG
   depuis le callback onTick du timer.
   
   Découplées de la classe RestTimer pour respecter
   la séparation des responsabilités :
   - RestTimer = logique de décompte pure
   - SVG helpers = aide au rendu visuel
   ────────────────────────────────────────────────────────────── */

/** Circonférence du cercle SVG (2 × π × rayon) avec r=54 */
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 54; // ≈ 339.29

/**
 * Calcule le stroke-dashoffset pour un cercle SVG de progression.
 *
 * @param {number} fraction — Fraction écoulée (0 = plein, 1 = vide)
 * @returns {number} Valeur de stroke-dashoffset
 */
export function calculateDashOffset(fraction) {
  return CIRCLE_CIRCUMFERENCE * fraction;
}

/**
 * Met à jour un élément SVG circle avec le dashoffset calculé.
 *
 * @param {SVGCircleElement} circleElement — Élément <circle> SVG
 * @param {number} fraction — Fraction écoulée (0 = plein, 1 = vide)
 */
export function updateCircleProgress(circleElement, fraction) {
  if (!circleElement) return;
  circleElement.style.strokeDashoffset = calculateDashOffset(fraction);
}

/**
 * Met à jour l'affichage textuel du timer.
 *
 * @param {HTMLElement} timeElement — Élément affichant le temps
 * @param {string} formattedTime   — Temps formaté ("M:SS")
 */
export function updateTimeDisplay(timeElement, formattedTime) {
  if (!timeElement) return;
  timeElement.textContent = formattedTime;
}

/**
 * Met à jour la classe CSS "critical" sur le conteneur du timer.
 *
 * @param {HTMLElement} timerContainer — Conteneur .timer
 * @param {boolean} isCritical — Vrai si < seuil critique
 */
export function updateCriticalState(timerContainer, isCritical) {
  if (!timerContainer) return;
  timerContainer.classList.toggle('timer--critical', isCritical);
}

/**
 * Applique toutes les mises à jour visuelles du timer en une fois.
 * Fonction de convenance pour session.js.
 *
 * @param {Object} elements — Éléments DOM du timer
 * @param {SVGCircleElement} elements.circle    — Cercle SVG de progression
 * @param {HTMLElement}      elements.timeText  — Texte du temps
 * @param {HTMLElement}      elements.container — Conteneur .timer
 * @param {Object} tickData — Données du tick (retournées par onTick)
 */
export function updateTimerUI(elements, tickData) {
  if (!elements || !tickData) return;

  updateCircleProgress(elements.circle, tickData.fraction);
  updateTimeDisplay(elements.timeText, tickData.formattedTime);
  updateCriticalState(elements.container, tickData.isCritical);
}


/**
 * Retourne la circonférence du cercle SVG.
 * Utile pour initialiser le stroke-dasharray dans le HTML/CSS.
 *
 * @returns {number}
 */
export function getCircleCircumference() {
  return CIRCLE_CIRCUMFERENCE;
}


// ── Export ──

export { RestTimer, TIMER_STATE, WARNING_THRESHOLD };
export default RestTimer;