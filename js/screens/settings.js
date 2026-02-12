// js/screens/settings.js
// ─────────────────────────────────────────────────────────
// Paramètres de l'application.
//
// Gère les préférences utilisateur (toggles), les opérations
// de données (export/import/reset), et affiche les crédits
// scientifiques. Aucune logique métier d'entraînement ici.
//
// Dépendances : State (js/state.js)
//               ExportManager, DB — chargés dynamiquement
// Route :       #/settings
// ─────────────────────────────────────────────────────────

import state from '../state.js';

// ── Configuration ──────────────────────────────────────────

const APP_VERSION = '1.0.0';

const TOGGLES = Object.freeze([
  {
    key: 'soundEnabled',
    icon: '🔊',
    label: 'Son fin de repos',
    description: 'Joue un bip à la fin du chronomètre de repos',
  },
  {
    key: 'vibrationEnabled',
    icon: '📳',
    label: 'Vibration',
    description: 'Vibre à la fin du chronomètre de repos',
  },
  {
    key: 'theme',
    icon: '🌙',
    label: 'Thème sombre',
    description: 'Bascule entre le thème clair et sombre',
    isThemeToggle: true,
  },
  {
    key: 'restTimerAutoStart',
    icon: '⏱',
    label: 'Auto-start repos',
    description: 'Démarre le chronomètre automatiquement après une série',
  },
]);

const SCIENTIFIC_CREDITS = Object.freeze([
  {
    algorithm: 'Progression Linéaire Périodisée',
    source: 'Prilepin A.S. (1974)',
    detail: 'Tables de Prilepin — plages optimales de volume en fonction de l\'intensité relative. Recherche soviétique en haltérophilie.',
  },
  {
    algorithm: 'Surcompensation Exponentielle',
    source: 'Banister E.W. (1975)',
    detail: 'Modèle fitness-fatigue — "Training Theory and Methods". La performance est la différence entre fitness accumulée et fatigue résiduelle.',
  },
  {
    algorithm: 'Periodisation Ondulatoire (DUP)',
    source: 'Rhea M.R. et al. (2002)',
    detail: '"A comparison of linear and daily undulating periodized programs with equated volume and intensity for strength." Journal of Strength and Conditioning Research.',
  },
  {
    algorithm: 'Répétitions en Réserve (RIR)',
    source: 'Zourdos M.C. et al. (2016)',
    detail: '"Novel Resistance Training–Specific Rating of Perceived Exertion Scale Measuring Repetitions in Reserve." Journal of Strength and Conditioning Research.',
  },
  {
    algorithm: 'Régression Adaptative (APRE)',
    source: 'Mann J.B. et al. (2010)',
    detail: '"The effect of autoregulatory progressive resistance exercise vs. linear periodization on strength improvement in college athletes." Journal of Strength and Conditioning Research.',
  },
]);

const RESET_CONFIRMATION_TEXT = 'SUPPRIMER';
const ENTRY_STAGGER_MS = 60;

// ── Classe Principale ──────────────────────────────────────

export class SettingsScreen {

  constructor() {
    this._container = null;
    this._settings = null;
    this._isProcessing = false;
    this._boundClickHandler = null;
    this._boundChangeHandler = null;
    this._fileInputRef = null;
    this._navigate = null;
  }

  // ── Lifecycle ──────────────────────────────────────────

  /**
   * Point d'entrée. Charge les paramètres, rend le HTML,
   * attache les événements.
   * @param {HTMLElement} container
   */
  async render(container, params = {}) {
    this._navigate = params.navigateTo || null;
    this._container = container;
    await this._loadSettings();

    this._container.innerHTML = this._buildHTML();
    this._attachEvents();
    this._animateEntry();
  }

  /**
   * Nettoyage complet avant démontage par le routeur.
   */
  destroy() {
    this._detachEvents();
    this._container = null;
    this._settings = null;
    this._isProcessing = false;
    this._fileInputRef = null;
    this._navigate = null;
  }

  // ── Chargement ─────────────────────────────────────────

  async _loadSettings() {
    const user = state.getProfile();
    this._settings = user?.settings || {
      soundEnabled: true,
      vibrationEnabled: true,
      theme: 'dark',
      restTimerAutoStart: true,
    };
  }

