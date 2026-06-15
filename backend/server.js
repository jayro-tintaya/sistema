const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();

app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'restaurante'
});

db.connect((err) => {
    if (err) {
        console.log('Error MySQL:', err);
    } else {
        console.log('MySQL conectado');
    }
});

// ── Cola de pedidos QR pendientes de mostrar en el POS ──
let pedidosQRPendientes = [];

// PRODUCTOS
app.get('/productos', (req, res) => {
    db.query('SELECT * FROM productos', (err, result) => {
        if (err) {
            console.log(err);
            res.json([]);
        } else {
            res.json(result);
        }
    });
});

// USUARIOS
app.get('/usuarios', (req, res) => {
    db.query('SELECT * FROM usuarios', (err, result) => {
        if (err) {
            res.send(err);
        } else {
            res.json(result);
        }
    });
});

// PEDIDO desde POS (guardar nuevo pedido)
app.post('/pedido', (req, res) => {
    const { mesa, total, items } = req.body;
    
    console.log("📝 Recibiendo pedido POS:", { mesa, total, items });
    
    if (!mesa || !total || !items || items.length === 0) {
        return res.status(400).json({ error: "Datos incompletos" });
    }
    
    db.query(
        'INSERT INTO pedidos (mesa, total, fecha) VALUES (?, ?, NOW())',
        [mesa, total],
        (err, result) => {
            if (err) {
                console.error("❌ Error INSERT pedidos:", err);
                return res.status(500).json({ error: err.message });
            }
            
            const pedidoId = result.insertId;
            console.log("✅ Pedido POS insertado, ID:", pedidoId);
            
            items.forEach(item => {
                db.query(
                    'INSERT INTO detalle_pedido (pedido_id, producto, cantidad, precio) VALUES (?, ?, ?, ?)',
                    [pedidoId, item.name, item.qty, item.price]
                );
            });
            
            res.json({ 
                success: true, 
                message: "Pedido guardado correctamente",
                pedidoId: pedidoId 
            });
        }
    );
});

// PEDIDO desde celular QR (guardar en BD + notificar al POS)
app.post('/api/pedido', (req, res) => {
    const { mesa, items, subtotal, total } = req.body;

    console.log("📱 Recibiendo pedido QR desde celular:", { mesa, total });

    if (!mesa || !items || items.length === 0) {
        return res.status(400).json({ error: "Datos incompletos" });
    }

    const totalFinal = total || subtotal || 0;

    // 1. Guardar en base de datos
    db.query(
        'INSERT INTO pedidos (mesa, total, fecha) VALUES (?, ?, NOW())',
        [mesa, totalFinal],
        (err, result) => {
            if (err) {
                console.error("❌ Error INSERT pedido QR:", err);
                return res.status(500).json({ error: err.message });
            }

            const pedidoId = result.insertId;
            console.log("✅ Pedido QR insertado en BD, ID:", pedidoId);

            // Guardar detalle
            items.forEach(item => {
                db.query(
                    'INSERT INTO detalle_pedido (pedido_id, producto, cantidad, precio) VALUES (?, ?, ?, ?)',
                    [pedidoId, item.name, item.cantidad || item.qty || 1, item.price]
                );
            });

            // 2. Agregar a la cola para que el POS lo reciba
            const pedidoParaPOS = {
                id: pedidoId,
                mesa,
                items,
                subtotal: subtotal || totalFinal,
                total: totalFinal,
                timestamp: new Date().toISOString()
            };
            pedidosQRPendientes.push(pedidoParaPOS);

            res.json({ success: true, pedidoId });
        }
    );
});

// EL POS consulta esta ruta cada 2 segundos para recibir pedidos QR
app.get('/api/pedidos-qr', (req, res) => {
    const pendientes = [...pedidosQRPendientes];
    pedidosQRPendientes = []; // limpiar la cola
    res.json(pendientes);
});

// REPORTES
app.get('/reportes', (req, res) => {
    db.query(
        `SELECT COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS ventas
         FROM pedidos WHERE DATE(fecha) = CURDATE()`,
        (err, result) => {
            if (err) {
                console.log(err);
                res.send(err);
            } else {
                res.json(result[0]);
            }
        }
    );
});

// OBTENER TODOS LOS PEDIDOS HISTÓRICOS
app.get('/pedidos/todos', (req, res) => {
    const query = `
        SELECT p.id, p.mesa, p.total, p.fecha,
               GROUP_CONCAT(CONCAT(dp.producto, '|', dp.cantidad, '|', dp.precio) SEPARATOR ';;') as detalles
        FROM pedidos p
        LEFT JOIN detalle_pedido dp ON p.id = dp.pedido_id
        GROUP BY p.id
        ORDER BY p.fecha DESC
    `;
    
    db.query(query, (err, result) => {
        if (err) {
            console.error("Error al obtener pedidos:", err);
            res.json([]);
        } else {
            const pedidos = result.map(row => {
                const items = [];
                if (row.detalles) {
                    row.detalles.split(';;').forEach(det => {
                        const [producto, cantidad, precio] = det.split('|');
                        if (producto && cantidad && precio) {
                            items.push({
                                name: producto,
                                qty: parseInt(cantidad),
                                price: parseFloat(precio),
                                emoji: "🍽️"
                            });
                        }
                    });
                }
                return {
                    id_bd: row.id,
                    id_mostrar: "ORD-" + String(row.id).padStart(4, "0"),
                    mesa: row.mesa,
                    items,
                    total: parseFloat(row.total),
                    fecha: new Date(row.fecha),
                    fecha_str: new Date(row.fecha).toLocaleDateString('es-BO'),
                    hora_str: new Date(row.fecha).toLocaleTimeString('es-BO')
                };
            });
            res.json(pedidos);
        }
    });
});

// INICIAR SERVIDOR
app.listen(3001, () => {
    console.log('Servidor funcionando en puerto 3001');
});
