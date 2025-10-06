import express from 'express';
import config from './config/env.js';
import webhookRoutes from './routes/webhookRoutes.js';
import path from 'path';
import { fileURLToPath } from 'url'; // Importar fileURLToPath

const app = express();
app.use(express.json());

// Obtener __dirname en módulos ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurar el middleware para archivos estáticos
app.use('/images', express.static(path.join(__dirname, 'resources', 'images')));

app.use('/', webhookRoutes);

app.get('/', (req, res) => {
  res.send(`<pre>Nothing to see here.
Checkout README.md to start.</pre>`);
});

app._router.stack.forEach((r) => {
  if (r.route && r.route.path) {
    console.log(`📍 Ruta registrada: ${r.route.path}`);
  } else if (r.name === 'router') {
    r.handle.stack.forEach((handler) => {
      const route = handler.route;
      if (route) console.log(`📍 Ruta registrada: ${route.path}`);
    });
  }
});


app.listen(config.PORT, () => {
  console.log(`Server is listening on port:  ${config.PORT}`);
});