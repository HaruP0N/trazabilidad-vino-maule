'use strict';

const { Contract } = require('fabric-contract-api');
const { KeyEndorsementPolicy } = require('fabric-shim');

// MSP de cada organización de la red
const ORG1 = 'Org1MSP'; // Cooperativa / Productor
const ORG2 = 'Org2MSP'; // Embotelladora
const ORG3 = 'Org3MSP'; // Certificadora (tipo SAG / CTVV)
const ORG4 = 'Org4MSP'; // Exportador / Distribuidor

// Si es true, tras cada transición se fija en el lote la política de endoso
// que exige la SIGUIENTE transición (state-based endorsement).
const ENFORZAR_ENDOSO_POR_LOTE = true;

/**
 * Chaincode "TrazabilidadVino"
 * Registra eventos de trazabilidad de lotes de vino con Denominación de Origen.
 * Flujo de estados: COSECHADO -> CERTIFICADO -> EMBOTELLADO -> EN_TRANSITO
 *
 * Control de acceso (quién puede invocar) y endoso (quién debe firmar):
 *   registrarCosecha         invoca Org1 | endosa Org1
 *   registrarCertificacion   invoca Org3 | endosan Org1 Y Org3
 *   registrarEmbotellado     invoca Org2 | endosa Org2
 *   registrarCambioCustodia  invoca Org4 | endosan Org4 Y Org1
 *   consultarHistorial       solo lectura, sin restricción de organización
 */
class TrazabilidadVino extends Contract {

  // ---------- Funciones de escritura ----------

  async registrarCosecha(ctx, idLote, vinedo, variedad, fechaCosecha, volumen, idActor) {
    const msp = this._exigirOrg(ctx, [ORG1]);
    this._validarId(idLote, 'idLote');
    this._validarTexto(vinedo, 'vinedo');
    this._validarTexto(variedad, 'variedad');
    this._validarFecha(fechaCosecha, 'fechaCosecha');
    const vol = this._validarNumeroPositivo(volumen, 'volumen');
    this._validarTexto(idActor, 'idActor');

    if (await this._loteExiste(ctx, idLote)) {
      throw new Error(`El lote ${idLote} ya existe`);
    }

    const lote = {
      idLote,
      vinedo,
      variedad,
      fechaCosecha,
      volumen: vol,
      estadoActual: 'COSECHADO',
      secuencia: 0,
      docType: 'lote',
    };

    await this._registrarEvento(ctx, lote, idActor, msp, 'COSECHA', { vinedo, variedad, fechaCosecha, volumen: vol });
    await this._guardarLote(ctx, lote);
    await this._fijarPoliticaSiguiente(ctx, idLote, [ORG1, ORG3]);

    ctx.stub.setEvent('CosechaRegistrada', Buffer.from(JSON.stringify({ idLote, idActor, fechaCosecha })));
    return JSON.stringify(lote);
  }

  async registrarCertificacion(ctx, idLote, nCertificado, denominacionOrigen, fechaEmision, idActor) {
    const msp = this._exigirOrg(ctx, [ORG3]);
    this._validarId(idLote, 'idLote');
    this._validarId(nCertificado, 'nCertificado');
    this._validarTexto(denominacionOrigen, 'denominacionOrigen');
    this._validarFecha(fechaEmision, 'fechaEmision');
    this._validarTexto(idActor, 'idActor');

    const lote = await this._obtenerLote(ctx, idLote);
    if (lote.estadoActual !== 'COSECHADO') {
      throw new Error(`El lote ${idLote} solo puede certificarse desde COSECHADO (estado actual: ${lote.estadoActual})`);
    }

    const claveCert = ctx.stub.createCompositeKey('certificado', [nCertificado]);
    const existente = await ctx.stub.getState(claveCert);
    if (existente && existente.length > 0) {
      throw new Error(`El certificado ${nCertificado} ya existe`);
    }

    const certificado = { nCertificado, idLote, denominacionOrigen, fechaEmision, docType: 'certificado' };
    await ctx.stub.putState(claveCert, Buffer.from(JSON.stringify(certificado)));

    lote.estadoActual = 'CERTIFICADO';
    lote.nCertificado = nCertificado;

    await this._registrarEvento(ctx, lote, idActor, msp, 'CERTIFICACION', { nCertificado, denominacionOrigen, fechaEmision });
    await this._guardarLote(ctx, lote);
    await this._fijarPoliticaSiguiente(ctx, idLote, [ORG2]);

    ctx.stub.setEvent('CertificacionRegistrada', Buffer.from(JSON.stringify({ idLote, nCertificado, denominacionOrigen })));
    return JSON.stringify(certificado);
  }

