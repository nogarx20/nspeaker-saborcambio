import mysql from 'mysql2/promise';
import 'dotenv/config';

// Lee la variable de entorno para la conexión a la base de datos.
const connectionUrl = process.env.DATABASE_URL;

if (!connectionUrl) {
  console.error("Error: La variable de entorno DATABASE_URL no está definida.");
  process.exit(1);
}

// Crea un pool de conexiones que es más eficiente para manejar múltiples conexiones.
const pool = mysql.createPool(connectionUrl);

export default pool;