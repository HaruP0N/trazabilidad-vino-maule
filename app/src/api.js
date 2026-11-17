'use strict';
// Gateway QR de solo lectura: el consumidor final consulta el historial de un lote.
// Usa la identidad User1 de Org1 y SOLO llama a consultarHistorial (evaluateTransaction).
const express = require('express');
const QRCode = require('qrcode');
const { consultar, mensajeError } = require('./cliente');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const ID_VALIDO = /^[A-Za-z0-9_-]{3,40}$/;

const ETIQUETA_ORG = {
  Org1MSP: 'Cooperativa / Productor',
  Org2MSP: 'Embotelladora',
  Org3MSP: 'Certificadora',
  Org4MSP: 'Exportador / Distribuidor',
};
const ETIQUETA_EVENTO = {
  COSECHA: 'Cosecha registrada',
  CERTIFICACION: 'Denominación de origen certificada',
  EMBOTELLADO: 'Embotellado',
  CAMBIO_CUSTODIA: 'Cambio de custodia',
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Vista pública: se omite la identidad X.509 completa de cada firmante.
function publico(h) {
  return {
    lote: h.lote,
    eventos: h.eventos.map((e) => ({
      secuencia: e.secuencia,
      tipoEvento: e.tipoEvento,
      organizacion: ETIQUETA_ORG[e.mspId] || e.mspId,
      mspId: e.mspId,
      idActor: e.idActor,
      timestamp: e.timestamp,
      txId: e.idEvento,
      datos: e.datos,
    })),
  };
}

async function obtener(id) {
  if (!ID_VALIDO.test(id)) {
    const err = new Error('Identificador de lote inválido');
    err.estado = 400;
    throw err;
  }
  try {
    return publico(await consultar('consultarHistorial', [id]));
  } catch (e) {
    const msg = mensajeError(e);
    const err = new Error(msg);
    err.estado = /no existe/i.test(msg) ? 404 : 502;
    throw err;
  }
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:");
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

app.get('/salud', (req, res) => res.json({ ok: true }));

app.get('/api/lote/:id', async (req, res) => {
  try { res.json(await obtener(req.params.id)); }
  catch (e) { res.status(e.estado || 500).json({ error: e.message }); }
});

app.get('/qr/:id.png', async (req, res) => {
  if (!ID_VALIDO.test(req.params.id)) return res.status(400).send('Identificador inválido');
  const png = await QRCode.toBuffer(`${PUBLIC_URL}/verificar/${req.params.id}`, { width: 360, margin: 2 });
  res.type('png').send(png);
});

app.get('/verificar/:id', async (req, res) => {
  try {
    const { lote, eventos } = await obtener(req.params.id);
    const filas = eventos.map((e) => `
      <li>
        <strong>${esc(ETIQUETA_EVENTO[e.tipoEvento] || e.tipoEvento)}</strong>
        <div>${esc(e.organizacion)} · ${esc(new Date(e.timestamp).toLocaleString('es-CL'))}</div>
        <div class="tx">Transacción ${esc(e.txId.slice(0, 16))}…</div>
      </li>`).join('');
    res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lote ${esc(lote.idLote)}</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#222}
 h1{font-size:1.3rem;margin-bottom:4px} .ok{color:#1a7f37;font-weight:600}
 .card{border:1px solid #ddd;border-radius:10px;padding:14px;margin:14px 0}
 ol{list-style:none;padding:0} li{border-left:3px solid #1a7f37;padding:4px 0 12px 14px}
 .tx{font-family:monospace;font-size:.78rem;color:#666}
</style></head><body>
<h1>Lote ${esc(lote.idLote)}</h1>
<div class="ok">Registrado en la red blockchain del consorcio</div>
<div class="card">
 <div><strong>Viñedo:</strong> ${esc(lote.vinedo)}</div>
 <div><strong>Variedad:</strong> ${esc(lote.variedad)}</div>
 <div><strong>Cosecha:</strong> ${esc(lote.fechaCosecha)}</div>
 <div><strong>Certificado:</strong> ${esc(lote.nCertificado || 'pendiente')}</div>
 <div><strong>Estado actual:</strong> ${esc(lote.estadoActual)}</div>
</div>
<h2>Historial verificable</h2><ol>${filas}</ol>
</body></html>`);
  } catch (e) {
    res.status(e.estado || 500).type('html').send(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:20px"><h1>Lote no verificable</h1><p>${esc(e.message)}</p></body>`);
  }
});

app.listen(PORT, () => console.log(`Gateway QR de solo lectura en ${PUBLIC_URL}`));
