/* ════════════════════════════════════════════════════════════════
   AbdoPro — utils/notifications.js

   Responsabilité unique : retour sensoriel (son + vibration).
   ─────────────────────────────────────────────────────────────
   Encapsule les API navigateur pour le son et la vibration.
   Gère les contraintes d'autoplay mobile (iOS/Android).
   Respecte les préférences utilisateur via state.js.

   ─────────────────────────────────────────────────────────────
   Contraintes mobile :
   - iOS Safari bloque l'audio tant qu'il n'y a pas eu
     d'interaction utilisateur (tap/click). On "unlock" l'audio
     au premier geste.
   - navigator.vibrate() n'existe pas sur iOS.
   - L'API Vibration est ignorée si le téléphone est en silencieux
     sur certains Android.

   ─────────────────────────────────────────────────────────────
   API publique :

     notifications.init()              → Prépare l'audio
     notifications.unlock()            → Déverrouille l'autoplay (appeler sur interaction)

     notifications.playBeep()          → Son de fin de repos
     notifications.playSuccess()       → Son de succès (séance terminée)

     notifications.vibrate(pattern)    → Vibration personnalisée
     notifications.vibrateShort()      → Vibration courte (fin de repos)
     notifications.vibrateLong()       → Vibration longue (séance terminée)
     notifications.vibrateWarning()    → Double vibration (warning)

     notifications.notifyTimerEnd()    → Son + vibration fin de repos
     notifications.notifyTimerWarning()→ Vibration warning
     notifications.notifySessionEnd()  → Son + vibration séance terminée
     notifications.notifyImpossible()  → Vibration erreur

     notifications.isAudioUnlocked()   → Audio déverrouillé ?
     notifications.isVibrationSupported() → Vibration disponible ?
   ════════════════════════════════════════════════════════════════ */

import state from '../state.js';


// ── Constantes ──

/** Patterns de vibration en millisecondes [vibrer, pause, vibrer, ...] */
const VIBRATION_PATTERNS = {
  SHORT:    [100],
  LONG:     [300],
  DOUBLE:   [100, 80, 100],
  WARNING:  [50, 50, 50],
  SUCCESS:  [100, 50, 200],
  ERROR:    [200, 100, 200, 100, 200]
};

Object.freeze(VIBRATION_PATTERNS);

/** ID de l'élément audio dans index.html */
const BEEP_ELEMENT_ID = 'beep-sound';


// ── Classe Notifications ──

class Notifications {

  constructor() {
    /** @type {HTMLAudioElement|null} Élément audio pour le beep */
    this._beepAudio = null;

    /** @type {AudioContext|null} Contexte audio pour sons synthétiques */
    this._audioContext = null;

    /** @type {boolean} Audio déverrouillé par une interaction utilisateur */
    this._audioUnlocked = false;

    /** @type {boolean} Init effectué */
    this._initialized = false;

    /** @type {Function|null} Référence au handler d'unlock (pour cleanup) */
    this._unlockHandler = null;
  }


  /* ──────────────────────────────────────────────────────────
     INITIALISATION
     ────────────────────────────────────────────────────────── */

  /**
   * Initialise le système de notifications.
   * Récupère l'élément audio et prépare le déverrouillage.
   */
  init() {
    if (this._initialized) return;

    // Récupérer l'élément <audio> de index.html
    this._beepAudio = document.getElementById(BEEP_ELEMENT_ID);

    if (this._beepAudio) {
      // Pré-charger le son
      this._beepAudio.load();
    }

    // Préparer le déverrouillage audio sur la première interaction
    this._setupAutoUnlock();

    this._initialized = true;
  }

