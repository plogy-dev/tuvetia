# Incidentes conocidos — síntoma, causa y qué hacer

> **Para qué existe.** La mitad de los "fallos" de este sistema son comportamientos deliberados que
> parecen fallos. Este documento los separa de los problemas reales, para que quien opere no salga a
> arreglar algo que está bien — ni deje pasar algo que no.
>
> Casi todos salieron de ocurrir de verdad entre julio y agosto de 2026. Los que no, están marcados.

---

## Lo primero: este sistema **degrada, no revienta**

Es una decisión de diseño que se repite en todo el repo, y hay que conocerla para diagnosticar. Ante
un fallo de una pieza no crítica, la pieza desaparece y el resto sigue:

| Pieza | Si falla |
|---|---|
| Señales del riel | Falta esa línea, el resto se muestra. **Deja rastro** en `caidas` |
| Juez de evidencia | Falla **abierto**: se responde igual |
| Verificación de fidelidad de citas | Falla abierto |
| Cohere (embeddings) | El retrieval degrada al Tier 1 léxico |
| Tope de gasto de IA | Falla **abierto**: si el `count` no responde, se permite la llamada |
| Briefing diario | No se escribe; las señales siguen viéndose igual |

La contracara: **un síntoma "no aparece nada" casi nunca significa "no hay nada"**. Significa que hay
que ir a mirar por qué.

---

## WhatsApp

### La sesión se cayó — **es normal**

**Síntoma:** dejan de entrar y salir mensajes. En Conexiones aparece desconectado.

**Causa:** Evolution es WhatsApp Web y la sesión expira sola. Medido en producción: duró **7 y 8
días** en las dos instalaciones (conectadas el 03-ago, caídas el 10 y el 11).

**No está roto.** Reconectar: Configuración → Conexiones → Conectar, y escanear el QR.

**Cómo se avisa** (desde el 16-ago): señal *"WhatsApp desconectado"* con los días que lleva, en el
riel del dashboard, la tira de móvil, el prompt de Athos y el briefing. Antes de eso el aviso era
pasivo y **se estuvo cinco días caído sin que nadie se enterara**.

**Mientras está caído:** cartera no manda recordatorios, y `send_whatsapp_message` de Athos falla al
aprobar la acción — con mensaje explícito, no en silencio.

### Se guardan conversaciones que no son de clientes

**Síntoma:** aparecen conversaciones ajenas a la clínica en la bandeja.

**Causa:** al conectar un número, Evolution ingiere **todas** sus conversaciones. Medido: de 6.666
mensajes almacenados, el **98,7 % no está vinculado a ningún titular**, y **83 de 85 personas** no son
clientes.

**No hay arreglo desplegado.** Es una decisión de producto pendiente. Recomendación mientras tanto:
que la clínica conecte un número que use **sólo** para la clínica.

### El multimedia crece sin techo

**Síntoma:** el almacenamiento de Supabase sube y no baja.

**Causa:** el multimedia de WhatsApp se descarga y se guarda, y **ningún cron lo purga** — a
diferencia del audio de consultas, que sí tiene retención de 4 días. Medido: **258 MB en 9 días** de
un solo número, con archivos de hasta 10 MB.

**No hay arreglo desplegado.** Pendiente: aplicarle una retención como la del audio.

---

## IA y costo

### Un veterinario ve "sin cupo" (HTTP 402)

**Síntoma:** el asistente responde que no hay cupo.

**Causa:** la clínica agotó su tope mensual de llamadas. Sin `ATHOS_TOPE_MENSUAL_POR_CLINICA`
definida rige el **techo de contención de 1000**. El cupo se cuenta por calendario de Bogotá y se
renueva el día 1.

**Qué hacer:** subir el tope en la variable, o `"ninguno"` para apagarlo. **No es un fallo** — es el
techo funcionando.

### El modelo que responde no es el configurado

**Síntoma:** en `/admin/costos` aparece un modelo distinto del esperado.

**Causa:** la **cascada** cayó a un respaldo porque el primario falló (saldo, cuota, credencial, 429,
503, timeout). Nació de un incidente real: el 31-jul Anthropic se quedó sin crédito y el asistente se
cayó entero, mientras el chat clínico —que sí tenía cascada— siguió respondiendo.

