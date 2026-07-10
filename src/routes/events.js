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

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Verificar si hay cupos disponibles (con bloqueo para concurrencia)
    const [eventRows] = await connection.query('SELECT max_capacity FROM events WHERE id = ? FOR UPDATE', [eventId]);
    const [registrationRows] = await connection.query("SELECT COUNT(id) as registered_count FROM registrations WHERE event_id = ? AND status IN ('pending_payment', 'confirmed')", [eventId]);
    
    const maxCapacity = eventRows[0].max_capacity;
    const registeredCount = registrationRows[0].registered_count;

    // --- MODIFICACIÓN TEMPORAL PARA PRUEBAS ---
    // Descomenta la siguiente línea para forzar el escenario de "evento lleno".
    const isFull = true;
    // 2. Verificar si el email ya está registrado para este evento
    const [existingRows] = await connection.query(
      'SELECT id, status FROM registrations WHERE event_id = ? AND email = ?',
      [eventId, email]
    );

    // Lógica principal basada en la existencia y estado del registro
    if (existingRows.length > 0) {
      const registration = existingRows[0];
 
      if (registration.status === 'confirmed') {
        // CASO 1: El usuario ya está confirmado. No hacer nada, solo notificar.
        // No hay cambios que guardar, así que revertimos la transacción para liberar el bloqueo.
        await connection.rollback();
        return res.status(409).json({ message: 'Ya estás inscrito y tu pago ha sido confirmado.', code: 'ALREADY_CONFIRMED' });
      }

      if (registration.status === 'waitlist') {
        await connection.rollback();
        return res.status(409).json({ message: 'Ya estás en nuestra lista de espera. Te contactaremos si se libera un cupo.', code: 'ALREADY_IN_WAITLIST' });
      }
 
      // CASO 2: El usuario está 'pending_payment' o 'cancelled'.
      // Si estaba cancelado, debemos verificar si hay cupo para reactivarlo.
      if (registeredCount >= maxCapacity || isFull) { // Usamos la variable de prueba
        // Si está lleno, actualizamos y lo ponemos en lista de espera
        const updateSql = `
          UPDATE registrations 
          SET full_name = ?, phone = ?, profession = ?, position = ?, is_entrepreneur = ?, sector = ?, status = 'waitlist', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        await connection.query(updateSql, [fullName, phone, profession, position, isEntrepreneur, sector, registration.id]);
        await connection.commit();
        return res.status(200).json({ 
          message: 'El evento está lleno, pero hemos guardado tus datos en nuestra lista de espera. ¡Te avisaremos si se libera un cupo!', 
          code: 'WAITLIST_SUCCESS' 
        });
      }
 
      const updateSql = `
        UPDATE registrations 
        SET full_name = ?, phone = ?, profession = ?, position = ?, is_entrepreneur = ?, sector = ?, status = 'pending_payment', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      await connection.query(updateSql, [fullName, phone, profession, position, isEntrepreneur, sector, registration.id]);
 
      await connection.commit();
 
      if (registration.status === 'pending_payment') {
        return res.status(200).json({ message: 'Hemos actualizado tu reserva pendiente de pago. Revisa tu correo para ver las instrucciones.', code: 'PENDING_PAYMENT' });
      } else { // El estado original era 'cancelled'
        return res.status(201).json({ message: '¡Qué bueno tenerte de vuelta! Tu registro ha sido reactivado. Revisa tu correo.', code: 'REGISTRATION_SUCCESS' });
      }
    } else {
      // CASO 3: Es un registro completamente nuevo.
      if (registeredCount >= maxCapacity || isFull) { // Usamos la variable de prueba
        // Si está lleno, lo añadimos a la lista de espera
        const insertSql = `
          INSERT INTO registrations (event_id, full_name, email, phone, profession, position, is_entrepreneur, sector, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waitlist')
        `;
        await connection.query(insertSql, [eventId, fullName, email, phone, profession, position, isEntrepreneur, sector]);
        await connection.commit();
        return res.status(200).json({ 
          message: 'El evento está lleno, pero te hemos añadido a la lista de espera. ¡Te avisaremos si se libera un cupo!', 
          code: 'WAITLIST_SUCCESS' 
        });
      }
 
      const insertSql = `
        INSERT INTO registrations (event_id, full_name, email, phone, profession, position, is_entrepreneur, sector)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await connection.query(insertSql, [eventId, fullName, email, phone, profession, position, isEntrepreneur, sector]);
 
      await connection.commit();
      return res.status(201).json({ message: '¡Registro exitoso! Hemos enviado las instrucciones de pago a tu correo.', code: 'REGISTRATION_SUCCESS' });
    }
  } catch (error) {
    await connection.rollback(); // Revertir transacción en caso de error
    console.error('Error al registrar asistente:', error.message || error);

    if (error.status) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(500).json({ message: 'Error interno del servidor.' });
    }
  } finally {
    if (connection) connection.release();
  }
});

export default router;
