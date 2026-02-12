/* ════════════════════════════════════════════════════════════════
   AbdoPro — db.js

   Responsabilité unique : couche d'abstraction IndexedDB.
   ─────────────────────────────────────────────────────────────
   Fournit un accès CRUD asynchrone aux 4 stores :
     1. user              → Profil et paramètres
     2. weeks             → Données hebdomadaires
     3. sessions          → Séances individuelles
     4. algorithm_history → Historique de scoring

   Aucune logique métier ici — uniquement la persistance.
   Toute la validation et la transformation de données
   sont de la responsabilité de state.js et des algorithmes.
   ─────────────────────────────────────────────────────────────
   API publique :
     Database.open()              → Ouvre/crée la base
     Database.close()             → Ferme la connexion
     Database.isReady()           → Vérifie l'état

     // CRUD générique
     db.get(store, key)           → Lit un enregistrement
     db.getAll(store)             → Lit tous les enregistrements
     db.put(store, data)          → Crée ou met à jour
     db.delete(store, key)        → Supprime un enregistrement
     db.clear(store)              → Vide un store

     // Méthodes spécialisées (raccourcis sémantiques)
     db.getProfile()              → Profil utilisateur
     db.saveProfile(data)         → Sauvegarde profil
     db.getWeek(weekNumber)       → Données d'une semaine
     db.getAllWeeks()              → Toutes les semaines (triées)
     db.saveWeek(data)            → Sauvegarde semaine
     db.getSession(weekN, dayN)   → Une séance spécifique
     db.getSessionsByWeek(weekN)  → Toutes les séances d'une semaine
     db.saveSession(data)         → Sauvegarde séance
     db.getScoringHistory()       → Historique complet de scoring
     db.saveScoringEntry(data)    → Sauvegarde un scoring

     // Utilitaires
     db.exportAll()               → Exporte toute la base en objet
     db.importAll(data)           → Importe et écrase toute la base
     db.clearAll()                → Supprime toutes les données
   ════════════════════════════════════════════════════════════════ */


// ── Constantes de la base ──

const DB_NAME = 'abdopro';
const DB_VERSION = 1;

const STORES = {
  USER: 'user',
  WEEKS: 'weeks',
  SESSIONS: 'sessions',
  ALGORITHM_HISTORY: 'algorithm_history'
};

Object.freeze(STORES);


// ── Classe Database ──

class Database {

  constructor() {
    /** @type {IDBDatabase|null} */
    this._db = null;

    /** @type {boolean} */
    this._ready = false;
  }


  /* ──────────────────────────────────────────────────────────
     CONNEXION & CYCLE DE VIE
     ────────────────────────────────────────────────────────── */

