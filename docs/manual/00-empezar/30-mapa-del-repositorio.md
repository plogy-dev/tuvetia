---
titulo: Mapa del repositorio
seccion: empezar
orden: 30
resumen: Qué hay en cada carpeta y dónde buscar cuando no sabés por dónde empezar.
---

# Mapa del repositorio

## Nivel superior

| Carpeta / archivo | Qué es |
|---|---|
| `src/` | La aplicación Next.js entera |
| `athos-service/` | El servicio Python (FastAPI) **y el esquema SQL** de Supabase |
| `docs/` | Documentación: este manual y el histórico |
| `e2e/` | Tests end-to-end |
| `adversarios/` | El banco adversario del agente: mide si obedece lo que *lee* |
| `scripts/` | Utilidades sueltas |
| `public/` | Estáticos |
| `.agents/` | Skills de terceros instalados. **No es documentación de Tuvetia** |
| `AGENTS.md` / `CLAUDE.md` | Instrucciones para agentes de código que trabajen en el repo |

## `src/`

```
src/
├── app/                    rutas (App Router)
│   ├── (marketing)/        landing pública
│   ├── dashboard/          el producto — requiere sesión
│   ├── admin/              panel de plataforma — allowlist de correos
│   ├── api/                rutas HTTP: webhooks, crons, agente
│   ├── auth/ login/ signup/ invitar/ bienvenida/   entrada y alta
│   ├── f/[token]  baja/[token]                     enlaces públicos con token
│   └── legal/              términos y privacidad
├── components/             UI, agrupada por dominio
│   └── ui/                 los primitivos (shadcn sobre Base UI)
├── hooks/
└── lib/                    toda la lógica
```

### `src/lib` — el corazón

La regla del repositorio: **la lógica que se puede probar vive en un `.ts` puro**, separada de la
pantalla que la usa.

| Módulo | Qué resuelve |
|---|---|
| `agenda/` | Filtro de citas, huecos del día, horario por persona, destinatarios del calendario |
| `athos-agent/` | El agente con herramientas: tools, prompt, cupos, validación de payloads |
| `athos-context/` | Qué contexto se le arma al prompt |
| `facturacion/` | 39 archivos: facturas, notas crédito, numeración, inventario, compras |
| `cartera/` | Cobranza: recordatorios, clasificación de respuestas, canales |
| `whatsapp/` | Los tres proveedores, el webhook, el modo automático, errores de envío |
| `composio/` | Correo y calendario vía Composio |
| `planes/` | Qué incluye cada plan. **El único lugar donde se decide** |
| `suscripcion/` `wompi/` | Cobro y renovación |
| `supabase/` | Los clientes: navegador, servidor y admin (`service_role`) |
| `docs/` | El catálogo de esta documentación |
| `tablero/` | Métricas elegibles del tablero |
| `consulta-viva/` | La sesión del Modo Fantasma |
| `email/` | Correo transaccional (Resend) |
| `admin/` | Métricas del panel de plataforma |

## `athos-service/`

Contiene **dos cosas distintas**, y conviene no confundirlas:

| Ruta | Qué es |
|---|---|
| `app/` | El servicio FastAPI: RAG, ingesta, generación, memoria de paciente |
| `supabase/bootstrap/` | El esquema base de Postgres (`000_base_schema.sql`) |
| `supabase/migrations/` | Las migraciones numeradas, de `0006` a `0080` |
| `supabase/verificaciones/` | Un `.sql` por migración que comprueba que quedó aplicada |
| `docs/` | Documentación del servicio |

Que el SQL de la aplicación viva bajo `athos-service/` es una herencia del orden en que se
construyeron las cosas, no una decisión de diseño. **Esas migraciones gobiernan la base entera**, no
sólo la parte de Athos.

## Dónde buscar según qué necesites

| Necesito… | Empezar por |
|---|---|
| Entender una pantalla | `src/app/dashboard/<seccion>/page.tsx` — los comentarios de cabecera explican el porqué |
| Entender una regla de negocio | El `.ts` puro correspondiente en `src/lib/` |
| Saber por qué algo es así | El `.md` del tema en la raíz (`CALENDARIO.md`, `WHATSAPP.md`, `BILLING.md`…) |
| Cambiar el esquema | `athos-service/supabase/migrations/`, con el número siguiente al último |
| Ver qué se rompe sin una variable | [Secretos y variables](../30-referencia/10-secretos.md) |

## Una convención que llama la atención

Los archivos de este repositorio tienen **comentarios largos en español que explican el porqué**, no
el qué. No son ruido: buena parte de las decisiones —por qué el calendario va donde va, por qué el
antisolape de citas es un trigger y no un chequeo en las funciones, por qué el permiso de agenda es
una columna y no un rol— están escritas ahí y en ningún otro lado.

Antes de cambiar algo que parece raro, leé la cabecera de su archivo: casi siempre hay un incidente
detrás.
