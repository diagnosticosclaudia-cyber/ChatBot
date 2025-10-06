import whatsappService from "./whatsappService.js";
import geminiService from "./geminiService.js";
import * as messages from "./messages.js";
import paymentController from "../controllers/paymentController.js";
import stateManager from "./stateManager.js";
import { prompts } from "./prompts.js";
import fs from "fs";
import cron from "node-cron";
import config from "../config/env.js";

/**
 * Verifica si un timestamp dado está dentro de las últimas 24 horas.
 * @param {number} timestamp - El timestamp a verificar.
 * @returns {boolean} - True si está dentro de las últimas 24h, false en caso contrario.
 */
function isWithin24h(timestamp) {
    // Usamos una constante para el valor de 24 horas en milisegundos para mayor claridad
    const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
    return Date.now() - timestamp < ONE_DAY_IN_MS;
}

class MessageHandler {
    constructor() {
        // Inicialización de estados y configuraciones
        this.consultationState = {};
        this.baseUrl = `${config.DOMINIO_URL}/images/`;
        this.IMAGE_DIR = "./temp"; // Directorio para almacenar imágenes temporales
        this.initializeBot(); // Centraliza la inicialización de tareas del bot
    }

    /**
     * Inicializa las tareas del bot al iniciar la aplicación.
     * Esto incluye la programación de limpieza de imágenes.
     */
    initializeBot() {
        console.log("Bot iniciado. URL de dominio:", config.DOMINIO_URL);
        this.scheduleImageCleanup();
    }

    // --- Message Handling (Manejo de Mensajes) ---

    async handleIncomingMessage(message, senderInfo) {
        try {
            console.log("Mensaje entrante:", message);
            const { type, id: messageId, from } = message;

            switch (type) {
                case "text":
                    await this.handleTextMessage(message, senderInfo);
                    break;
                case "interactive":
                    await this.handleInteractiveMessage(message);
                    break;
                case "image":
                    await this.handleImageMessage(from, message.image.id);
                    break;
                default:
                    console.log(`Tipo de mensaje no manejado: ${type}`);
            }
            // Siempre marcar el mensaje como leído después de intentar procesarlo
            await whatsappService.markAsRead(messageId);
        } catch (error) {
            console.error("❌ Error al manejar el mensaje entrante:", error);
            // Podrías enviar un mensaje de error general al usuario aquí si el error es grave.
        }
    }

    //  Detecta palabras clave en un mensaje de texto.

    detectKeywords(messageText) {
        const keywords = ["diagnostico", "cita", "ubicacion", "productos", "menu"];
        // Normaliza y limpia el mensaje para una detección de palabras clave más robusta
        const normalizedMessage = messageText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        return keywords.find(keyword => normalizedMessage.includes(keyword)) || null;
    }


    //  Maneja los mensajes de texto entrantes.

    async handleTextMessage(message, senderInfo) {
        try {
            const phoneNumber = message.from;
            const incomingMessage = message.text.body.toLowerCase().trim();

            if (this.isGreeting(incomingMessage)) {
                await this.sendWelcomeSequence(phoneNumber, senderInfo);
                return;
            }

            const detectedOption = this.detectKeywords(incomingMessage);
            if (detectedOption) {
                await this.handleMenuOption(phoneNumber, detectedOption);
                return;
            }

            // Si el usuario está en medio de un flujo de consulta (ej. pidiendo imágenes)
            if (this.consultationState[phoneNumber]) {
                await this.handleConsultationFlow(phoneNumber, incomingMessage);
                return;
            }

            // Mensaje por defecto si no se detecta ninguna intención
            await whatsappService.sendMessage(
                phoneNumber,
                "🤖 No estoy seguro de haber entendido. Puedes escribir *'menú'* para ver opciones disponibles o preguntar sobre nuestros servicios."
            );
        } catch (error) {
            console.error("❌ Error al manejar el mensaje de texto:", error);
        }
    }


    //  Maneja los mensajes interactivos (botones o listas).
    async handleInteractiveMessage(message) {
        try {
            const phoneNumber = message.from;
            const optionId = message?.interactive?.button_reply?.id || message?.interactive?.list_reply?.id;

            if (optionId) {
                await this.handleMenuOption(phoneNumber, optionId);
            }
        } catch (error) {
            console.error("❌ Error al manejar el mensaje interactivo:", error);
        }
    }

    // --- Image Handling (Manejo de Imágenes) ---

