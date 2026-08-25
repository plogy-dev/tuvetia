// Tipos de fila del esquema Supabase que consumen las libs de facturación y
// cartera. Portados del repo cliente con la regla del contrato:
//   · tenancy:  user_id → clinic_id (uuid → public.clinics)
//   · autoría:  se AÑADE created_by (uuid → public.profiles, nullable)
//   · visits →  consultations (visit_id → consultation_id)
//   · sin organization_id (el destino no tiene organizations; nada lo leía)
//   · sin tipos de Gmail (invoice_gmail_threads no se porta)
// Los nombres del resto de columnas son EXACTAMENTE los del cliente — las
// migraciones 0029-0032 siguen la misma regla.

import type {
  CatalogKind,
  CollectionStatus,
  DeliveryStatus,
  DocKind,
  FiscalStatus,
  FollowupStatus,
  InvoiceEventType,
  MovementType,
  PaymentMethod,
  ReminderStepKind,
  TaxRate,
  TaxStatus,
} from './facturacion-enums';

// ─── CRM del destino (shape real de athos-service/000_base_schema.sql) ───────

export type OwnerRow = {
  id: string;
  clinic_id: string;
  full_name: string;
  /** Documento de identidad (texto libre). El cliente lo llamaba id_doc. */
  document_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Facturación (0033_facturacion_core) ─────────────────────────────────────

export type BillingModuleStatus =
  | 'NO_ACTIVADO'
  | 'RECORDAR_DESPUES'
  | 'ASISTENTE_EN_PROGRESO'
  | 'ACTIVO';

export type FiscalIdType = 'NIT' | 'CC' | 'CE';
export type FiscalRegime = 'COMUN' | 'SIMPLE' | 'NO_RESPONSABLE';
export type PayerKind = 'PERSONA' | 'EMPRESA';
export type InvoiceLifecycleStatus = 'BORRADOR' | 'EMITIENDO' | 'EMITIDA' | 'ANULADA';
export type PaymentTerms = 'IMMEDIATE' | 'CREDIT';
export type FiscalDocumentStatus = 'PENDIENTE' | 'ACEPTADO' | 'RECHAZADO' | 'CONTINGENCIA';
export type CreditNoteReasonCode =
  | 'DEVOLUCION'
  | 'ANULACION'
  | 'DESCUENTO'
  | 'AJUSTE_PRECIO'
  | 'OTROS';

/** Configuración del emisor (1 fila por clínica). */
export type BillingSettingsRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  module_status: BillingModuleStatus;
  wizard_state: Record<string, unknown> | null;
  billing_enabled: boolean;
  inventory_enabled: boolean;
  reminders_enabled: boolean;
  fiscal_name: string | null;
  fiscal_id_type: FiscalIdType | null;
  fiscal_id_number: string | null;
  fiscal_regime: FiscalRegime | null;
  fiscal_responsibilities: string[];
  fiscal_address: string | null;
  municipality_code: string | null;
  department_code: string | null;
  inventory_decrement_on: 'INVOICE_ISSUE' | 'MANUAL';
  default_doc_kind: DocKind;
  block_on_insufficient_stock: boolean;
  uvt_year: number;
  uvt_value_cents: number;
  /** Término de pago por defecto de la clínica, en días. */
  default_payment_terms_days: number;
  /** Canal principal de recordatorios de cartera. */
  reminder_channel: 'WHATSAPP' | 'EMAIL';
  /** Pasos de la política de recordatorios (null = política por defecto). */
  reminder_policy: Record<string, unknown> | null;
  /**
   * Texto de los recordatorios de esta clínica, por paso. `null` o paso ausente = el texto por
   * defecto de `lib/cartera/plantillas.ts`. Se lee con `leerPlantillas`, que es defensivo: es
   * `jsonb` y puede traer cualquier forma.
   */
  reminder_templates: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

/** Rango de numeración DIAN. current_number = último número ASIGNADO. */
export type NumberingRangeRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  doc_kind: DocKind | 'NOTA_CREDITO' | 'NOTA_DEBITO';
  prefix: string;
  range_from: number;
  range_to: number;
  current_number: number;
  is_active: boolean;
  resolution_number: string | null;
  resolution_date: string | null;
  valid_from: string | null;
  valid_until: string | null;
  technical_key: string | null;
  provider_ref: string | null;
  is_sandbox: boolean;
  created_at: string;
  updated_at: string;
};

/** Responsable del pago / adquiriente (separado del titular clínico). */
export type BillingPayerRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  kind: PayerKind;
  doc_type: string;
  doc_number: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  municipality_code: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CatalogItemRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  item_type: CatalogKind;
  name: string;
  sku: string | null;
  /**
   * Campo «Grupo» del inventario de OkVet: etiqueta libre de la clínica.
   * Es OTRO eje que `category_id` — en OkVet no hay pantalla de grupos y las categorías no tienen
   * grupo padre, así que no es una jerarquía sino dos clasificaciones sueltas.
   */
  item_group: string | null;
  description: string | null;
  purchase_unit: string;
  use_unit: string;
  conversion_factor: number;
  price_cents: number;
  cost_cents: number | null;
  tax_rate: TaxRate;
  tax_status: TaxStatus;
  track_stock: boolean;
  min_stock: number | null;
  /** Texto libre legado; el vínculo real es supplier_id. */
  supplier: string | null;
  /** Proveedor como entidad. null = sin proveedor. */
  supplier_id: string | null;
  location: string | null;
  active: boolean;
  /** Categoría del ítem. null = sin asignar. */
  category_id: string | null;
  duration_minutes: number | null;
  barcode: string | null;
  active_ingredient: string | null;
  concentration: string | null;
  presentation: string | null;
  manufacturer: string | null;
  /** Importación que creó el ítem. null = creado a mano. */
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
};