  // ── Construction HTML — Structure Principale ───────────

  _buildHTML() {
    return `
      <div class="screen screen--settings" role="main" aria-labelledby="settings-title">

        <header class="screen__header">
          <button class="btn btn--icon btn--back" data-action="back"
                  type="button" aria-label="Retour au tableau de bord">←</button>
          <h1 id="settings-title" class="screen__title">
            <span aria-hidden="true">⚙</span> Paramètres
          </h1>
        </header>

        ${this._buildTogglesSection()}
        ${this._buildDataSection()}
        ${this._buildAboutSection()}
        ${this._buildCreditsSection()}

      </div>
    `;
  }

  // ── Section Toggles ────────────────────────────────────

  _buildTogglesSection() {
    return `
      <section class="card card--toggles" aria-label="Préférences">
        ${TOGGLES.map(toggle => this._buildToggleRow(toggle)).join('')}
      </section>
    `;
  }

  _buildToggleRow(toggle) {
    const isChecked = this._resolveToggleState(toggle);
    const inputId = `toggle-${toggle.key}`;

    return `
      <div class="toggle-row">
        <label class="toggle-row__label" for="${inputId}">
          <span class="toggle-row__icon" aria-hidden="true">${toggle.icon}</span>
          <span class="toggle-row__text">
            <span class="toggle-row__title">${toggle.label}</span>
            <span class="toggle-row__description">${toggle.description}</span>
          </span>
        </label>
        <div class="toggle-switch">
          <input
            type="checkbox"
            id="${inputId}"
            class="toggle-switch__input"
            data-setting="${toggle.key}"
            ${isChecked ? 'checked' : ''}
            role="switch"
            aria-checked="${isChecked}"
          />
          <span class="toggle-switch__slider" aria-hidden="true"></span>
        </div>
      </div>
    `;
  }

  /**
   * Résout l'état booléen d'un toggle.
   * Cas spécial : le thème est "dark"/"light", pas un booléen.
   */
  _resolveToggleState(toggle) {
    if (toggle.isThemeToggle) {
      return this._settings.theme === 'dark';
    }
    return Boolean(this._settings[toggle.key]);
  }

  // ── Section Données ────────────────────────────────────

  _buildDataSection() {
    return `
      <section class="card card--data" aria-label="Gestion des données">
        <h2 class="card__subtitle">Données</h2>

        <div class="data-actions">
          <button class="btn btn--secondary btn--data"
                  data-action="export" type="button">
            <span aria-hidden="true">📤</span> Exporter (JSON)
          </button>

          <button class="btn btn--secondary btn--data"
                  data-action="import-trigger" type="button">
            <span aria-hidden="true">📥</span> Importer (JSON)
          </button>
          <input
            type="file"
            accept=".json,application/json"
            class="data-actions__file-input visually-hidden"
            aria-label="Sélectionner un fichier JSON à importer"
            tabindex="-1"
          />

          <button class="btn btn--danger btn--data"
                  data-action="reset" type="button">
            <span aria-hidden="true">🗑</span> Réinitialiser
          </button>
        </div>
      </section>
    `;
  }

  // ── Section À Propos ───────────────────────────────────

  _buildAboutSection() {
    return `
      <section class="card card--about" aria-label="À propos">
        <h2 class="card__subtitle">À propos</h2>
        <dl class="about-list">
          <div class="about-list__row">
            <dt>Version</dt>
            <dd>${APP_VERSION}</dd>
          </div>
          <div class="about-list__row">
            <dt>Hébergement</dt>
            <dd>GitHub Pages</dd>
          </div>
          <div class="about-list__row">
            <dt>Stockage</dt>
            <dd>Données stockées localement sur votre appareil</dd>
          </div>
        </dl>
      </section>
    `;
  }

  // ── Section Crédits Scientifiques ──────────────────────

  _buildCreditsSection() {
    return `
      <section class="card card--credits" aria-label="Crédits scientifiques">
        <button
          class="credits__toggle"
          data-action="toggle-credits"
          type="button"
          aria-expanded="false"
          aria-controls="credits-panel"
        >
          <span aria-hidden="true">ℹ</span> Crédits scientifiques
          <span class="credits__chevron" aria-hidden="true">▶</span>
        </button>

        <div id="credits-panel" class="credits__panel" hidden>
          ${SCIENTIFIC_CREDITS.map(c => this._buildCreditItem(c)).join('')}
        </div>
      </section>
    `;
  }