    async handleImageMessage(phoneNumber, imageId) {
        try {
            let state = stateManager.getState(phoneNumber) || {}; // Obtener o inicializar el estado del usuario

            // Inicializar el estado de la imagen si no existe o es nuevo
            if (!state.step || state.step === "none") {
                state = {
                    paymentStatus: "pending", // Estado inicial de pago
                    images: [],
                    step: "photo1", // Primer paso del flujo de imágenes
                    timestamp: Date.now(), // Registrar el tiempo para la validación de 24h
                };
            }

            state.images = state.images || []; // Asegurarse de que 'images' sea un array
            state.images.push(imageId);

            // Lógica para el flujo de fotos
            if (state.step === "photo1") {
                state.photo1Id = imageId;
                state.step = "photo2";
                await whatsappService.sendMessage(phoneNumber, messages.SEGUNDA_FOTO_MESSAGE);
            } else if (state.step === "photo2") {
                state.photo2Id = imageId;
                // Una vez que se tienen ambas fotos, ofrecer el análisis completo
                await this.offerFullAnalysis(phoneNumber);
            }

            stateManager.setState(phoneNumber, state); // Guardar el estado actualizado
            console.log(` Estado actualizado para ${phoneNumber}:`, state);
        } catch (error) {
            console.error("❌ Error en handleImageMessage:", error);
            await whatsappService.sendMessage(phoneNumber, messages.ERROR_IMAGE_MESSAGE);
        }
    }

    // `obtenerStatusImagen` parece ser un placeholder o no se usa, si no es necesario, considera eliminarlo.
    async obtenerStatusImagen() {
        return true;
    }

    // --- Analysis and Results (Análisis y Resultados) ---
    async processAnalysisAndSendResults(to) {
        console.log(`🚀 Ejecutando processAnalysisAndSendResults para ${to}`);
        try {
            const state = stateManager.getState(to);

            // Validar estado y si las fotos están listas ANTES de proceder
            if (!this.canProceedWithAnalysis(state, to)) {
                return;
            }

            console.log("id foto 1: ", state.photo1Id);
            console.log("id foto 2: ", state.photo2Id);

            const [photo1Path, photo2Path] = await this.downloadImages(to, state.photo1Id, state.photo2Id);
            if (!photo1Path || !photo2Path) {
                return;
            }

            const fullAnalysis = await geminiService.fullAnalysis(photo1Path, photo2Path, prompts.FULL_ANALYSIS);

            const timestamp = state.timestamp || Date.now();
            if (isWithin24h(timestamp)) {
                await whatsappService.sendMessage(to, fullAnalysis);
                await this.moreButtons(to);
                stateManager.deleteState(to);
            } else {
                // Almacena el análisis en el estado para enviarlo cuando el usuario haga clic en la plantilla
                state.fullAnalysis = fullAnalysis;
                stateManager.setState(to, state);
                console.log(`📦 Análisis guardado en estado para ${to}, esperando confirmación del usuario.`);

                // Envía la plantilla aprobada (con el botón "Recibir mi análisis")
                await whatsappService.sendTemplateMessage(to, "payment_analysis_ready", {
                    language: { code: "es" },
                    components: [
                        {
                            type: "body",
                            parameters: [
                                { type: "text", text: "Tu análisis estético está listo 🌸 ¿Deseas recibirlo ahora?" }, // Texto que aparece en el body de la plantilla si tienes un {{1}}
                            ]
                        },
                        { // Asegúrate de que tu plantilla tiene un botón con este ID
                            type: "button",
                            sub_type: "quick_reply",
                            index: 0, // Si es el primer botón
                            parameters: [
                                { type: "payload", payload: "get_full_analysis" }
                            ]
                        }
                    ]
                });
            }

            await this.cleanupImages([photo1Path, photo2Path]);

        } catch (error) {
            console.error("❌ Error en processAnalysisAndSendResults:", error);
            await this.sendErrorMessage(to, `Ocurrió un error al procesar el análisis completo: ${error}`);
        }
    }


    //  Valida el estado antes de proceder con el análisis.
    async canProceedWithAnalysis(state, to) {
        if (!state || state.paymentStatus !== "verified" || !state.photo1Id || !state.photo2Id) {
            console.warn(`⚠️ No se puede proceder con el análisis para ${to}. Estado actual:`, state);
            return false;
        }
        return true;
    }

