import { Router } from 'express';
import pool from '../db/mysql.js';

const router = Router();

// Endpoint para obtener los detalles de un evento, incluyendo los cupos restantes.
router.get('/:eventId', async (req, res) => {
  const { eventId } = req.params;

  try {
    // 1. Obtener los detalles del evento.
    const [eventRows] = await pool.query('SELECT * FROM events WHERE id = ? AND is_active = true', [eventId]);

    if (eventRows.length === 0) {
      return res.status(404).json({ message: 'Evento no encontrado o no está activo.' });
    }
    const event = eventRows[0];

    // 2. Contar cuántos registros confirmados o pendientes existen para este evento.
    const [registrationRows] = await pool.query(
      "SELECT COUNT(id) as registered_count FROM registrations WHERE event_id = ? AND status IN ('pending_payment', 'confirmed')",
      [eventId]
    );
    const registeredCount = registrationRows[0].registered_count;

    // 3. Calcular los cupos restantes.
    const remainingSpots = event.max_capacity - registeredCount;

    // 4. Enviar la respuesta completa.
    res.json({
      ...event,
      registered_count: registeredCount,
      remaining_spots: remainingSpots > 0 ? remainingSpots : 0, // Asegurarse de no mostrar números negativos.
    });

  } catch (error) {
    console.error('Error al obtener el evento:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// Endpoint para registrar un nuevo asistente a un evento.
router.post('/:eventId/register', async (req, res) => {
  const { eventId } = req.params;
  const { fullName, email, phone, profession, position, isEntrepreneur, sector } = req.body;

  // Validación simple de entrada
  if (!fullName || !email || !phone) {
    return res.status(400).json({ message: 'Nombre completo, email y teléfono son requeridos.' });
  }

  try {
    const sql = `
      INSERT INTO registrations (event_id, full_name, email, phone, profession, position, is_entrepreneur, sector)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await pool.query(sql, [eventId, fullName, email, phone, profession, position, isEntrepreneur, sector]);
    res.status(201).json({ message: '¡Registro exitoso! Tienes 24h para confirmar el pago.' });
  } catch (error) {
    console.error('Error al registrar asistente:', error);
    // Manejar error de email duplicado
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Este correo electrónico ya ha sido registrado para este evento.' });
    }
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

export default router;