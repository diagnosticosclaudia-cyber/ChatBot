// src/controllers/paymentController.js
import boldService from '../services/boldService.js';
import whatsappService from '../services/whatsappService.js';
import messageHandler from '../services/messageHandler.js';
import stateManager from '../services/stateManager.js';

class PaymentController {
    async generatePaymentLink(to) {
        try {
            const paymentDetails = {};
            const paymentLink = await boldService.createPaymentLink(paymentDetails, to);

            if (paymentLink) {
                console.log("Payment link generated:", paymentLink);
                return paymentLink;
            } else {
                console.error("No se recibió un enlace de pago válido de BoldService.");
                return null;
            }
        } catch (error) {
            console.error('Error generating payment link:', error);
            return null;
        }  
    }

    async handlePaymentConfirmation(req, res) {
        try {
            const status = req.query.status;
            const paymentId = req.query.payment_id;
            const to = req.query.to; 

            console.log("🔔 Confirmación de pago recibida:", { status, paymentId, to });
            if (!to) {
                return res.status(400).send("Falta el parámetro 'to' (número de teléfono).");
            }

            // Usar SOLO stateManager para manejar el estado
            let state = stateManager.getState(to) || {};

            // Marcar pago verificado
            state.paymentStatus = "verified";
            state.timestamp = state.timestamp || Date.now(); // Asegurar que tengamos un timestamp
            stateManager.setState(to, state);

            if (status === "success") {
                await whatsappService.sendMessage(
                    to,
                    "✅ ¡Pago exitoso! Gracias por tu compra. Estamos preparando tu análisis estético..."
                );

                // Llamar al handler que decide si envía el análisis directamente o la plantilla
                await messageHandler.processAnalysisAndSendResults(to);

                return res.status(200).send("Pago confirmado correctamente.");
            } else {
                await whatsappService.sendMessage(
                    to,
                    "❌ El pago no se completó. Puedes intentarlo de nuevo escribiendo 'Diagnóstico'."
                );
                return res.status(200).send("Pago no exitoso.");
            }
        } catch (error) {
            console.error("❌ Error en handlePaymentConfirmation:", error);
            await whatsappService.sendMessage(to, "Ocurrió un error al procesar la confirmación del pago.");
            return res.status(500).send("Error interno del servidor");
        }
    }
}

export default new PaymentController();