  /**
   * Ouvre la connexion IndexedDB.
   * Crée la base et les stores si c'est la première ouverture.
   * Gère les montées de version (migrations).
   *
   * @returns {Promise<Database>} L'instance connectée.
   * @throws {Error} Si IndexedDB n'est pas disponible.
   */
  async open() {
    if (this._ready && this._db) {
      return this;
    }

    if (!window.indexedDB) {
      throw new Error(
        'IndexedDB non disponible. ' +
        'Vérifiez que le navigateur supporte IndexedDB ' +
        'et que le mode privé n\'est pas actif.'
      );
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // ── Création / Migration des stores ──
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        this._createStores(db);
      };

      // ── Succès ──
      request.onsuccess = (event) => {
        this._db = event.target.result;
        this._ready = true;

        // Gérer la fermeture inattendue (ex: autre onglet upgrade)
        this._db.onversionchange = () => {
          this._db.close();
          this._db = null;
          this._ready = false;
        };

        resolve(this);
      };

      // ── Erreur ──
      request.onerror = (event) => {
        reject(new Error(
          `Impossible d'ouvrir la base de données : ${event.target.error?.message}`
        ));
      };

      // ── Bloqué (autre onglet avec ancienne version ouverte) ──
      request.onblocked = () => {
        reject(new Error(
          'La base de données est bloquée par un autre onglet. ' +
          'Fermez les autres onglets AbdoPro et réessayez.'
        ));
      };
    });
  }

  /**
   * Crée les object stores lors de la première ouverture
   * ou d'une montée de version.
   *
   * @param {IDBDatabase} db
   * @private
   */
  _createStores(db) {
    // ── Store: user ──
    // Clé manuelle (keyPath: 'id'). Un seul enregistrement : 'profile'.
    if (!db.objectStoreNames.contains(STORES.USER)) {
      db.createObjectStore(STORES.USER, { keyPath: 'id' });
    }

    // ── Store: weeks ──
    // Clé manuelle (keyPath: 'id'). Format : 'week_N'.
    // Index sur weekNumber pour les requêtes triées.
    if (!db.objectStoreNames.contains(STORES.WEEKS)) {
      const weeksStore = db.createObjectStore(STORES.WEEKS, { keyPath: 'id' });
      weeksStore.createIndex('byWeekNumber', 'weekNumber', { unique: true });
    }

    // ── Store: sessions ──
    // Clé manuelle (keyPath: 'id'). Format : 'weekN_dayM'.
    // Index sur weekNumber pour récupérer toutes les séances d'une semaine.
    // Index sur date pour les requêtes chronologiques.
    if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
      const sessionsStore = db.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
      sessionsStore.createIndex('byWeek', 'weekNumber', { unique: false });
      sessionsStore.createIndex('byDate', 'date', { unique: false });
    }

    // ── Store: algorithm_history ──
    // Clé manuelle (keyPath: 'id'). Format : 'scoring_weekN'.
    // Index sur weekNumber pour les requêtes triées.
    if (!db.objectStoreNames.contains(STORES.ALGORITHM_HISTORY)) {
      const algoStore = db.createObjectStore(STORES.ALGORITHM_HISTORY, { keyPath: 'id' });
      algoStore.createIndex('byWeekNumber', 'weekNumber', { unique: true });
    }
  }

  /**
   * Ferme proprement la connexion.
   */
  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
      this._ready = false;
    }
  }

  /**
   * Vérifie si la base est prête.
   * @returns {boolean}
   */
  isReady() {
    return this._ready && this._db !== null;
  }

  /**
   * Vérifie que la base est ouverte avant toute opération.
   * @throws {Error} Si la base n'est pas ouverte.
   * @private
   */
  _ensureReady() {
    if (!this.isReady()) {
      throw new Error(
        'Base de données non ouverte. Appelez db.open() avant toute opération.'
      );
    }
  }


  /* ──────────────────────────────────────────────────────────
     OPÉRATIONS CRUD GÉNÉRIQUES
     
     Ces méthodes encapsulent les transactions IndexedDB.
     Elles sont utilisées directement et par les méthodes
     spécialisées ci-dessous.
     ────────────────────────────────────────────────────────── */

  /**
   * Lit un enregistrement par sa clé.
   *
   * @param {string} storeName — Nom du store (utiliser STORES.*)
   * @param {string} key       — Clé primaire de l'enregistrement
   * @returns {Promise<Object|undefined>} L'enregistrement ou undefined
   */
  async get(storeName, key) {
    this._ensureReady();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(this._txError('get', storeName, request.error));
    });
  }

  /**
   * Lit tous les enregistrements d'un store.
   *
   * @param {string} storeName — Nom du store
   * @returns {Promise<Array<Object>>} Tableau de tous les enregistrements
   */
  async getAll(storeName) {
    this._ensureReady();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(this._txError('getAll', storeName, request.error));
    });
  }

  /**
   * Lit tous les enregistrements d'un index avec une valeur donnée.
   *
   * @param {string} storeName — Nom du store
   * @param {string} indexName — Nom de l'index
   * @param {*}      value     — Valeur recherchée
   * @returns {Promise<Array<Object>>}
   */
  async getAllByIndex(storeName, indexName, value) {
    this._ensureReady();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(this._txError('getAllByIndex', storeName, request.error));
    });
  }

  /**
   * Crée ou met à jour un enregistrement.
   * La clé est déterminée par le keyPath du store.
   *
   * @param {string} storeName — Nom du store
   * @param {Object} data      — Données à sauvegarder (doit contenir le keyPath)
   * @returns {Promise<string>} La clé de l'enregistrement
   */
  async put(storeName, data) {
    this._ensureReady();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(this._txError('put', storeName, request.error));
    });
  }

  /**
   * Supprime un enregistrement par sa clé.
   *
   * @param {string} storeName — Nom du store
   * @param {string} key       — Clé primaire
   * @returns {Promise<void>}
   */
  async delete(storeName, key) {
    this._ensureReady();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(this._txError('delete', storeName, request.error));
    });
  }

  /**
   * Vide entièrement un store.
   *
   * @param {string} storeName — Nom du store
   * @returns {Promise<void>}
   */
  async clear(storeName) {
    this._ensureReady();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(this._txError('clear', storeName, request.error));
    });
  }

  /**
   * Compte le nombre d'enregistrements dans un store.
   *
   * @param {string} storeName — Nom du store
   * @returns {Promise<number>}
   */
  async count(storeName) {
    this._ensureReady();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(this._txError('count', storeName, request.error));
    });
  }

  /**
   * Génère une erreur formatée pour les transactions.
   *
   * @param {string} operation — Nom de l'opération
   * @param {string} storeName — Nom du store
   * @param {DOMException|null} error — Erreur native
   * @returns {Error}
   * @private
   */
  _txError(operation, storeName, error) {
    return new Error(
      `DB.${operation}(${storeName}) a échoué : ${error?.message || 'erreur inconnue'}`
    );
  }


  /* ──────────────────────────────────────────────────────────
     MÉTHODES SPÉCIALISÉES — PROFIL UTILISATEUR
     ────────────────────────────────────────────────────────── */

  /**
   * Récupère le profil utilisateur.
   *
   * @returns {Promise<Object|null>} Le profil ou null si inexistant
   */
  async getProfile() {
    return this.get(STORES.USER, 'profile');
  }

  /**
   * Sauvegarde le profil utilisateur.
   * Fusionne les données fournies avec le profil existant.
   *
   * @param {Object} data — Données partielles ou complètes du profil
   * @returns {Promise<string>}
   */
  async saveProfile(data) {
    const existing = await this.getProfile();
    const merged = {
      ...existing,
      ...data,
      id: 'profile',
      updatedAt: new Date().toISOString()
    };

    // Fusion profonde pour les settings
    if (data.settings && existing?.settings) {
      merged.settings = {
        ...existing.settings,
        ...data.settings
      };
    }

    return this.put(STORES.USER, merged);
  }

  /**
   * Vérifie si un profil utilisateur existe.
   *
   * @returns {Promise<boolean>}
   */
  async hasProfile() {
    const profile = await this.getProfile();
    return profile !== null;
  }


  /* ──────────────────────────────────────────────────────────
     MÉTHODES SPÉCIALISÉES — SEMAINES
     ────────────────────────────────────────────────────────── */

  /**
   * Récupère les données d'une semaine spécifique.
   *
   * @param {number} weekNumber — Numéro de semaine (1, 2, 3...)
   * @returns {Promise<Object|null>}
   */
  async getWeek(weekNumber) {
    return this.get(STORES.WEEKS, `week_${weekNumber}`);
  }

  /**
   * Récupère toutes les semaines, triées par numéro croissant.
   *
   * @returns {Promise<Array<Object>>}
   */
  async getAllWeeks() {
    const weeks = await this.getAll(STORES.WEEKS);
    return weeks.sort((a, b) => a.weekNumber - b.weekNumber);
  }

  /**
   * Récupère les N dernières semaines complétées.
   *
   * @param {number} count — Nombre de semaines à récupérer
   * @returns {Promise<Array<Object>>}
   */
  async getRecentWeeks(count) {
    const allWeeks = await this.getAllWeeks();
    return allWeeks.slice(-count);
  }

  /**
   * Sauvegarde les données d'une semaine.
   *
   * @param {Object} data — Doit contenir weekNumber
   * @returns {Promise<string>}
   */
  async saveWeek(data) {
    if (typeof data.weekNumber !== 'number' || data.weekNumber < 1) {
      throw new Error(
        `weekNumber invalide : ${data.weekNumber}. Doit être un entier ≥ 1.`
      );
    }

    const record = {
      ...data,
      id: `week_${data.weekNumber}`,
      updatedAt: new Date().toISOString()
    };

    return this.put(STORES.WEEKS, record);
  }

  /**
   * Récupère la semaine avec le numéro le plus élevé.
   *
   * @returns {Promise<Object|null>}
   */
  async getLatestWeek() {
    const weeks = await this.getAllWeeks();
    return weeks.length > 0 ? weeks[weeks.length - 1] : null;
  }


  /* ──────────────────────────────────────────────────────────
     MÉTHODES SPÉCIALISÉES — SÉANCES
     ────────────────────────────────────────────────────────── */

  /**
   * Récupère une séance spécifique.
   *
   * @param {number} weekNumber — Numéro de semaine
   * @param {number} dayNumber  — Numéro de jour (1-7)
   * @returns {Promise<Object|null>}
   */
  async getSession(weekNumber, dayNumber) {
    return this.get(STORES.SESSIONS, `week${weekNumber}_day${dayNumber}`);
  }

  /**
   * Récupère toutes les séances d'une semaine.
   *
   * @param {number} weekNumber — Numéro de semaine
   * @returns {Promise<Array<Object>>} Triées par jour croissant
   */
  async getSessionsByWeek(weekNumber) {
    const sessions = await this.getAllByIndex(
      STORES.SESSIONS,
      'byWeek',
      weekNumber
    );
    return sessions.sort((a, b) => a.dayNumber - b.dayNumber);
  }

  /**
   * Récupère toutes les séances de l'historique.
   *
   * @returns {Promise<Array<Object>>} Triées chronologiquement
   */
  async getAllSessions() {
    const sessions = await this.getAll(STORES.SESSIONS);
    return sessions.sort((a, b) => {
      if (a.weekNumber !== b.weekNumber) {
        return a.weekNumber - b.weekNumber;
      }
      return a.dayNumber - b.dayNumber;
    });
  }

  /**
   * Sauvegarde une séance.
   *
   * @param {Object} data — Doit contenir weekNumber et dayNumber
   * @returns {Promise<string>}
   */
  async saveSession(data) {
    if (typeof data.weekNumber !== 'number' || data.weekNumber < 1) {
      throw new Error(`weekNumber invalide : ${data.weekNumber}`);
    }
    if (typeof data.dayNumber !== 'number' || data.dayNumber < 1 || data.dayNumber > 7) {
      throw new Error(`dayNumber invalide : ${data.dayNumber}. Doit être entre 1 et 7.`);
    }

    const record = {
      ...data,
      id: `week${data.weekNumber}_day${data.dayNumber}`,
      updatedAt: new Date().toISOString()
    };

    return this.put(STORES.SESSIONS, record);
  }

  /**
   * Compte les séances d'une semaine selon leur feedback.
   *
   * @param {number} weekNumber
   * @returns {Promise<{total: number, facile: number, parfait: number, impossible: number, skipped: number}>}
   */
  async countFeedbacksByWeek(weekNumber) {
    const sessions = await this.getSessionsByWeek(weekNumber);

    const counts = {
      total: 0,
      facile: 0,
      parfait: 0,
      impossible: 0,
      skipped: 0
    };

    sessions.forEach(session => {
      if (session.type === 'test_max') return; // Exclure le test max

      counts.total++;
      if (session.status === 'skipped') {
        counts.skipped++;
      } else if (session.feedback) {
        counts[session.feedback] = (counts[session.feedback] || 0) + 1;
      }
    });

    return counts;
  }


  /* ──────────────────────────────────────────────────────────
     MÉTHODES SPÉCIALISÉES — HISTORIQUE ALGORITHMIQUE
     ────────────────────────────────────────────────────────── */

  /**
   * Récupère l'historique de scoring complet.
   *
   * @returns {Promise<Array<Object>>} Trié par semaine croissante
   */
  async getScoringHistory() {
    const history = await this.getAll(STORES.ALGORITHM_HISTORY);
    return history.sort((a, b) => a.weekNumber - b.weekNumber);
  }

  /**
   * Récupère le scoring d'une semaine spécifique.
   *
   * @param {number} weekNumber
   * @returns {Promise<Object|null>}
   */
  async getScoringEntry(weekNumber) {
    return this.get(STORES.ALGORITHM_HISTORY, `scoring_week${weekNumber}`);
  }

  /**
   * Sauvegarde un scoring hebdomadaire.
   *
   * @param {Object} data — Doit contenir weekNumber
   * @returns {Promise<string>}
   */
  async saveScoringEntry(data) {
    if (typeof data.weekNumber !== 'number' || data.weekNumber < 1) {
      throw new Error(`weekNumber invalide : ${data.weekNumber}`);
    }

    const record = {
      ...data,
      id: `scoring_week${data.weekNumber}`,
      updatedAt: new Date().toISOString()
    };

    return this.put(STORES.ALGORITHM_HISTORY, record);
  }


  /* ──────────────────────────────────────────────────────────
     UTILITAIRES — EXPORT / IMPORT / RESET
     ────────────────────────────────────────────────────────── */

  /**
   * Exporte l'intégralité de la base en un objet JavaScript.
   * Utilisé par js/utils/export.js pour la sérialisation JSON.
   *
   * @returns {Promise<Object>} Structure complète exportable
   */
  async exportAll() {
    this._ensureReady();

    const [user, weeks, sessions, algorithmHistory] = await Promise.all([
      this.getProfile(),
      this.getAllWeeks(),
      this.getAllSessions(),
      this.getScoringHistory()
    ]);

    return {
      appVersion: '1.0.0',
      exportDate: new Date().toISOString(),
      user: user,
      weeks: weeks,
      sessions: sessions,
      algorithmHistory: algorithmHistory
    };
  }

  /**
   * Importe des données et écrase toute la base existante.
   * Valide la structure avant l'import.
   *
   * @param {Object} data — Données au format exportAll()
   * @throws {Error} Si le format est invalide
   * @returns {Promise<void>}
   */
  async importAll(data) {
    this._ensureReady();
    this._validateImportData(data);

    // Vider tous les stores
    await this.clearAll();

    // Importer le profil
    if (data.user) {
      await this.put(STORES.USER, { ...data.user, id: 'profile' });
    }

    // Importer les semaines
    if (Array.isArray(data.weeks)) {
      for (const week of data.weeks) {
        await this.put(STORES.WEEKS, week);
      }
    }

    // Importer les séances
    if (Array.isArray(data.sessions)) {
      for (const session of data.sessions) {
        await this.put(STORES.SESSIONS, session);
      }
    }

    // Importer l'historique algorithmique
    if (Array.isArray(data.algorithmHistory)) {
      for (const entry of data.algorithmHistory) {
        await this.put(STORES.ALGORITHM_HISTORY, entry);
      }
    }
  }

  /**
   * Valide la structure des données importées.
   *
   * @param {Object} data
   * @throws {Error} Si la structure est invalide
   * @private
   */
  _validateImportData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Format d\'import invalide : données manquantes ou non-objet.');
    }

    if (data.weeks && !Array.isArray(data.weeks)) {
      throw new Error('Format d\'import invalide : "weeks" doit être un tableau.');
    }

    if (data.sessions && !Array.isArray(data.sessions)) {
      throw new Error('Format d\'import invalide : "sessions" doit être un tableau.');
    }

    if (data.algorithmHistory && !Array.isArray(data.algorithmHistory)) {
      throw new Error('Format d\'import invalide : "algorithmHistory" doit être un tableau.');
    }

    // Valider que chaque semaine a un weekNumber
    if (data.weeks) {
      for (const week of data.weeks) {
        if (typeof week.weekNumber !== 'number') {
          throw new Error(
            `Format d'import invalide : semaine sans weekNumber valide.`
          );
        }
        if (!week.id) {
          week.id = `week_${week.weekNumber}`;
        }
      }
    }

    // Valider que chaque séance a weekNumber et dayNumber
    if (data.sessions) {
      for (const session of data.sessions) {
        if (typeof session.weekNumber !== 'number' || typeof session.dayNumber !== 'number') {
          throw new Error(
            `Format d'import invalide : séance sans weekNumber/dayNumber valide.`
          );
        }
        if (!session.id) {
          session.id = `week${session.weekNumber}_day${session.dayNumber}`;
        }
      }
    }

    // Valider l'historique algorithmique
    if (data.algorithmHistory) {
      for (const entry of data.algorithmHistory) {
        if (typeof entry.weekNumber !== 'number') {
          throw new Error(
            `Format d'import invalide : entrée scoring sans weekNumber valide.`
          );
        }
        if (!entry.id) {
          entry.id = `scoring_week${entry.weekNumber}`;
        }
      }
    }
  }

  /**
   * Supprime toutes les données de tous les stores.
   * Demande confirmation implicite via l'appelant (settings.js).
   *
   * @returns {Promise<void>}
   */
  async clearAll() {
    this._ensureReady();

    await Promise.all([
      this.clear(STORES.USER),
      this.clear(STORES.WEEKS),
      this.clear(STORES.SESSIONS),
      this.clear(STORES.ALGORITHM_HISTORY)
    ]);
  }
}


// ── Export singleton ──
// Une seule instance de Database pour toute l'application.
// Tous les modules importent la même référence.

const db = new Database();

export { db, STORES };
export default db;