  /**
   * Configure le déverrouillage automatique de l'audio
   * au premier geste utilisateur.
   *
   * Sur iOS, l'audio ne peut être joué qu'après une interaction
   * utilisateur (tap, click). On écoute les événements d'interaction
   * et on "joue" un son silencieux pour débloquer l'API.
   *
   * @private
   */
  _setupAutoUnlock() {
    if (this._audioUnlocked) return;

    this._unlockHandler = () => this.unlock();

    const events = ['touchstart', 'touchend', 'click', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, this._unlockHandler, {
        once: false,
        passive: true,
        capture: true
      });
    });
  }

  /**
   * Déverrouille l'autoplay audio.
   * Appelé automatiquement au premier geste, ou manuellement.
   */
  unlock() {
    if (this._audioUnlocked) return;

    // Méthode 1 : Jouer et pauser immédiatement l'élément <audio>
    if (this._beepAudio) {
      const playPromise = this._beepAudio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            this._beepAudio.pause();
            this._beepAudio.currentTime = 0;
          })
          .catch(() => {
            // Silencieux — le navigateur a refusé, on réessaiera
          });
      }
    }

    // Méthode 2 : Créer un AudioContext (pour les sons synthétiques)
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass && !this._audioContext) {
        this._audioContext = new AudioContextClass();

        // Jouer un son silencieux pour débloquer
        if (this._audioContext.state === 'suspended') {
          this._audioContext.resume();
        }
      }
    } catch {
      // AudioContext non disponible — pas critique
    }

    this._audioUnlocked = true;

    // Retirer les écouteurs de déverrouillage
    this._removeUnlockListeners();
  }

  /**
   * Retire les écouteurs de déverrouillage automatique.
   * @private
   */
  _removeUnlockListeners() {
    if (!this._unlockHandler) return;

    const events = ['touchstart', 'touchend', 'click', 'keydown'];
    events.forEach(event => {
      document.removeEventListener(event, this._unlockHandler, {
        capture: true
      });
    });

    this._unlockHandler = null;
  }


  /* ──────────────────────────────────────────────────────────
     LECTURE DES PRÉFÉRENCES
     ────────────────────────────────────────────────────────── */

  /**
   * Vérifie si le son est activé dans les paramètres.
   * @returns {boolean}
   * @private
   */
  _isSoundEnabled() {
    try {
      const settings = state.getSettings();
      return settings.soundEnabled !== false;
    } catch {
      // State non initialisé — son activé par défaut
      return true;
    }
  }

  /**
   * Vérifie si la vibration est activée dans les paramètres.
   * @returns {boolean}
   * @private
   */
  _isVibrationEnabled() {
    try {
      const settings = state.getSettings();
      return settings.vibrationEnabled !== false;
    } catch {
      return true;
    }
  }


  /* ──────────────────────────────────────────────────────────
     SON
     ────────────────────────────────────────────────────────── */

  /**
   * Joue le son de beep (fin de repos).
   *
   * Utilise l'élément <audio> de index.html.
   * Fallback sur un son synthétique via AudioContext.
   */
  playBeep() {
    if (!this._isSoundEnabled()) return;

    if (this._beepAudio) {
      this._playAudioElement(this._beepAudio);
    } else {
      this._playSyntheticBeep(800, 0.2);
    }
  }

  /**
   * Joue un son de succès (séance terminée).
   *
   * Son synthétique : deux tons ascendants.
   */
  playSuccess() {
    if (!this._isSoundEnabled()) return;

    this._playSyntheticSequence([
      { frequency: 523, duration: 0.15 },  // Do
      { frequency: 659, duration: 0.15 },  // Mi
      { frequency: 784, duration: 0.25 }   // Sol
    ]);
  }

  /**
   * Joue un élément <audio> depuis le début.
   *
   * @param {HTMLAudioElement} audioElement
   * @private
   */
  _playAudioElement(audioElement) {
    try {
      // Rembobiner au début
      audioElement.currentTime = 0;

      const playPromise = audioElement.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          // Autoplay bloqué — fallback synthétique
          console.warn('Audio bloqué, fallback synthétique :', error.message);
          this._playSyntheticBeep(800, 0.2);
        });
      }
    } catch (error) {
      console.warn('Erreur audio :', error.message);
    }
  }

  /**
   * Joue un beep synthétique via AudioContext.
   *
   * @param {number} frequency — Fréquence en Hz
   * @param {number} duration  — Durée en secondes
   * @private
   */
  _playSyntheticBeep(frequency, duration) {
    if (!this._audioContext) return;

    try {
      // Réactiver le contexte si suspendu
      if (this._audioContext.state === 'suspended') {
        this._audioContext.resume();
      }

      const oscillator = this._audioContext.createOscillator();
      const gainNode = this._audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this._audioContext.destination);

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      // Envelope : attaque rapide, release douce
      const now = this._audioContext.currentTime;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch (error) {
      console.warn('Erreur synthèse audio :', error.message);
    }
  }

  /**
   * Joue une séquence de tons synthétiques.
   *
   * @param {Array<{frequency: number, duration: number}>} notes
   * @private
   */
  _playSyntheticSequence(notes) {
    if (!this._audioContext) return;

    try {
      if (this._audioContext.state === 'suspended') {
        this._audioContext.resume();
      }

      let offset = this._audioContext.currentTime;

      notes.forEach(note => {
        const oscillator = this._audioContext.createOscillator();
        const gainNode = this._audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this._audioContext.destination);

        oscillator.type = 'sine';
        oscillator.frequency.value = note.frequency;

        gainNode.gain.setValueAtTime(0, offset);
        gainNode.gain.linearRampToValueAtTime(0.25, offset + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, offset + note.duration);

        oscillator.start(offset);
        oscillator.stop(offset + note.duration);

        offset += note.duration;
      });
    } catch (error) {
      console.warn('Erreur séquence audio :', error.message);
    }
  }


  /* ──────────────────────────────────────────────────────────
     VIBRATION
     ────────────────────────────────────────────────────────── */

  /**
   * Déclenche une vibration avec un pattern personnalisé.
   *
   * @param {number[]} pattern — [vibrer, pause, vibrer, ...] en ms
   * @returns {boolean} True si la vibration a été déclenchée
   */
  vibrate(pattern) {
    if (!this._isVibrationEnabled()) return false;
    if (!this.isVibrationSupported()) return false;

    try {
      return navigator.vibrate(pattern);
    } catch {
      return false;
    }
  }

  /**
   * Vibration courte — fin de repos.
   */
  vibrateShort() {
    this.vibrate(VIBRATION_PATTERNS.SHORT);
  }

  /**
   * Vibration longue — séance terminée.
   */
  vibrateLong() {
    this.vibrate(VIBRATION_PATTERNS.LONG);
  }

  /**
   * Double vibration — warning (timer < 5s).
   */
  vibrateWarning() {
    this.vibrate(VIBRATION_PATTERNS.WARNING);
  }

  /**
   * Vibration de succès — séance complétée.
   */
  vibrateSuccess() {
    this.vibrate(VIBRATION_PATTERNS.SUCCESS);
  }

  /**
   * Vibration d'erreur — impossible.
   */
  vibrateError() {
    this.vibrate(VIBRATION_PATTERNS.ERROR);
  }

  /**
   * Arrête toute vibration en cours.
   */
  vibrateStop() {
    if (this.isVibrationSupported()) {
      try {
        navigator.vibrate(0);
      } catch {
        // Silencieux
      }
    }
  }


  /* ──────────────────────────────────────────────────────────
     NOTIFICATIONS COMPOSITES
     
     Combinaisons son + vibration pour chaque événement métier.
     C'est l'API que les écrans doivent utiliser.
     ────────────────────────────────────────────────────────── */

  /**
   * Notification de fin de repos.
   * Son beep + vibration courte.
   */
  notifyTimerEnd() {
    this.playBeep();
    this.vibrateShort();
  }

  /**
   * Notification de warning timer (< 5 secondes).
   * Vibration warning uniquement (pas de son pour ne pas surprendre).
   */
  notifyTimerWarning() {
    this.vibrateWarning();
  }

  /**
   * Notification de séance terminée avec succès.
   * Son de succès + vibration longue.
   */
  notifySessionEnd() {
    this.playSuccess();
    this.vibrateSuccess();
  }

  /**
   * Notification de séance impossible.
   * Vibration d'erreur uniquement.
   */
  notifyImpossible() {
    this.vibrateError();
  }

  /**
   * Notification de test max enregistré.
   * Son de succès + vibration courte.
   */
  notifyTestMaxSaved() {
    this.playSuccess();
    this.vibrateShort();
  }


  /* ──────────────────────────────────────────────────────────
     ÉTAT & CAPACITÉS
     ────────────────────────────────────────────────────────── */

  /**
   * Vérifie si l'audio a été déverrouillé.
   * @returns {boolean}
   */
  isAudioUnlocked() {
    return this._audioUnlocked;
  }

  /**
   * Vérifie si l'API Vibration est supportée.
   * @returns {boolean}
   */
  isVibrationSupported() {
    return 'vibrate' in navigator;
  }

  /**
   * Vérifie si l'AudioContext est disponible.
   * @returns {boolean}
   */
  isAudioContextSupported() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  /**
   * Retourne un diagnostic des capacités audio/vibration.
   * Utile pour les paramètres (afficher ce qui est disponible).
   *
   * @returns {Object}
   */
  getCapabilities() {
    return {
      audioElement: !!this._beepAudio,
      audioContext: this.isAudioContextSupported(),
      audioUnlocked: this._audioUnlocked,
      vibration: this.isVibrationSupported(),
      soundEnabled: this._isSoundEnabled(),
      vibrationEnabled: this._isVibrationEnabled()
    };
  }


  /* ──────────────────────────────────────────────────────────
     NETTOYAGE
     ────────────────────────────────────────────────────────── */

  /**
   * Nettoie toutes les ressources.
   */
  destroy() {
    this._removeUnlockListeners();
    this.vibrateStop();

    if (this._audioContext) {
      try {
        this._audioContext.close();
      } catch {
        // Silencieux
      }
      this._audioContext = null;
    }

    this._beepAudio = null;
    this._initialized = false;
    this._audioUnlocked = false;
  }
}


// ── Export singleton ──

const notifications = new Notifications();

export { notifications, VIBRATION_PATTERNS };

export default notifications;
