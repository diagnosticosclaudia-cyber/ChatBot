import sendToWhatsApp from "../services/httpRequest/sendToWhatsApp.js";
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

class WhatsAppService {
    async sendMessage(to, body, messageId) {
        const data = {
            messaging_product: "whatsapp",
            to,
            text: { body },
        };

        await sendToWhatsApp(data);
    }

    async sendInteractiveButtons(to, bodyText, buttons) {
        const data = {
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
                type: "button",
                body: { text: bodyText },
                action: {
                    buttons: buttons,
                },
            },
        };

        await sendToWhatsApp(data);
    }

    async sendMediaMessage(to, type, mediaUrl, caption) {
        const mediaObject = {};

        switch (type) {
            case "image":
                mediaObject.image = { link: mediaUrl, caption: caption };
                break;
            case "audio":
                mediaObject.audio = { link: mediaUrl };
                break;
            case "video":
                mediaObject.video = { link: mediaUrl, caption: caption };
                break;
            case "document":
                mediaObject.document = {
                    link: mediaUrl,
                    caption: caption,
                    filename: "medpet-file.pdf",
                };
                break;
            default:
                throw new Error("Not Supported Media Type");
        }

        const data = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: type,
            ...mediaObject,
        };

        await sendToWhatsApp(data);
    }

    async markAsRead(messageId) {
        const data = {
            messaging_product: "whatsapp",
            status: "read",
            message_id: messageId,
        };

        await sendToWhatsApp(data);
    }

    async sendContactMessage(to, contact) {
        const data = {
            messaging_product: "whatsapp",
            to,
            type: "contacts",
            contacts: [contact],
        };

        await sendToWhatsApp(data);
    }

    async sendLocationMessage(to, latitude, longitude, name, address) {
        const data = {
            messaging_product: "whatsapp",
            to,
            type: "location",
            location: {
                latitude: latitude,
                longitude: longitude,
                name: name,
                address: address,
            },
        };
        await sendToWhatsApp(data);
    }

    async sendInteractiveList(to, bodyText, buttonText, sections) {
        try {
            const message = {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "list",
                    body: {
                        text: bodyText,
                    },
                    action: {
                        button: buttonText,
                        sections: sections,
                    },
                },
            };

            await sendToWhatsApp(message);
        } catch (error) {
            console.error("Error sending interactive list:", error);
            throw error;
        }
    }

    async downloadMedia(mediaId) {
        try {
            const baseUrl = process.env.BASE_URL;
            const apiVersion = process.env.API_VERSION;
            const apiToken = process.env.API_TOKEN;

            if (!baseUrl || !apiVersion || !apiToken) {
                throw new Error("Missing environment variables: BASE_URL, API_VERSION, or API_TOKEN");
            }

            const response = await axios({
                method: "get",
                url: `${baseUrl}/${apiVersion}/${mediaId}`,
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                },
            });

            const mediaUrl = response.data.url;

            const mediaResponse = await axios({
                method: "get",
                url: mediaUrl,
                responseType: "arraybuffer",
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                },
            });

            // Asegurar que el directorio 'temp' exista
            const tempDirPath = path.join(process.cwd(), "temp");
            try {
                await fs.mkdir(tempDirPath, { recursive: true });
            } catch (mkdirError) {
                console.error("Error creating temp directory:", mkdirError);
                throw mkdirError;
            }

            // Guardar la imagen en un archivo temporal
            const tempFilePath = path.join(tempDirPath, `${mediaId}.jpg`);
            await fs.writeFile(tempFilePath, mediaResponse.data);

            return tempFilePath;
        } catch (error) {
            console.error("Error downloading media:", error);
            throw error;
        }
    }
            //Plantilla para recibir pago
        async sendTemplateMessage(to, templateName, options = {}) {
        const data = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: options.language?.code || "es" // idioma por defecto: español
                },
                components: options.components || []    // parámetros dinámicos si aplica
            }
        };

        try {
            await sendToWhatsApp(data);
        } catch (error) {
            console.error("❌ Error al enviar plantilla:", error.response?.data || error);
            throw error;
        }
    }

}

export default new WhatsAppService();