/** Categoría de catálogo por clínica. Datos, no enum; editable/archivable. */
export type CatalogCategoryRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  name: string;
  parent_id: string | null;
  sort_order: number;
  /** «Sin categoría»: no se puede borrar/archivar; recibe los ítems sueltos. */
  is_default: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CatalogLotRow = {
  id: string;
  item_id: string;
  lot_code: string;
  expires_on: string | null;
  created_at: string;
};

/** Proveedor por clínica. Entidad real; catalog_items.supplier queda como texto legado. */
export type SupplierRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  name: string;
  nit: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/** Receta de consumo: un SERVICIO consume estos componentes por unidad. */
export type ServiceConsumptionRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  service_id: string;
  component_id: string;
  qty: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** Existencia = Σ qty (firmado, en use_unit). Nunca hay columna stock. */
export type InventoryMovementRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  item_id: string;
  lot_id: string | null;
  qty: number;
  movement_type: MovementType;
  ref_type: 'INVOICE' | 'IMPORT_BATCH' | 'MANUAL' | 'PURCHASE' | null;
  ref_id: string | null;
  note: string | null;
  /** Importación que creó el movimiento. */
  import_batch_id: string | null;
  created_at: string;
};

export type ImportBatchStatus = 'PREVIEW' | 'COMMITTED' | 'REVERTED';

/** Importación de inventario Excel/CSV con preview y reversión. */
export type ImportBatchRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  file_name: string;
  status: ImportBatchStatus;
  /** columna origen → campo destino. */
  mapping: Record<string, string>;
  /** { columns, raw, validated } — payload completo de la vista previa. */
  rows: Record<string, unknown>;
  /** { total, ready, withWarnings, duplicates, errors }. */
  report: Record<string, number>;
  committed_at: string | null;
  reverted_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Factura / documento equivalente POS. `status` = ciclo operativo;
 * fiscal/collection/delivery_status son CACHÉS derivados de invoice_events
 * (deriveStatus del dominio). `number` es null en borrador.
 */
export type InvoiceRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  doc_kind: DocKind;
  status: InvoiceLifecycleStatus;
  numbering_range_id: string | null;
  number: number | null;
  full_number: string | null;
  payer_id: string | null;
  patient_id: string | null;
  /** El cliente ligaba a visits; el destino liga a consultations. */
  consultation_id: string | null;
  payment_terms: PaymentTerms;
  due_date: string | null;
  subtotal_cents: number;
  /** Suma de los descuentos de TODAS las líneas, ya con el global prorrateado adentro. */
  discount_cents: number;
  /** El descuento de FACTURA tal como se tecleó, antes de prorratear. */
  global_discount_cents: number;
  /** Por qué se dio el descuento de factura. Obligatorio si el anterior no es cero (0081). */
  global_discount_reason: string | null;
  /** «Referencia/Nombre»: ref. de mascota, historia o nombre libre. No es fiscal. */
  reference: string | null;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  credited_cents: number;
  balance_cents: number;
  fiscal_status: FiscalStatus;
  collection_status: CollectionStatus;
  delivery_status: DeliveryStatus;
  reminders_paused: boolean;
  /** 4ª dimensión — estado del seguimiento de cartera (caché derivado). */
  followup_status: FollowupStatus;
  /** Canal principal de seguimiento de esta factura. */
  followup_channel: 'WHATSAPP' | 'EMAIL' | null;
  /** Opt-out por factura del seguimiento automático. */
  followup_enabled: boolean;
  notes: string | null;
  share_token: string;
  issued_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Snapshot congelado al emitir: cambios futuros del catálogo no la alteran. */
export type InvoiceLineRow = {
  id: string;
  invoice_id: string;
  catalog_item_id: string | null;
  description: string;
  qty: number;
  unit: string;
  unit_price_cents: number;
  tax_rate: TaxRate;
  tax_status: TaxStatus;
  discount_cents: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  position: number;
  created_at: string;
};

/** Fuente de verdad de estados (append-only). */
export type InvoiceEventRow = {
  id: string;
  invoice_id: string;
  event_type: InvoiceEventType;
  payload: Record<string, unknown> | null;
  created_at: string;
};