    // Descarga las imágenes de WhatsApp.
    async downloadImages(to, photo1Id, photo2Id) {
        try {
            const [photo1Path, photo2Path] = await Promise.all([
                whatsappService.downloadMedia(photo1Id),
                whatsappService.downloadMedia(photo2Id),
            ]);

            if (!photo1Path || !photo2Path) {
                console.error(`⚠️ Error: No se pudieron descargar las imágenes. photo1Id: ${photo1Id}, photo2Id: ${photo2Id}`);
                await this.sendErrorMessage(to, "No se pudieron descargar las imágenes para el análisis.");
                return [null, null];
            }
            return [photo1Path, photo2Path];
        } catch (error) {
            console.error("❌ Error al descargar las imágenes:", error);
            await this.sendErrorMessage(to, "Ocurrió un error al descargar las imágenes para el análisis.");
            return [null, null];
        }
    }

    //  Elimina un array de rutas de archivo.
    async cleanupImages(filePaths) {
        try {
            await Promise.all(filePaths.map(path => fs.promises.unlink(path)));
            console.log("🗑️ Imágenes eliminadas correctamente.");
        } catch (err) {
            console.error("❌ Error al eliminar las imágenes:", err);
        }
    }

    // --- Manejo de Opciones - Menú ---

    //  Maneja la lógica para las diferentes opciones seleccionadas por el usuario (botones, listas, palabras clave).
    async handleMenuOption(to, option) {
        try {
            console.log("Opción de menú seleccionada:", { to, option });
            switch (option) {
                case "full_analysis_yes":
                    await this.initiatePaymentProcess(to);
                    break;
                case "full_analysis_no":
                    await whatsappService.sendMessage(to, "¡Gracias por tu consulta 😊!, ¿En qué más puedo ayudarte?");
                    await this.moreButtons(to);
                    break;
                case "diagnostico":
                    await this.confirmDiagnosticStart(to);
                    break;
                case "confirm_diagnostico":
                    await this.startDiagnosticFlow(to);
                    break;
                case "cita":
                    await this.handleAppointmentRequest(to);
                    break;
                case "productos":
                    await this.handleProductsRequest(to);
                    break;
                case "ubicacion":
                    await this.handleLocationRequest(to);
                    break;
                case "terminar":
                    await whatsappService.sendMessage(to, messages.DESPEDIDA_MESSAGE);
                    break;
                case "menu":
                    await this.sendWelcomeMenu(to);
                    break;
                default:
                    await this.sendErrorMessage(to, "Lo siento, no entendí tu selección. Elige una opción válida.");
            }
        } catch (error) {
            console.error("❌ Error al manejar la opción del menú:", error);
            await this.sendErrorMessage(to, "Ocurrió un error al procesar tu solicitud.");
        }
    }

    // --- NUEVO MÉTODO ---
    async deliverStoredAnalysis(to) {
        const state = stateManager.getState(to);
        if (state && state.fullAnalysis) {
            await whatsappService.sendMessage(to, state.fullAnalysis);
            await this.moreButtons(to);
            // Limpiar el análisis almacenado una vez entregado
            state.fullAnalysis = null;
            stateManager.setState(to, state);
            console.log(`✅ Análisis almacenado entregado a ${to}.`);
        } else {
            await whatsappService.sendMessage(to, "No tengo un análisis pendiente para entregar en este momento. Si necesitas un nuevo diagnóstico, escribe 'Diagnóstico'.");
        }
    }


    //  Inicia el proceso de pago y actualiza el estado del usuario.
    async initiatePaymentProcess(to) {
        try {
            const paymentLink = await paymentController.generatePaymentLink(to);

            if (paymentLink) {
                const state = stateManager.getState(to) || {};
                state.paymentStatus = "pending";
                state.fullAnalysisPending = true;
                state.paymentLink = paymentLink;
                // Extraer el ID del enlace de pago de la URL (si es necesario para Bold, o si ya lo recibes del servicio)
                const paymentLinkId = paymentLink.split('/').pop().split('?')[0]; // Ajuste para manejar posibles query params
                state.paymentLinkId = paymentLinkId;
                stateManager.setState(to, state);

                // <<<<< ENVÍO DEL MENSAJE DE ÉXITO CON EL ENLACE AQUÍ >>>>>
                await whatsappService.sendMessage(
                    to,
                    `Aquí tienes el enlace para completar tu pago de forma segura: ${paymentLink}. Una vez confirmado, procederemos con tu diagnóstico completo 😊. Si el enlace ha vencido, escribe "Diagnóstico" para iniciar un nuevo proceso. ¡Estamos aquí para ayudarte!`
                );
                console.log(`✅ Enlace de pago enviado a ${to}: ${paymentLink}`);

            } else {
                await this.sendErrorMessage(to, "No se pudo generar el enlace de pago. Inténtalo de nuevo más tarde.");
            }
        } catch (error) {
            console.error("❌ Error al iniciar el proceso de pago:", error);
            await this.sendErrorMessage(to, "Ocurrió un error inesperado al intentar generar el enlace de pago. Por favor, inténtalo de nuevo más tarde.");
        }
    }