**Es el sistema funcionando.** Lo que hay que revisar es **por qué falló el primario**: casi siempre
es saldo.

**Dato de operación:** hoy responde `deepseek-v4-flash` en las cuatro superficies. El proveedor
caliente es DeepSeek, no Anthropic.

---

## Crons

### El briefing no apareció para una clínica

Los cinco motivos que registra `generarBriefings`, y sólo uno es un problema:

| Motivo | Qué significa |
|---|---|
| `apagado` | La clínica lo tiene desactivado. Correcto |
| `ya-existe` | Ya había uno de hoy. Correcto (y es lo que pasa si el cron corre dos veces) |
| `sin-senales` | No había nada que contar. Correcto |
| `modelo-vacio` | El modelo devolvió vacío. Se pagó la llamada y no se guardó nada |
| 🔴 `senales-caidas` | **Una consulta a la base falló.** No es "está al día": es "no pude averiguarlo" |

Ese último existe por un incidente del 16-ago: dos clínicas con notas pendientes se saltaron como
"nada que contar" y no había forma de saber por qué, porque el error se descartaba sin registrarlo.

### Cartera no manda nada y no da error

**Síntoma:** el barrido corre en verde y ningún titular recibe nada.

**Causa probable:** `CARTERA_MESSAGING_SIMULATED='1'`. Con esa variable la mensajería se reemplaza por
una simulada (`channels.ts:115`) que **no envía y no falla**. Existe para pruebas locales sin
credenciales.

**En producción debe estar ausente o distinta de `'1'`.** `/api/health` lo comprueba como
`cartera_envio_real` — es literalmente el fallo silencioso que ese endpoint existe para atrapar.

### Un cron devuelve 401

`CRON_SECRET` desincronizado entre Vercel y los secretos de GitHub Actions. Ver el runbook.

---

## Datos y permisos

### Una nota clínica no se puede editar

**Causa:** está aprobada, y la migración `0054` la vuelve **inmutable**. Es intencional: una nota
aprobada entró a la historia clínica.

### Un usuario no entra a `/admin`

**Causa:** su correo no está en `PLATFORM_ADMIN_EMAILS`. **Falla cerrado**, que es lo correcto.

### Un usuario ve "cuenta desactivada"

**Causa:** su perfil tiene `is_active = false`. Se cambia desde `/admin/usuarios`. El gate de la
`0059` lo aplica en nueve rutas de API y en la RLS.

### Athos dice que no puede mandar un correo

**Causa:** la conexión de Composio de **esa persona** se cayó o fue revocada. Las conexiones viven en
los servidores de Composio, son **por persona**, y la fuente de verdad es Composio — no nuestra base.

**Qué hacer:** que esa persona reconecte en Configuración → Conexiones. El fallo aparece **al aprobar
la acción**, con el texto correcto, porque `ENVIA_AFUERA` lo distingue de otros errores.

---

## Build y CI

### El build de Turbopack falla y al reintentar pasa

Ocurrió al menos tres veces (una en el PR #92, dos el 16-ago). Errores de resolución de módulos —una
vez la fuente de Google— que desaparecen en la corrida siguiente sin cambiar nada.

**Antes de darlo por transitorio:** borrar `.next` y correr dos builds limpios seguidos. Si los dos
pasan, era transitorio. Si falla igual, es real.

### `tsc` parece pasar y no pasaba

Trampa de verificación, no del sistema. `npx tsc --noEmit | tail -5; echo $?` informa el exit de
`tail` —**siempre 0**— no el de `tsc`. Capturá la salida a un archivo y consultá el código real.

---

## Qué NO está monitoreado

Para que nadie lo suponga:

- **No hay servicio de seguimiento de errores contratado.** `onRequestError` captura los fallos de
  servidor y los estructura, pero van a la consola. Aplazado a propósito hasta el lanzamiento; ver el
  hallazgo 4 de la auditoría.
- **No hay alertas por caída de un canal** más allá de la señal en pantalla. Un vet que no abre la app
  en tres días no se entera.
- **`/api/health` mira configuración, no estado vivo.** Sus 14 chequeos son variables de entorno.
  Responde *"¿está cableado?"*, no *"¿está funcionando?"*.