/** Transmisión al proveedor DIAN. XML/CUFE se conservan ≥5 años. */
export type FiscalDocumentRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  invoice_id: string | null;
  credit_note_id: string | null;
  provider: string;
  doc_kind: DocKind | 'NOTA_CREDITO' | 'NOTA_DEBITO';
  status: FiscalDocumentStatus;
  cufe: string | null;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  xml_storage_path: string | null;
  pdf_storage_path: string | null;
  attempts: number;
  last_error: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreditNoteRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  invoice_id: string;
  numbering_range_id: string | null;
  number: number | null;
  full_number: string | null;
  status: 'BORRADOR' | 'EMITIDA';
  reason_code: CreditNoteReasonCode;
  reason_text: string;
  total_cents: number;
  issued_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  method: PaymentMethod;
  amount_cents: number;
  reference: string | null;
  gateway: string | null;
  gateway_event_id: string | null;
  received_at: string;
  note: string | null;
  created_at: string;
};

/**
 * Compra a proveedor. Confirmarla genera movimientos ENTRADA_COMPRA
 * (ref_type='PURCHASE'), lotes, actualiza cost_cents (último costo) y crea el
 * egreso automático. Anularla revierte movimientos y egreso.
 */
export type PurchaseRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  supplier_id: string | null;
  /** date `YYYY-MM-DD`. */
  purchased_on: string;
  doc_number: string | null;
  status: 'BORRADOR' | 'CONFIRMADA' | 'ANULADA';
  total_cents: number;
  method: PaymentMethod | null;
  note: string | null;
  confirmed_at: string | null;
  annulled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseItemRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  purchase_id: string;
  catalog_item_id: string;
  /** En unidad de COMPRA del ítem. */
  qty: number;
  /** Por unidad de compra, en centavos. */
  unit_cost_cents: number;
  lot_code: string | null;
  expires_on: string | null;
  created_at: string;
};

/**
 * Egreso/gasto de la clínica. Los manuales se crean desde Finanzas; los de
 * categoría COMPRA_INVENTARIO con purchase_id los genera la compra y solo se
 * anulan desde ella.
 */
export type ExpenseRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  category: string;
  amount_cents: number;
  /** date `YYYY-MM-DD`. */
  expense_date: string;
  method: PaymentMethod;
  supplier_id: string | null;
  note: string | null;
  /** Comprobante en el bucket expense-receipts. */
  attachment_path: string | null;
  /** Compra que generó este egreso. null = gasto manual. */
  purchase_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentApplicationRow = {
  id: string;
  payment_id: string;
  invoice_id: string;
  amount_cents: number;
  created_at: string;
};

// ─── Motor de cartera (0034_facturacion_cartera) ─────────────────────────────

export type CommsChannel = 'WHATSAPP' | 'EMAIL';

/** Autorización del cliente por canal (Ley 2300: solo canales autorizados). */
export type ChannelAuthorizationRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  owner_id: string;
  channel: CommsChannel;
  granted: boolean;
  granted_at: string;
  revoked_at: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export type CommMessageStatus = 'EN_COLA' | 'ENVIADO' | 'ENTREGADO' | 'LEIDO' | 'FALLIDO';
export type CommMessageDirection = 'SALIENTE' | 'ENTRANTE';

/** Outbox unificado de cobranza (distinto de whatsapp_messages del hilo general). */
export type CommMessageRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  invoice_id: string | null;
  owner_id: string | null;
  channel: CommsChannel;
  direction: CommMessageDirection;
  to_address: string | null;
  template: string | null;
  body: string;
  status: CommMessageStatus;
  provider: string | null;
  provider_message_id: string | null;
  wa_conversation_id: string | null;
  authorization_id: string | null;
  idempotency_key: string | null;
  rule_snapshot: Record<string, unknown> | null;
  intent: string | null;
  agent_action: string | null;
  error: string | null;
  retry_count: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReminderStatus = 'PENDIENTE' | 'EN_COLA' | 'ENVIADO' | 'OMITIDO' | 'CANCELADO';

/** Paso de seguimiento programado por factura. */
export type InvoiceReminderRow = {
  id: string;
  invoice_id: string;
  step_kind: ReminderStepKind;
  scheduled_for: string;
  status: ReminderStatus;
  skipped_reason: string | null;
  sent_comm_id: string | null;
  created_at: string;
  updated_at: string;
};

export type HumanTaskKind =
  | 'VERIFICAR_COMPROBANTE'
  | 'DISPUTA'
  | 'SOLICITUD_PLAZO'
  | 'CONTACTO_SOLICITADO'
  | 'MENSAJE_NO_ENTREGADO'
  | 'OTRO';
export type HumanTaskStatus = 'ABIERTA' | 'EN_PROGRESO' | 'RESUELTA' | 'DESCARTADA';

/** Escalamiento a una persona de la clínica (el agente nunca decide montos/plazos). */
export type HumanTaskRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  kind: HumanTaskKind;
  invoice_id: string | null;
  owner_id: string | null;
  status: HumanTaskStatus;
  title: string;
  payload: Record<string, unknown> | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Comprobante de transferencia recibido (bucket privado `receipts`). */
export type ReceiptAttachmentRow = {
  id: string;
  clinic_id: string;
  created_by: string | null;
  invoice_id: string | null;
  comm_message_id: string | null;
  file_path: string;
  content_type: string | null;
  verified_by_task_id: string | null;
  created_at: string;
};
