// stateManager.js
class stateManager {
    constructor() {
        this.consultationState = {};
    }

    getState(phoneNumber) {
        return this.consultationState[phoneNumber];
    }

    setState(phoneNumber, state) {
        this.consultationState[phoneNumber] = state;
    }

    deleteState(phoneNumber) {
        delete this.consultationState[phoneNumber];
    }

    // *** ¡Aquí la función crucial que faltaba! ***
    getAllStates() {
        // Devuelve una copia del objeto para evitar mutaciones externas directas
        return { ...this.consultationState };
    }
}

export default new stateManager();