  _buildCreditItem(credit) {
    return `
      <article class="credit-item">
        <h3 class="credit-item__algorithm">${credit.algorithm}</h3>
        <p class="credit-item__source">${credit.source}</p>
        <p class="credit-item__detail">${credit.detail}</p>
      </article>
    `;
  }

  // ── Gestion des Événements ─────────────────────────────

  _attachEvents() {
    this._boundClickHandler = (e) => this._onContainerClick(e);
    this._boundChangeHandler = (e) => this._onToggleChange(e);

    this._container.addEventListener('click', this._boundClickHandler);
    this._container.addEventListener('change', this._boundChangeHandler);

    this._fileInputRef = this._container.querySelector('.data-actions__file-input');
    if (this._fileInputRef) {
      this._fileInputRef.addEventListener('change', (e) => this._onFileSelected(e));
    }
  }

  _detachEvents() {
    if (this._boundClickHandler) {
      this._container?.removeEventListener('click', this._boundClickHandler);
      this._boundClickHandler = null;
    }
    if (this._boundChangeHandler) {
      this._container?.removeEventListener('change', this._boundChangeHandler);
      this._boundChangeHandler = null;
    }
    this._fileInputRef = null;
    this._navigate = null;
  }

  _onContainerClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    switch (target.dataset.action) {
      case 'back':
        this._navigateTo('dashboard');
        break;
      case 'export':
        this._onExport();
        break;
      case 'import-trigger':
        this._triggerFileInput();
        break;
      case 'reset':
        this._onReset();
        break;
      case 'toggle-credits':
        this._toggleCreditsPanel(target);
        break;
    }
  }

  // ── Toggles — Changement de Préférence ─────────────────

  /**
   * Réagit au changement d'un toggle.
   * Met à jour le setting dans State ET applique l'effet
   * immédiat correspondant (ex: thème).
   */
  async _onToggleChange(event) {
    const input = event.target;
    if (!input.matches('.toggle-switch__input')) return;

    const settingKey = input.dataset.setting;
    if (!settingKey) return;

    const toggleConfig = TOGGLES.find(t => t.key === settingKey);
    if (!toggleConfig) return;

    const newValue = this._computeNewValue(toggleConfig, input.checked);

    input.setAttribute('aria-checked', String(input.checked));

    this._settings[settingKey] = newValue;
    await state.updateSettings({ ...this._settings, [settingKey]: newValue });

    this._applyImmediateEffect(settingKey, newValue);
  }

  /**
   * Calcule la nouvelle valeur d'un setting.
   * Le thème est un cas spécial : checked=true → "dark", false → "light".
   */
  _computeNewValue(toggleConfig, isChecked) {
    if (toggleConfig.isThemeToggle) {
      return isChecked ? 'dark' : 'light';
    }
    return isChecked;
  }

  /**
   * Applique les effets secondaires immédiats d'un changement de setting.
   * Seul le thème a un effet visuel instantané. Les autres settings
   * sont lus à la demande par les modules concernés (timer, notifications).
   */
  _applyImmediateEffect(settingKey, value) {
    if (settingKey === 'theme') {
      document.documentElement.setAttribute('data-theme', value);
    }
  }

  // ── Export ─────────────────────────────────────────────

  async _onExport() {
    if (this._isProcessing) return;
    this._isProcessing = true;

    try {
      const { exportData } = await import('../utils/export.js');
      await exportData();
      this._showToast('Données exportées avec succès.');
    } catch (error) {
      this._showToast('Erreur lors de l\'export.', 'error');
    } finally {
      this._isProcessing = false;
    }
  }

  // ── Import ─────────────────────────────────────────────

  _triggerFileInput() {
    if (this._fileInputRef) {
      this._fileInputRef.value = '';
      this._fileInputRef.click();
    }
  }

  async _onFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (this._isProcessing) return;
    this._isProcessing = true;

    try {
      const text = await this._readFileAsText(file);
      const data = this._parseAndValidateJSON(text);

      const confirmed = await this._confirmAction(
        'Importer des données',
        'Cette action remplacera toutes vos données actuelles. Voulez-vous continuer ?'
      );
      if (!confirmed) return;

      await state.importData(data);

      this._showToast('Données importées avec succès. Rechargement…');
      setTimeout(() => window.location.reload(), 1000);

    } catch (error) {
      this._showToast(
        error.message || 'Fichier invalide ou corrompu.',
        'error'
      );
    } finally {
      this._isProcessing = false;
    }
  }

  /**
   * Lit un fichier File en texte brut via FileReader (promisifié).
   * @param {File} file
   * @returns {Promise<string>}
   */
  _readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
      reader.readAsText(file);
    });
  }

  /**
   * Parse et valide le JSON importé.
   * Vérifie la présence des champs structurels obligatoires.
   * @throws {Error} si la structure est invalide.
   */
  _parseAndValidateJSON(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Le fichier n\'est pas un JSON valide.');
    }

    const requiredKeys = ['appVersion', 'user', 'weeks', 'sessions'];
    const missingKeys = requiredKeys.filter(k => !(k in data));

    if (missingKeys.length > 0) {
      throw new Error(
        `Format invalide. Champs manquants : ${missingKeys.join(', ')}.`
      );
    }

    if (!Array.isArray(data.weeks) || !Array.isArray(data.sessions)) {
      throw new Error('Les champs "weeks" et "sessions" doivent être des tableaux.');
    }

    return data;
  }

  // ── Reset ──────────────────────────────────────────────

  async _onReset() {
    if (this._isProcessing) return;

    const firstConfirm = await this._confirmAction(
      'Réinitialiser l\'application',
      'Toutes vos données de progression seront définitivement supprimées.'
    );
    if (!firstConfirm) return;

    const secondConfirm = await this._confirmDestructive(
      `Pour confirmer, tapez "${RESET_CONFIRMATION_TEXT}" ci-dessous.`
    );
    if (!secondConfirm) return;

    this._isProcessing = true;

    try {
      const { default: db } = await import('../db.js');
      await db.clearAll();

      this._showToast('Données supprimées. Rechargement…');
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      this._showToast('Erreur lors de la réinitialisation.', 'error');
    } finally {
      this._isProcessing = false;
    }
  }

  // ── Crédits Panel ──────────────────────────────────────

  _toggleCreditsPanel(toggleButton) {
    const panel = this._container.querySelector('#credits-panel');
    const chevron = toggleButton.querySelector('.credits__chevron');
    if (!panel) return;

    const isOpen = !panel.hidden;

    panel.hidden = isOpen;
    toggleButton.setAttribute('aria-expanded', String(!isOpen));
    chevron?.classList.toggle('credits__chevron--open', !isOpen);
  }

  // ── Dialogues de Confirmation ──────────────────────────

  /**
   * Confirmation simple via confirm() natif.
   * Suffisant pour une PWA mobile — pas de dépendance UI modale.
   * @returns {Promise<boolean>}
   */
  async _confirmAction(title, message) {
    return window.confirm(`${title}\n\n${message}`);
  }

  /**
   * Double confirmation destructive : demande à l'utilisateur
   * de taper un mot spécifique pour valider.
   * @returns {Promise<boolean>}
   */
  async _confirmDestructive(message) {
    const input = window.prompt(message);
    return input === RESET_CONFIRMATION_TEXT;
  }

  // ── Toast (Feedback Visuel) ────────────────────────────

  /**
   * Affiche un message temporaire en bas de l'écran.
   * Créé dynamiquement, supprimé après 3s.
   *
   * @param {string} message
   * @param {'success'|'error'} [type='success']
   */
  _showToast(message, type = 'success') {
    const existing = this._container?.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;

    this._container?.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('toast--visible');
    });

    setTimeout(() => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ── Animations ─────────────────────────────────────────

  _animateEntry() {
    const targets = this._container.querySelectorAll(
      '.card, .screen__header'
    );

    targets.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(16px)';

      requestAnimationFrame(() => {
        setTimeout(() => {
          el.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        }, i * ENTRY_STAGGER_MS);
      });
    });
  }

  // ── Navigation ─────────────────────────────────────────

  _navigateTo(screen) {
    if (typeof this._navigate === 'function') {
      this._navigate(screen);
      return;
    }
    window.location.hash = `#/${screen}`;
  }
}

export default new SettingsScreen();