    //  Verifica el estado de pago y procede con el análisis si es verificado.
    async handlePaymentVerification(to) {
        try {
            const state = stateManager.getState(to);
            if (state && state.paymentStatus === "verified" && state.fullAnalysisPending) {
                console.log(` Pago verificado. Iniciando análisis completo para ${to}...`);
                await this.processAnalysisAndSendResults(to);
                state.fullAnalysisPending = false; // Resetear bandera después del procesamiento
                stateManager.setState(to, state);
            } else {
                console.log(`⏳ Esperando pago para ${to} antes de proceder con el análisis completo.`);
            }
        } catch (error) {
            console.error("❌ Error en handlePaymentVerification:", error);
            await this.sendErrorMessage(to, "Ocurrió un error al verificar el pago.");
        }
    }

    //  Pide confirmación para iniciar el diagnóstico capilar.
    async confirmDiagnosticStart(to) {
        await whatsappService.sendInteractiveButtons(
            to,
            "¿Estás seguro de que deseas iniciar el diagnóstico capilar?",
            [
                { type: "reply", reply: { id: "confirm_diagnostico", title: "Sí" } },
                { type: "reply", reply: { id: "menu", title: "No, volver al menú" } },
            ]
        );
    }

    // Inicia el flujo de diagnóstico, limpiando el estado anterior y pidiendo la primera foto.
    async startDiagnosticFlow(to) {
        stateManager.setState(to, {
            paymentStatus: "pending",
            images: [],
            step: "photo1",
            photo1Id: null,
            photo2Id: null,
            timestamp: Date.now(),
        });
        await whatsappService.sendMessage(to, messages.PRIMERA_FOTO_MESSAGE);
    }

    //  Maneja la solicitud de cita.
    async handleAppointmentRequest(to) {
        await whatsappService.sendMessage(to, messages.AGENDA_MESSAGE);
        await this.sendContact(to);
        await this.sendHelpButtons(to);
    }

    //  Maneja la solicitud de productos.
    async handleProductsRequest(to) {
        await whatsappService.sendMessage(to, messages.PRODUCTOS_MESSAGE);
        await this.sendHelpButtons(to);
    }

    //  Maneja la solicitud de ubicación.
    async handleLocationRequest(to) {
        await this.sendLocationInfo(to);
        await whatsappService.sendMessage(to, messages.HORARIOS_MESSAGE);
        await this.sendHelpButtons(to);
    }

    // --- Welcome Sequence (Secuencia de Bienvenida) ---


    //  Envía la secuencia de bienvenida al usuario.
    async sendWelcomeSequence(to, senderInfo) {
        try {
            const name = this.getSenderName(senderInfo);
            await whatsappService.sendMessage(to, messages.WELCOME_MESSAGE(name));
            await this.sendWelcomeMenu(to);
        } catch (error) {
            console.error("❌ Error al enviar la secuencia de bienvenida:", error);
        }
    }

    // --- Consultation Flow (Flujo de Consulta) ---

    //  Maneja el flujo de consulta, indicando al usuario que envíe una imagen por separado.
    async handleConsultationFlow(to, message) {
        try {
            // Eliminar el estado de consulta para evitar bucles o comportamientos inesperados
            delete this.consultationState[to];
            await whatsappService.sendMessage(
                to,
                "Por favor, envía la imagen como un mensaje aparte para que pueda procesarla."
            );
        } catch (error) {
            console.error("❌ Error al manejar el flujo de consulta:", error);
        }
    }

    // --- Helper Functions (Funciones de Ayuda) ---

    //  Verifica si un mensaje es un saludo.
    isGreeting(message) {
        const greetingRegex = /^(hola|hello|hi|hey|buenas|buen[oa]s?\s?(d[ií]a|d[ií]as|tarde|tardes|noche|noches)|qué tal|saludos|cómo estás|qué onda)/i;
        return greetingRegex.test(message.toLowerCase().trim());
    }

    //  btiene el nombre del remitente a partir de la información proporcionada.
    getSenderName(senderInfo) {
        return senderInfo.profile?.name || senderInfo.wa_id;
    }

    //  Envía la información de contacto al usuario.
    async sendContact(to) {
        const contact = this.getContactInfo();
        await whatsappService.sendContactMessage(to, contact);
    }

