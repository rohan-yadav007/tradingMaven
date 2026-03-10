
// services/pairProfileService.ts
// Manages persistence and retrieval of the Universal Signal Model.
// Omega reads the active model on every generateSignal call.

import { UniversalSignalModel } from './trainingService';

const STORAGE_KEY = 'omega_universal_model_v1';

class PairProfileService {
    private model: UniversalSignalModel | null = null;
    private loaded = false;

    /** Load the saved model from localStorage */
    load(): UniversalSignalModel | null {
        if (this.loaded) return this.model;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            this.model = raw ? JSON.parse(raw) as UniversalSignalModel : null;
        } catch {
            this.model = null;
        }
        this.loaded = true;
        return this.model;
    }

    /** Save a new universal model */
    save(model: UniversalSignalModel): void {
        this.model = model;
        this.loaded = true;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
        } catch (e) {
            console.warn('[PairProfileService] Could not save model to localStorage:', e);
        }
    }

    /** Clear the stored model */
    clear(): void {
        this.model = null;
        this.loaded = true;
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    }

    /** Get the current model (loads from storage if not already loaded) */
    getModel(): UniversalSignalModel | null {
        return this.load();
    }

    /** Returns true if a model has been trained and saved */
    hasModel(): boolean {
        return this.load() !== null;
    }

    /** Returns a summary string for UI display */
    getSummary(): string {
        const m = this.load();
        if (!m) return 'No model trained';
        const date = new Date(m.builtAt).toLocaleDateString();
        return `${m.trainedPairs.length} pairs · ${m.conditions.length} conditions · Built ${date}`;
    }
}

export const pairProfileService = new PairProfileService();
