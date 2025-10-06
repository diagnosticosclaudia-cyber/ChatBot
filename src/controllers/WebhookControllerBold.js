// src/controllers/webhookControllerBold.js
import boldService from '../services/boldService.js';

class WebhookControllerBold {
    async handleBoldWebhook(req, res) {
        try {
            const event = req.body; // Aquí se recibe el payload del webhook
            console.log('--- INICIO WEBHOOK BOLD RECIBIDO ---');
            console.log("Webhook de Bold recibido en /webhook/bold:", JSON.stringify(event, null, 2)); // ESTE ES EL LOG CLAVE
            console.log('--- FIN WEBHOOK BOLD RECIBIDO ---');
            await boldService.processWebhookEvent(event);
            res.status(200).send('Webhook received');
        } catch (error) {
            console.error('Error handling Bold webhook:', error);
            res.status(500).send('Webhook error');
        }
    }
}

export default new WebhookControllerBold();