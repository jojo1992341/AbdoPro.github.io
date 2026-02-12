/* ════════════════════════════════════════════════════════════════
   AbdoPro — screens/settings.js
   
   Responsabilité unique : gestion des préférences et des données.
   ─────────────────────────────────────────────────────────────
   Contenu :
   1. Préférences (Sons, Vibrations, Thème, Auto-start).
   2. Gestion des données (Export JSON, Import, Reset complet).
   3. Crédits scientifiques (Sources des algorithmes).
   ════════════════════════════════════════════════════════════════ */

import state from '../state.js';
import { exportData, importData } from '../utils/export.js';

const SettingsScreen = {
  _container: null,
  _abortController: null,

  async render(container, params) {
    this._container = container;
    this._abortController = new AbortController();

    this._renderUI();
  },

  destroy() {
    if (this._abortController) {
      this._abortController.abort();
    }
    this._container = null;
  },

  _renderUI() {
    const settings = state.getSettings();

    this._container.innerHTML = `
      <div class="screen">
        <header class="screen-header">
          <span class="screen-header__subtitle">Configuration</span>
          <h1 class="screen-header__title">Réglages</h1>
        </header>

        <!-- 1. PRÉFÉRENCES (Composants Section 11) -->
        <section class="card mb-6">
          <div class="card__header">
            <h3 class="card__title text-sm">Préférences</h3>
          </div>
          <div class="card__body">
            ${this._buildToggle('soundEnabled', '🔊 Son fin de repos', settings.soundEnabled)}
            ${this._buildToggle('vibrationEnabled', '📳 Vibrations', settings.vibrationEnabled)}
            ${this._buildToggle('theme', '🌙 Thème Sombre', settings.theme === 'dark')}
            ${this._buildToggle('restTimerAutoStart', '⏱️ Auto-start repos', settings.restTimerAutoStart)}
          </div>
        </section>

        <!-- 2. DONNÉES (Actions de maintenance) -->
        <section class="card mb-6">
          <div class="card__header">
            <h3 class="card__title text-sm">Gestion des données</h3>
          </div>
          <div class="card__body gap-3">
            <button class="btn btn-ghost btn-block" data-action="export">📤 Exporter (JSON)</button>
            <button class="btn btn-ghost btn-block" data-action="import">📥 Importer (JSON)</button>
            <button class="btn btn-danger btn-block" data-action="reset">⚠️ Réinitialiser l'application</button>
          </div>
        </section>

        <!-- 3. CRÉDITS (Composants Section 17) -->
        <details class="accordion mb-8">
          <summary class="accordion__header">
            <span class="accordion__title">ℹ️ Crédits scientifiques</span>
            <span class="accordion__chevron">▶</span>
          </summary>
          <div class="accordion__content text-sm text-secondary">
            <p class="mb-2"><strong>Prilepin (1974) :</strong> Gestion de l'intensité relative.</p>
            <p class="mb-2"><strong>Banister (1975) :</strong> Modèle Fitness-Fatigue.</p>
            <p class="mb-2"><strong>Rhea (2002) :</strong> Périodisation ondulatoire (DUP).</p>
            <p class="mb-2"><strong>Zourdos (2016) :</strong> Répétitions en réserve (RIR).</p>
            <p><strong>Mann (2010) :</strong> Régression APRE.</p>
          </div>
        </details>

        <div class="text-center p-4">
          <p class="text-muted text-xs">AbdoPro v4.6 — Open Source</p>
        </div>
      </div>
    `;

    this._attachEvents();
  },

  _buildToggle(id, label, isChecked) {
    return `
      <label class="toggle">
        <span class="toggle__label">${label}</span>
        <input type="checkbox" class="toggle__input" data-setting="${id}" ${isChecked ? 'checked' : ''}>
        <span class="toggle__slider"></span>
      </label>
    `;
  },

  _attachEvents() {
    const signal = this._abortController.signal;

    // Gestion des Toggles
    this._container.addEventListener('change', async (e) => {
      const input = e.target.closest('[data-setting]');
      if (!input) return;

      const key = input.dataset.setting;
      let value = input.checked;

      // Cas spécial pour le thème (string au lieu de boolean)
      if (key === 'theme') {
        value = input.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', value);
      }

      await state.updateSettings({ [key]: value });
    }, { signal });

    // Gestion des Actions (Boutons)
    this._container.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;

      switch (action) {
        case 'export':
          await exportData();
          break;
        case 'import':
          if (confirm("L'importation remplacera toutes vos données actuelles. Continuer ?")) {
            try {
              await importData();
              window.location.reload();
            } catch (err) {
              alert("Erreur lors de l'importation : " + err.message);
            }
          }
          break;
        case 'reset':
          if (confirm("⚠️ ATTENTION : Cela supprimera définitivement toute votre progression. Confirmer ?")) {
            const safety = prompt("Tapez 'SUPPRIMER' pour valider.");
            if (safety === 'SUPPRIMER') {
              await state.reset();
              window.location.reload();
            }
          }
          break;
      }
    }, { signal });
  }
};

export default SettingsScreen;