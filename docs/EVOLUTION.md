# Evolution API — transporte de WhatsApp (Baileys, NO oficial)

Decisión 2026-07-28: el transporte principal de WhatsApp es **Evolution API** (wrapper multi-tenant
de Baileys, protocolo WhatsApp Web). Sin trámite de Meta, sin plantillas, QR dentro de tuvetia y
sync completo del número (incluye lo que el vet escribe desde su teléfono). El costo es el riesgo
de baneo — mitigado con protecciones de comportamiento y consentimiento explícito de la clínica
(ver §Protecciones). Kapso y Meta directo siguen disponibles como adaptadores por tenant
(`whatsapp_integrations.provider`): una clínica baneada puede migrar al camino oficial en minutos.

## Deploy (Railway, junto a athos-service)

Evolution necesita un proceso PERSISTENTE (mantiene las sesiones WebSocket) — no vive en Vercel.

1. Nuevo servicio en Railway desde la imagen Docker oficial:
   - Imagen: `evoapicloud/evolution-api:latest` (o pinnear una versión 2.x).
   - Volumen persistente montado en `/evolution/instances` (credenciales de sesión de cada número).
   - Postgres para Evolution: puede ser una DB propia pequeña en Railway (recomendado) —
     variables `DATABASE_ENABLED=true`, `DATABASE_PROVIDER=postgresql`,
     `DATABASE_CONNECTION_URI=<postgres de railway>`.
2. Variables del contenedor:
   - `AUTHENTICATION_API_KEY=<llave global fuerte>`  ← misma que `EVOLUTION_API_KEY` en Vercel
   - `SERVER_URL=https://<subdominio-railway>`
   - `WEBHOOK_GLOBAL_ENABLED=false` (los webhooks se registran por instancia desde tuvetia)
   - `CONFIG_SESSION_PHONE_CLIENT=Tuvetia` (nombre que ve el vet en Dispositivos vinculados)
   - `QRCODE_LIMIT=30`
3. Variables en Vercel (tuvetia):
   - `EVOLUTION_BASE_URL=https://<subdominio-railway>`
   - `EVOLUTION_API_KEY=<la misma llave global>`
   - `EVOLUTION_WEBHOOK_TOKEN=<token largo aleatorio>` (openssl rand -hex 32) — segmento secreto
     de la URL del webhook (Evolution no firma sus webhooks)
   - `NEXT_PUBLIC_WA_PROVIDER=evolution` (activa el flujo de QR en Configuración)
4. Smoke test: `GET {EVOLUTION_BASE_URL}/instance/fetchInstances` con header `apikey` → 200 `[]`.

## Flujo por clínica

1. Configuración → WhatsApp: checkbox de consentimiento (integración no oficial) → "Conectar".
2. `POST /api/whatsapp/evolution/connect` crea la instancia `tuvetia_<clinic_id>`, registra el
   webhook (`/api/whatsapp/evolution/webhook/<EVOLUTION_WEBHOOK_TOKEN>`, eventos MESSAGES_UPSERT +
   CONNECTION_UPDATE) y devuelve el QR.
3. El vet escanea (WhatsApp → Dispositivos vinculados). `connection.update: open` → la integración
   pasa a `connected` (el front también pollea /status cada 3 s).
4. Mensajes: `messages.upsert` se normaliza a `whatsapp_messages` (entrantes Y salientes del
   teléfono → sync total). El envío sale por `sendWhatsAppText` → adaptador Evolution.

## Protecciones (por qué esto no es un bot de spam)

- **Inbound-first**: el agente solo responde entrantes; no hay envíos masivos ni en frío.
- **Cadencia humana**: presencia "escribiendo…" + delay proporcional al largo del texto
  (1.2–3.5 s con jitter) en TODO envío por Evolution.
- **Warm-up**: número recién conectado arranca con 5 respuestas auto/día y sube +5/día hasta el
  límite configurado (`auto_daily_limit`, default 30).
- **Anti-loop**: máx. 8 respuestas auto/hora por conversación + debounce de 5 s + idempotencia.
- **Grupos y broadcasts: JAMÁS** (filtrados en el webhook; el agente ni los ve).
- **Nada clínico en auto**: el clasificador responde solo horarios/ubicación/citas; ante duda,
  silencio.
