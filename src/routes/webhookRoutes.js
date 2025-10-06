import express from 'express';
import webhookController from '../controllers/WebhookController.js';
import webhookControllerBold from '../controllers/WebhookControllerBold.js';
import PaymentController from '../controllers/paymentController.js';

const router = express.Router();

// Rutas para el webhook de WhatsApp
router.post('/webhook', (req, res) => webhookController.handleIncoming(req, res));
router.get('/webhook', (req, res) => webhookController.verifyWebhook(req, res));

// Ruta para el webhook de Bold
router.post('/webhook/bold', webhookControllerBold.handleBoldWebhook);
router.get('/payment-confirmation', (req, res) => PaymentController.handlePaymentConfirmation(req, res));

export default router;