  async registrarEmbotellado(ctx, idLote, volumenEmbotellado, fechaEmbotellado, idActor) {
    const msp = this._exigirOrg(ctx, [ORG2]);
    this._validarId(idLote, 'idLote');
    const volEmb = this._validarNumeroPositivo(volumenEmbotellado, 'volumenEmbotellado');
    this._validarFecha(fechaEmbotellado, 'fechaEmbotellado');
    this._validarTexto(idActor, 'idActor');

    const lote = await this._obtenerLote(ctx, idLote);
    if (lote.estadoActual !== 'CERTIFICADO') {
      throw new Error(`El lote ${idLote} debe estar certificado antes de embotellarse (estado actual: ${lote.estadoActual})`);
    }
    if (volEmb > lote.volumen) {
      throw new Error(`El volumen embotellado (${volEmb}) no puede superar el volumen cosechado (${lote.volumen})`);
    }

    lote.estadoActual = 'EMBOTELLADO';
    lote.volumenEmbotellado = volEmb;
    lote.fechaEmbotellado = fechaEmbotellado;

    await this._registrarEvento(ctx, lote, idActor, msp, 'EMBOTELLADO', { volumenEmbotellado: volEmb, fechaEmbotellado });
    await this._guardarLote(ctx, lote);
    await this._fijarPoliticaSiguiente(ctx, idLote, [ORG4, ORG1]);

    ctx.stub.setEvent('EmbotelladoRegistrado', Buffer.from(JSON.stringify({ idLote, volumenEmbotellado: volEmb })));
    return JSON.stringify(lote);
  }

  async registrarCambioCustodia(ctx, idLote, actorEntrega, actorRecibe, fecha, idActor) {
    const msp = this._exigirOrg(ctx, [ORG4]);
    this._validarId(idLote, 'idLote');
    this._validarTexto(actorEntrega, 'actorEntrega');
    this._validarTexto(actorRecibe, 'actorRecibe');
    this._validarFecha(fecha, 'fecha');
    this._validarTexto(idActor, 'idActor');

    const lote = await this._obtenerLote(ctx, idLote);
    if (lote.estadoActual !== 'EMBOTELLADO' && lote.estadoActual !== 'EN_TRANSITO') {
      throw new Error(`El lote ${idLote} no está en un estado válido para cambio de custodia (estado actual: ${lote.estadoActual})`);
    }
    if (lote.custodioActual && lote.custodioActual !== actorEntrega) {
      throw new Error(`La custodia actual es de ${lote.custodioActual}, no de ${actorEntrega}`);
    }

    lote.estadoActual = 'EN_TRANSITO';
    lote.custodioActual = actorRecibe;

    await this._registrarEvento(ctx, lote, idActor, msp, 'CAMBIO_CUSTODIA', { actorEntrega, actorRecibe, fecha });
    await this._guardarLote(ctx, lote);
    await this._fijarPoliticaSiguiente(ctx, idLote, [ORG4, ORG1]);

    ctx.stub.setEvent('CustodiaCambiada', Buffer.from(JSON.stringify({ idLote, actorEntrega, actorRecibe })));
    return JSON.stringify(lote);
  }

  // ---------- Funciones de solo lectura (usar evaluateTransaction / peer chaincode query) ----------

  // Lote + historial ordenado de eventos. Es lo que consulta el gateway QR.
  async consultarHistorial(ctx, idLote) {
    this._validarId(idLote, 'idLote');
    const lote = await this._obtenerLote(ctx, idLote);
    const eventos = await this._obtenerEventosDeLote(ctx, idLote);
    return JSON.stringify({ lote, eventos });
  }