- **Consentimiento**: la clínica acepta explícitamente el aviso de integración no oficial
  (unofficial_consent_at/by + audit_logs).
- **Contención**: todos los mensajes viven en nuestra BD (un baneo no pierde historial);
  desconexión detectada → banner rojo en Configuración; la clínica puede pasarse al adaptador
  oficial (Meta) sin perder datos.

## Operación

### ⚠️ El Postgres de Evolution se llena, y se cae como «el servicio está fallando (500)»

**Pasó el 2-sep-2026** y costó tres días de diagnóstico en la dirección equivocada. Vale la pena
leer esto antes de tocar nada cuando los envíos fallan.

**El síntoma engaña.** La pantalla dice **Conectado**, el número está bien, `connectionState`
responde `open` — y todo envío devuelve **500**. No es la línea: la conexión de WhatsApp está
perfecta. Es que Evolution, en cada envío, **escribe el mensaje en su Postgres**, y con el volumen
al 100% esa escritura falla. Nosotros sólo vemos el 500.

**Cómo confirmarlo en 10 segundos:** Railway → el servicio de Postgres de Evolution → el volumen.
Si dice *«Volume Is Full — at 100% capacity»*, es esto y no hace falta buscar más.

**Lo que NO hay que hacer:** desconectar y volver a escanear el QR. No arregla nada y empeora —
crear una instancia nueva también es una escritura en ese mismo Postgres, así que se pierde la que
había y no se puede hacer otra. (Por eso el mensaje de error de un 5xx dice «no es tu conexión, es
el servicio» y manda a soporte en vez de a reconectar: ver `lib/whatsapp/error-de-envio.ts`.)

**El orden para resolverlo:**

1. **Agrandar el volumen** en Railway. Es lo único que destraba en el momento: mientras esté al
   100%, ninguna otra acción que escriba va a funcionar — ni siquiera limpiar.
2. **Podar.** Lo que crece sin techo son las tablas de historial de Evolution (`Message`,
   `MessageUpdate`, `Chat`, `Contact`). `MessageUpdate` es la peor: un registro por cada acuse de
   entrega y de lectura, de cada mensaje, para siempre.
3. **Apagar lo que no necesitamos guardar dos veces.** Evolution tiene variables
   `DATABASE_SAVE_*` para elegir qué persiste — **verificá los nombres exactos contra la versión de
   la imagen que estés corriendo**, cambian entre versiones.

**Y ACÁ ESTÁ LA PARTE QUE HACE QUE ESTO SEA SEGURO:** *nosotros ya guardamos todos los mensajes*.
`whatsapp_messages` en Supabase tiene cada entrante y cada saliente — es una decisión de diseño
anotada más arriba («todos los mensajes viven en nuestra BD; un baneo no pierde historial»). O sea
que el historial que Evolution acumula es una **segunda copia que nadie lee**. Apagar la
persistencia de mensajes, acuses, chats y contactos no nos hace perder nada.

**Lo que SÍ tiene que seguir guardándose** son las credenciales de sesión de cada instancia: es lo
que evita que todas las clínicas tengan que re-escanear el QR en cada reinicio del contenedor.
Antes de apagar cualquier variable, comprobá cuál gobierna eso en tu versión — apagar la equivocada
desloguea a todas las clínicas de una.

**Monitoreo:** una alerta de volumen al 80% en Railway. Este fallo no avisa: se manifiesta como un
500 genérico del lado del vet, sin ninguna pista de que el problema es de disco.

### Desconexiones

- Desconexión (`connection.update: close` o "Verificar" con estado close) → `disconnected` +
  banner. Reconectar = re-escanear QR.
- **Un 404 del proveedor cuenta como línea perdida** (`lib/whatsapp/send-message.ts`): si la
  instancia ya no existe del lado de Evolution, es la evidencia más fuerte que hay. Un 5xx, en
  cambio, NO se trata como desconexión — por lo de arriba.
- Baneo sospechado: la instancia queda `close` y el número no re-vincula → contactar al vet,
  evaluar apelación en la app de WhatsApp, y ofrecer migración al proveedor `meta`.
- Actualizaciones de Evolution: el protocolo de WhatsApp cambia; pinnear versión y actualizar
  con ventana de prueba (una clínica canario primero).
