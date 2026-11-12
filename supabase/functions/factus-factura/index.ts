import { createClient } from "npm:@supabase/supabase-js@2.76.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const requiredSecret = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Falta configurar el secreto ${name}`);
  return value;
};

const withTimeout = async (url: string, init: RequestInit, timeoutMs = 25000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
};

const documentCode = (value: string) => ({
  CC: "13", TI: "12", RC: "11", CE: "22", PA: "41", PASAPORTE: "41",
  PEP: "47", PPT: "48", NIT: "31", NUIP: "91",
}[String(value || "").toUpperCase()] || String(value || "13"));

const paymentMethodCode = (value: string) => ({
  efectivo: "10", transferencia: "47", nequi: "47", daviplata: "47", tarjeta: "48",
}[String(value || "").toLowerCase()] || "1");

const collectMessages = (value: any): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectMessages);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectMessages);
  return [];
};

const factusError = (payload: any, fallback: string) => {
  const validation = collectMessages(payload?.errors ?? payload?.data?.errors).filter(Boolean).join(" · ");
  return validation || payload?.message || payload?.error_description || payload?.error || fallback;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Sesion requerida" }, 401);

  const supabaseUrl = requiredSecret("SUPABASE_URL");
  const supabaseAnonKey = requiredSecret("SUPABASE_ANON_KEY");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let ventaId = "";
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return json({ error: "Sesion invalida" }, 401);

    const body = await req.json().catch(() => ({}));
    if (body?.accion === "verificar_configuracion") {
      const { data: canConfigure, error: configPermissionError } = await supabase.rpc("tiene_permiso", { p_codigo: "facturacion.configurar" });
      if (configPermissionError) throw configPermissionError;
      if (!canConfigure) return json({ error: "No tienes permiso para verificar la configuracion de facturacion" }, 403);
      const baseUrl = Deno.env.get("FACTUS_BASE_URL") || "https://api-sandbox.factus.com.co";
      const credentials = new URLSearchParams({ grant_type: "password", client_id: requiredSecret("FACTUS_CLIENT_ID"), client_secret: requiredSecret("FACTUS_CLIENT_SECRET"), username: requiredSecret("FACTUS_USERNAME"), password: requiredSecret("FACTUS_PASSWORD") });
      const tokenResponse = await withTimeout(`${baseUrl}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: credentials });
      const tokenPayload = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenPayload?.access_token) return json({ error: factusError(tokenPayload, "Factus rechazo la autenticacion") }, 400);
      const rangeResponse = await withTimeout(`${baseUrl}/v2/numbering-ranges?filter[trashed]=with`, { headers: { Authorization: `Bearer ${tokenPayload.access_token}`, Accept: "application/json" } });
      const rangePayload = await rangeResponse.json().catch(() => ({}));
      if (!rangeResponse.ok) return json({ error: factusError(rangePayload, "No fue posible consultar los rangos de numeracion") }, 400);
      const rawRanges = rangePayload?.data?.data ?? rangePayload?.data?.numbering_ranges ?? rangePayload?.data ?? rangePayload?.numbering_ranges ?? [];
      const ranges = Array.isArray(rawRanges) ? rawRanges : [rawRanges];
      return json({ ok: true, ambiente: baseUrl.includes("sandbox") ? "sandbox" : "produccion", rangos: ranges.map((range: any) => ({ id: range.id, documento: range.document || range.document_name || null, prefijo: range.prefix || null, resolucion: range.resolution_number || null, desde: range.from || null, hasta: range.to || null, vigencia_hasta: range.end_date || null, activo: Boolean(range.is_active), vencido: Boolean(range.is_expired), eliminado: Boolean(range.deleted_at) })) });
    }
    ventaId = String(body?.venta_id || "");
    if (!ventaId) return json({ error: "Falta la venta que se va a facturar" }, 400);

    const { data: permitted, error: permissionError } = await supabase.rpc("tiene_permiso", { p_codigo: "facturacion.emitir" });
    if (permissionError) throw permissionError;
    if (!permitted) return json({ error: "No tienes permiso para emitir facturas electronicas" }, 403);

    const { data: prepared, error: prepareError } = await supabase.rpc("preparar_emision_factura", { p_venta: ventaId });
    if (prepareError) return json({ error: prepareError.message }, 409);
    if (prepared?.estado === "validada") return json({ ok: true, factura: prepared, message: "La factura ya estaba validada" });

    const [{ data: invoice, error: invoiceError }, { data: sale, error: saleError }] = await Promise.all([
      supabase.from("facturas_electronicas")
        .select("*, conceptos_facturacion(nombre,codigo_referencia,unidad_medida_codigo,codigo_estandar,excluido_iva)")
        .eq("venta_id", ventaId).single(),
      supabase.from("ventas")
        .select("id,numero_venta,subtotal,descuento,total,abono,saldo,metodo_pago,fecha_entrega,observaciones,ventas_detalle(cantidad,precio_unitario,descuento,subtotal,codigo_referencia,descripcion,productos_servicios(nombre,codigo,categoria,unidad_medida_codigo,codigo_estandar,excluido_iva),monturas(nombre),tipos_lente(nombre),materiales(nombre),filtros(nombre),tratamientos(nombre),fabricaciones(nombre))")
        .eq("id", ventaId).single(),
    ]);
    if (invoiceError || saleError) throw invoiceError || saleError;

    const baseUrl = Deno.env.get("FACTUS_BASE_URL") || "https://api-sandbox.factus.com.co";
    const credentials = new URLSearchParams({
      grant_type: "password",
      client_id: requiredSecret("FACTUS_CLIENT_ID"),
      client_secret: requiredSecret("FACTUS_CLIENT_SECRET"),
      username: requiredSecret("FACTUS_USERNAME"),
      password: requiredSecret("FACTUS_PASSWORD"),
    });
    const tokenResponse = await withTimeout(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: credentials,
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      throw new Error(factusError(tokenPayload, "Factus rechazo la autenticacion"));
    }
    const factusHeaders = { Authorization: `Bearer ${tokenPayload.access_token}`, Accept: "application/json" };

    const rangeResponse = await withTimeout(`${baseUrl}/v2/numbering-ranges?filter[trashed]=with`, { headers: factusHeaders });
    const rangePayload = await rangeResponse.json().catch(() => ({}));
    if (!rangeResponse.ok) throw new Error(factusError(rangePayload, "No fue posible consultar los rangos de numeracion"));
    const rawRanges = rangePayload?.data?.data ?? rangePayload?.data?.numbering_ranges ?? rangePayload?.data ?? rangePayload?.numbering_ranges ?? [];
    const ranges = (Array.isArray(rawRanges) ? rawRanges : [rawRanges]).filter((range: any) => {
      const active = range?.is_active === true || range?.is_active === 1 || range?.is_active === "1";
      const expired = range?.is_expired === true || range?.is_expired === 1 || range?.is_expired === "1";
      const document = String(range?.document || range?.document_name || "").toLowerCase();
      return active && !expired && !range?.deleted_at && document.includes("factura") && !document.includes("nota");
    });
    if (!ranges.length) throw new Error("Factus no devolvio un rango activo de factura de venta");
    if (ranges.length > 1) throw new Error("Factus devolvio varios rangos activos. El propietario debe elegir uno en la configuracion");
    const numberingRangeId = Number(ranges[0].id);
    await supabase.from("configuracion_facturacion").update({
      rango_numeracion_id: ranges[0].id,
      rango_prefijo: ranges[0].prefix || null,
      rango_resolucion: ranges[0].resolution_number || null,
      rango_desde: ranges[0].from || null,
      rango_hasta: ranges[0].to || null,
      rango_vigencia_hasta: ranges[0].end_date || null,
      actualizado_por: userData.user.id,
      updated_at: new Date().toISOString(),
    }).eq("id", true);

    const concept = invoice.conceptos_facturacion || { nombre: "Producto o servicio", codigo_referencia: "ITEM", unidad_medida_codigo: "94", codigo_estandar: "999", excluido_iva: true };
    const isCredit = Number(sale.saldo) > 0;
    const discountAmount = Number(sale.descuento || 0);
    const paid = Number(sale.abono || 0);
    const balance = Number(sale.saldo || 0);
    const total = Number(sale.total || 0);
    if (balance > 0 && !invoice.fecha_vencimiento_credito) {
      throw new Error("Indica la fecha de vencimiento del saldo antes de emitir la factura a credito");
    }
    const paymentDetails = balance <= 0
      ? [{ payment_form: "1", payment_method_code: paymentMethodCode(sale.metodo_pago), amount: total.toFixed(2) }]
      : paid <= 0
        ? [{ payment_form: "2", payment_method_code: paymentMethodCode(sale.metodo_pago), amount: total.toFixed(2), due_date: invoice.fecha_vencimiento_credito }]
        : [
          { payment_form: "1", payment_method_code: paymentMethodCode(sale.metodo_pago), amount: paid.toFixed(2) },
          { payment_form: "2", payment_method_code: paymentMethodCode(sale.metodo_pago), amount: balance.toFixed(2), due_date: invoice.fecha_vencimiento_credito },
        ];
    const payload: Record<string, unknown> = {
      reference_code: invoice.referencia,
      document: "01",
      numbering_range_id: numberingRangeId,
      operation_type: "10",
      send_email: true,
      observation: sale.observaciones || "Venta Centro Optico de Colombia",
      payment_details: paymentDetails,
      customer: {
        identification_document_code: documentCode(invoice.cliente_tipo_documento),
        identification: invoice.cliente_identificacion,
        ...(invoice.cliente_dv ? { dv: invoice.cliente_dv } : {}),
        legal_organization_code: invoice.cliente_tipo_organizacion,
        tribute_code: "ZZ",
        responsibilities: ["R-99-PN"],
        ...(invoice.cliente_tipo_organizacion === "1" ? { company: invoice.cliente_nombre } : { names: invoice.cliente_nombre }),
        email: invoice.cliente_correo,
        ...(invoice.cliente_telefono ? { phone: invoice.cliente_telefono } : {}),
        ...(invoice.cliente_direccion ? { address: invoice.cliente_direccion } : {}),
        country_code: "CO",
        ...(invoice.cliente_municipio_codigo ? { municipality_code: invoice.cliente_municipio_codigo } : {}),
      },
      items: (sale.ventas_detalle || []).map((detail: any, index: number) => {
        const product = detail.productos_servicios || {};
        const specifications = [detail.descripcion && detail.descripcion !== product.nombre ? detail.descripcion : null, detail.tipos_lente?.nombre, detail.materiales?.nombre, detail.filtros?.nombre, detail.tratamientos?.nombre, detail.fabricaciones?.nombre].filter(Boolean);
        const description = [product.nombre, ...new Set(specifications)].filter(Boolean).join(" · ") || concept.nombre;
        const lineDiscount = Math.max(Number(detail.precio_unitario || 0) * Number(detail.cantidad || 1) - Number(detail.subtotal || 0), 0);
        return {
          code_reference: String(detail.codigo_referencia || product.codigo || `${concept.codigo_referencia}-${index + 1}`).slice(0, 50),
          name: description.slice(0, 160),
          quantity: Number(detail.cantidad || 1).toFixed(2),
          price: Number(detail.precio_unitario || 0).toFixed(2),
          ...(lineDiscount > 0 ? { discount_amount: lineDiscount.toFixed(2) } : {}),
          unit_measure_code: product.unidad_medida_codigo || concept.unidad_medida_codigo || "94",
          standard_code: product.codigo_estandar || concept.codigo_estandar || "999",
          taxes: (product.excluido_iva ?? concept.excluido_iva) ? [{ is_excluded: true }] : [{ code: "01", rate: "0.00" }],
        };
      }),
    };

    const billResponse = await withTimeout(`${baseUrl}/v2/bills/validate`, {
      method: "POST",
      headers: { ...factusHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, 45000);
    const billPayload = await billResponse.json().catch(() => ({}));
    if (!billResponse.ok) {
      await supabase.from("facturas_electronicas").update({ respuesta: billPayload, updated_at: new Date().toISOString() }).eq("venta_id", ventaId);
      throw new Error(factusError(billPayload, "Factus no pudo validar la factura"));
    }

    const bill = billPayload?.data?.bill || billPayload?.data || billPayload?.bill || {};
    const update = {
      estado: "validada",
      factus_id: String(bill?.id || bill?.bill_id || "") || null,
      numero_factura: bill?.number || bill?.document_number || bill?.bill_number || null,
      cufe: bill?.cufe || bill?.uuid || null,
      codigo_qr: bill?.qr || bill?.qr_code || null,
      url_pdf: bill?.pdf_url || bill?.public_url || null,
      url_xml: bill?.xml_url || null,
      respuesta: billPayload,
      ultimo_error: null,
      emitida_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error: saveError } = await supabase.from("facturas_electronicas").update(update).eq("venta_id", ventaId).select().single();
    if (saveError) throw saveError;
    return json({ ok: true, factura: saved, message: "Factura electronica validada en Factus" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible emitir la factura";
    if (ventaId) {
      await supabase.from("facturas_electronicas").update({
        estado: "error", ultimo_error: message.slice(0, 1800), updated_at: new Date().toISOString(),
      }).eq("venta_id", ventaId);
    }
    return json({ error: message }, 400);
  }
});
