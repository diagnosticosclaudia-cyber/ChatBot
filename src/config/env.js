import dotenv from "dotenv";

dotenv.config();

export default {
    WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN,
    API_TOKEN: process.env.API_TOKEN,
    BUSINESS_PHONE: process.env.BUSINESS_PHONE,
    API_VERSION: process.env.API_VERSION,
    PORT: process.env.PORT || 3000,
    BASE_URL: process.env.BASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    BOLD_API_KEY:process.env.BOLD_API_KEY,
    WEBHOOK_BOLD:process.env.WEBHOOK_BOLD,
    DOMINIO_URL:process.env.DOMINIO_URL,
    PAGO_BOLD:process.env.PAGO_BOLD,
    BOLD_API_LINK_URL: process.env.BOLD_API_LINK_URL
}