    //  Retorna la información de contacto predefinida.
    getContactInfo() {
        return {
            addresses: [{ street: "Cra 31 #50 - 21", city: "Bucaramanga", type: "WORK" }],
            emails: [{ email: "tecniclaud@gmail.com", type: "WORK" }],
            name: { formatted_name: "Asesora Cosmética", first_name: "Claudia", last_name: "Moreno" },
            org: { company: "Claudia Moreno", department: "Atención al Cliente", title: "Técnico Colorista" },
            phones: [{ phone: "+573224457046", wa_id: "573224457046", type: "WORK" }],
            urls: [{ url: "https://diagnosticosclaudiamoreno.com/", type: "WORK" }]
        };
    }

    // Envía el menú principal de bienvenida al usuario.
    async sendWelcomeMenu(to) {
        const sections = [
            {
                title: "Opciones Principales",
                rows: [
                    { id: "diagnostico", title: "✨Diagnóstico Capilar✨" },
                    { id: "cita", title: "Cita con Profesional 💇🏻‍♀️" },
                    { id: "productos", title: "Ver Productos🧴" },
                    { id: "ubicacion", title: "Ubicación 📍" },
                ],
            },
        ];
        await whatsappService.sendInteractiveList(to, "Selecciona una opción:", "Menú", sections);
    }

    //  Ofrece al usuario la opción de un análisis completo.
    async offerFullAnalysis(to) {
        const message = messages.OFRECER_FULLANALYSIS_MESSAGE;
        const buttons = [
            { type: "reply", reply: { id: "full_analysis_yes", title: "Sí" } },
            { type: "reply", reply: { id: "full_analysis_no", title: "No" } },
        ];
        await whatsappService.sendInteractiveButtons(to, message, buttons);
    }

    //  Envía botones de ayuda adicionales al usuario.
    async sendHelpButtons(to) {
        await whatsappService.sendInteractiveButtons(
            to,
            "¿Necesitas ayuda adicional?",
            [
                { type: "reply", reply: { id: "terminar", title: "No, gracias" } },
                { type: "reply", reply: { id: "menu", title: "Menú principal" } },
            ]
        );
    }

    //  Envía botones con opciones adicionales de interés al usuario.
    async moreButtons(to) {
        await whatsappService.sendInteractiveButtons(
            to,
            "Te puede interesar:",
            [
                { type: "reply", reply: { id: "cita", title: "Agendar Cita 💇🏻‍♀️" } },
                { type: "reply", reply: { id: "productos", title: "Comprar Productos🧴" } },
                { type: "reply", reply: { id: "diagnostico", title: "✨Nuevo Diagnóstico✨" } },
            ]
        );
    }

    //  Envía la información de ubicación geográfica. 
    async sendLocationInfo(to) {
        // Considera mover estas constantes a un archivo de configuración o al constructor si son fijas.
        const latitude = 7.114296;
        const longitude = -73.112385;
        const name = "Claudia Moreno";
        const address = "📌 Cra. 31 #50 - 21, Sotomayor, Bucaramanga, Santander";
        await whatsappService.sendLocationMessage(to, latitude, longitude, name, address);
    }

    // --- Image Cleanup (Limpieza de Imágenes) ---


    //  Elimina imágenes del directorio temporal que sean más antiguas que 24 horas.

    deleteOldImages() {
        console.log("Iniciando limpieza de imágenes antiguas...");
        try {
            const files = fs.readdirSync(this.IMAGE_DIR);
            const now = Date.now();
            const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

            files.forEach(file => {
                const filePath = `${this.IMAGE_DIR}/${file}`;
                const stats = fs.statSync(filePath);

                if (now - stats.mtimeMs > ONE_DAY_IN_MS) {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️ Imagen eliminada: ${file}`);
                }
            });

            console.log("✅ Limpieza de imágenes completada.");
        } catch (error) {
            console.error("❌ Error al eliminar imágenes antiguas:", error);
        }
    }

    /**
     * Programa la eliminación automática de imágenes antiguas para que se ejecute diariamente a medianoche.
     */
    scheduleImageCleanup() {
        // Se ejecuta todos los días a las 00:00 (medianoche)
        cron.schedule("0 0 * * *", () => {
            console.log("⏳ Tarea programada: Ejecutando limpieza de imágenes...");
            this.deleteOldImages();
        });
        console.log("Tarea de limpieza de imágenes programada diariamente.");
    }

    // --- Error Handling (Manejo de Errores) ---
    async sendErrorMessage(to, errorMessage) {
        console.error(errorMessage);
        await whatsappService.sendMessage(to, errorMessage);
    }
}

export default new MessageHandler();