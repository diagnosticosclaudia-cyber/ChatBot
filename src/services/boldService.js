import axios from "axios";
import config from "../config/env.js";
import whatsappService from "./whatsappService.js";
import stateManager from './stateManager.js';
import messageHandler from './messageHandler.js'; // Asegúrate de importar messageHandler aquí

class BoldService {
    constructor() {
        this.paymentLinkToPhoneNumber = new Map(); // Mapa para almacenar la relación paymentLinkId -> phoneNumber
    }

    async createPaymentLink(paymentDetails, phoneNumber) {
        try {
            const { orderId, amount, currency, expiration_date } = paymentDetails;
            const paymentData = {
                amount_type: "CLOSE",
                amount: {
                    currency: currency || "COP",
                    tip_amount: 0,
                    total_amount: amount || 5000,
                },
                description: orderId || "Diagnóstico Capilar",
                expiration_date: expiration_date || (Date.now() * 1e6) + (10 * 60 * 1e9),
                image_url: `${config.DOMINIO_URL}/images/diagnostico.jpg`,
            };

            const response = await axios.post(config.BOLD_API_LINK_URL, paymentData, {
                headers: {
                    Authorization: `x-api-key ${config.BOLD_API_KEY}`,
                    "Content-Type": "application/json",
                },
            });

            if (response.data?.payload?.url) {
                const paymentLinkId = response.data.payload.payment_link; // <-- Usar 'payment_link'
                if (phoneNumber) {
                    const state = stateManager.getState(phoneNumber) || {};
                    state.boldPaymentLinkId = paymentLinkId; // Almacena el ID del enlace Bold
                    stateManager.setState(phoneNumber, state);

                    console.log(`✅ Enlace de pago creado en Bold para ${phoneNumber}, ID: ${paymentLinkId}. Guardado en estado.`);
                } else {
                    console.warn('⚠️ Número de teléfono no válido para vincular el enlace de pago.');
                }
                return response.data.payload.url;
            } else {
                throw new Error("No se pudo generar el enlace de pago: Respuesta de Bold incompleta.");
            }
        } catch (error) {
            console.error("Error creating Bold payment link:", error.response?.data || error.message);
            return null;
        }
    }

    async processWebhookEvent(event) {
        try {
            console.log("Evento recibido en BoldService.processWebhookEvent:", JSON.stringify(event, null, 2));

            const { type, data } = event;

            let boldPaymentLinkIdFromWebhook; // Usaremos este para buscar en los estados
            if (data?.metadata?.reference) {
                boldPaymentLinkIdFromWebhook = data.metadata.reference;
            } else if (data?.payment_link_id) {
                boldPaymentLinkIdFromWebhook = data.payment_link_id;
            } else if (data?.id) { // A veces el ID principal del objeto puede ser el link ID
                boldPaymentLinkIdFromWebhook = data.id;
            }
            // Asegúrate de verificar la estructura real de los webhooks de Bold.
            // Si no encuentras el ID del enlace de pago, no podrás asociarlo a un usuario.

            if (!boldPaymentLinkIdFromWebhook) {
                console.warn('⚠️ Webhook recibido sin un boldPaymentLinkId identificable. No se puede procesar.');
                return;
            }

            // *** Buscar el phoneNumber por el boldPaymentLinkIdFromWebhook ***
            // Esto requiere una función en stateManager para obtener todos los estados
            // o un método más eficiente si estás usando una DB.
            let phoneNumberFound = null;
            const allStates = stateManager.getAllStates(); // Necesitas implementar esto en stateManager
            for (const phone in allStates) {
                if (allStates[phone].boldPaymentLinkId === boldPaymentLinkIdFromWebhook) {
                    phoneNumberFound = phone;
                    break;
                }
            }

            if (!phoneNumberFound) {
                console.warn(`⚠️ No se encontró número de teléfono vinculado al boldPaymentLinkId: ${boldPaymentLinkIdFromWebhook}`);
                return;
            }

            const phoneNumber = phoneNumberFound;
            let state = stateManager.getState(phoneNumber) || {};

            switch (type) {
                case "SALE_APPROVED": {
                    const paymentId = data?.payment_id;
                    console.log(`✅ Pago aprobado para ${phoneNumber}, ID: ${paymentId}`);

                    // Actualizar el estado del usuario
                    state.paymentStatus = "verified";
                    state.timestamp = state.timestamp || Date.now();
                    stateManager.setState(phoneNumber, state);

                    await whatsappService.sendMessage(
                        phoneNumber,
                        "✅ ¡Pago exitoso! Gracias por tu compra. Estamos preparando tu análisis estético..."
                    );
                    // Aquí es donde disparas el análisis completo
                    await messageHandler.processAnalysisAndSendResults(phoneNumber);
                    break;
                }

                case "SALE_PENDING": {
                    console.log(`⏳ Pago pendiente para ${phoneNumber}`);
                    state.paymentStatus = "pending";
                    stateManager.setState(phoneNumber, state);
                    await whatsappService.sendMessage(
                        phoneNumber,
                        "⏳ Tu pago está en proceso. Te avisaremos cuando se confirme. ¡Gracias por tu paciencia! 😊"
                    );
                    break;
                }

                case "SALE_REJECTED": {
                    console.warn(`❌ Pago rechazado para ${phoneNumber}, ID: ${data.payment_id}`);
                    state.paymentStatus = "rejected";
                    stateManager.setState(phoneNumber, state);
                    await whatsappService.sendMessage(
                        phoneNumber,
                        "❌ Tu pago no fue aprobado. Puedes intentarlo de nuevo escribiendo *Diagnóstico* o contactar soporte."
                    );
                    break;
                }

                default:
                    console.warn(`⚠️ Evento no manejado: ${type}`);
                    break;
            }
        } catch (error) {
            console.error("❌ Error en processWebhookEvent de BoldService:", error);
            // Si hay un error, el webhook puede reintentar. No enviar un mensaje aquí.
        }
    }
}

export default new BoldService();