  // Auditoría: todas las versiones que ha tenido el lote en el ledger, con su txId.
  // Demuestra la inmutabilidad: nada se sobrescribe, cada cambio queda como una versión nueva.
  async auditarLote(ctx, idLote) {
    this._validarId(idLote, 'idLote');
    const iterador = await ctx.stub.getHistoryForKey(idLote);
    const versiones = [];
    let r = await iterador.next();
    while (!r.done) {
      const v = r.value;
      versiones.push({
        txId: v.txId,
        timestamp: this._aISO(v.timestamp),
        eliminado: v.isDelete,
        valor: v.isDelete ? null : JSON.parse(Buffer.from(v.value).toString('utf8')),
      });
      r = await iterador.next();
    }
    await iterador.close();
    if (versiones.length === 0) {
      throw new Error(`El lote ${idLote} no existe`);
    }
    return JSON.stringify(versiones);
  }

  // ---------- Funciones internas ----------

  _exigirOrg(ctx, orgsPermitidas) {
    const msp = ctx.clientIdentity.getMSPID();
    if (!orgsPermitidas.includes(msp)) {
      throw new Error(`La organización ${msp} no está autorizada para esta operación (permitidas: ${orgsPermitidas.join(', ')})`);
    }
    return msp;
  }

  async _fijarPoliticaSiguiente(ctx, idLote, orgs) {
    if (!ENFORZAR_ENDOSO_POR_LOTE) {
      return;
    }
    const politica = new KeyEndorsementPolicy();
    politica.addOrgs('PEER', ...orgs); // todas las orgs listadas deben endosar (AND)
    await ctx.stub.setStateValidationParameter(idLote, politica.getPolicy());
  }

  async _loteExiste(ctx, idLote) {
    const data = await ctx.stub.getState(idLote);
    return !!data && data.length > 0;
  }

  async _obtenerLote(ctx, idLote) {
    const data = await ctx.stub.getState(idLote);
    if (!data || data.length === 0) {
      throw new Error(`El lote ${idLote} no existe`);
    }
    return JSON.parse(data.toString());
  }

  async _guardarLote(ctx, lote) {
    await ctx.stub.putState(lote.idLote, Buffer.from(JSON.stringify(lote)));
  }

  // Incrementa la secuencia del lote y guarda el evento con clave [idLote, secuencia]
  // para que el historial salga siempre en orden cronológico.
  async _registrarEvento(ctx, lote, idActor, mspId, tipoEvento, datos) {
    lote.secuencia += 1;
    const evento = {
      idEvento: ctx.stub.getTxID(),
      idLote: lote.idLote,
      secuencia: lote.secuencia,
      idActor,                              // declarado por quien invoca
      mspId,                                // organización verificada por Fabric
      identidad: ctx.clientIdentity.getID(), // identidad X.509 verificada por Fabric
      tipoEvento,
      datos,
      timestamp: this._aISO(ctx.stub.getTxTimestamp()),
      docType: 'evento',
    };
    const clave = ctx.stub.createCompositeKey('evento', [lote.idLote, String(lote.secuencia).padStart(6, '0')]);
    await ctx.stub.putState(clave, Buffer.from(JSON.stringify(evento)));
  }

  async _obtenerEventosDeLote(ctx, idLote) {
    const iterador = await ctx.stub.getStateByPartialCompositeKey('evento', [idLote]);
    const eventos = [];
    let r = await iterador.next();
    while (!r.done) {
      eventos.push(JSON.parse(r.value.value.toString()));
      r = await iterador.next();
    }
    await iterador.close();
    eventos.sort((a, b) => a.secuencia - b.secuencia);
    return eventos;
  }

  _aISO(ts) {
    const s = ts.seconds;
    let segundos;
    if (typeof s === 'number') {
      segundos = s;
    } else if (s && typeof s.toNumber === 'function') {
      segundos = s.toNumber();
    } else if (s && typeof s.low === 'number') {
      segundos = s.low;
    } else {
      segundos = Number(s);
    }
    return new Date(segundos * 1000).toISOString();
  }

  _validarId(valor, campo) {
    if (typeof valor !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(valor)) {
      throw new Error(`${campo} inválido: use 3 a 40 caracteres entre letras, números, "-" y "_"`);
    }
  }

  _validarTexto(valor, campo) {
    if (typeof valor !== 'string' || valor.trim().length === 0) {
      throw new Error(`${campo} es obligatorio`);
    }
  }

  _validarFecha(valor, campo) {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(valor))) {
      throw new Error(`${campo} inválida: use el formato AAAA-MM-DD`);
    }
  }

  _validarNumeroPositivo(valor, campo) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${campo} debe ser un número mayor que 0`);
    }
    return n;
  }
}

module.exports = TrazabilidadVino;
