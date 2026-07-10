import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import eventRoutes from './routes/events.js';

const app = express();

// Middlewares
app.use(cors()); // Permite peticiones desde tu frontend
app.use(express.json()); // Para parsear bodies de peticiones en formato JSON

// Rutas de la API
app.use('/api/events', eventRoutes);

// Ruta de bienvenida
app.get('/api', (req, res) => {
  res.send('Bienvenido a la API de !NSPEAKER Events');
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});