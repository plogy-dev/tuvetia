# -*- coding: utf-8 -*-
"""Genera el dossier de evidencias del Milestone 2 en DOCX (editable) y PDF.

El contenido se define UNA vez y se renderiza a los dos formatos: el DOCX es para que el equipo
pegue capturas y enlaces a los videos; el PDF es el entregable formal.
"""
import pathlib
import subprocess

SALIDA = pathlib.Path("C:/DevsJesus/tuvetia/skeleton/docs/entrega")
SALIDA.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------------------------
# Contenido. Cada bloque es (tipo, texto). Tipos: h1 h2 h3 p b(ullet) quote code tabla hueco
# ---------------------------------------------------------------------------------------------

def commit(h, fecha, msg):
    return ("code", f"{h}   {fecha}   {msg}")


C = []
A = C.append

A(("h1", "Dossier de evidencias — Milestone 2"))
A(("p", "Contrato COT-2026-TUV-001 · TUVET IA · Corte: 31 de julio de 2026"))
A(("p", "Este documento reúne la evidencia verificable del cumplimiento del Milestone 2. "
        "Cada afirmación va acompañada del identificador de commit y la fecha, de modo que "
        "cualquiera pueda comprobarla ejecutando `git show <commit>` sobre el repositorio."))

A(("h2", "Cómo leer este documento"))
A(("p", "Hay tres clases de evidencia y conviene no mezclarlas, porque tienen fuerza distinta:"))
A(("b", "Evidencia documental (la más fuerte). Un commit con su fecha. No se puede alterar sin "
        "reescribir la historia del repositorio, y cualquier auditor la reproduce en segundos."))
A(("b", "Evidencia de estado. Una consulta a la base de datos de producción o una respuesta de un "
        "endpoint. Demuestra qué hay hoy, no desde cuándo."))
A(("b", "Evidencia de comportamiento. Una medición sobre un banco de casos, o un video del sistema "
        "funcionando. Demuestra que hace lo que se dice que hace."))
A(("p", "Los apartados de abajo usan las tres. Donde una afirmación no tiene respaldo, se dice."))

A(("h2", "Resumen ejecutivo"))
A(("p", "El repositorio nace el 13 de julio de 2026 y el primer despliegue a producción "
        "(Railway para el backend, Vercel para el frontend) es del 16 de julio. Entre esas dos "
        "fechas ya estaban implementadas las dos garantías centrales del hito:"))
A(("b", "Verificación de citas — `verify_citations` existe desde el primer commit (13-jul)."))
A(("b", "Abstención — `passes_threshold` e `insufficient_evidence` existen desde el primer commit "
        "(13-jul)."))
A(("p", "Las dos semanas siguientes no fueron de implementación sino de CALIBRACIÓN: medir la "
        "primera versión, encontrar dónde fallaba y corregirla con datos. Esa distinción importa, "
        "porque explica por qué una función podía estar en producción y aun así no comportarse "
        "todavía como debía."))

A(("quote", "La abstención estaba implementada desde el día uno. Lo que no estaba era CALIBRADA: "
            "el umbral determinístico daba «hay evidencia» en 187 de 187 casos porque estaba "
            "saturado. Eso no es una función ausente, es una primera versión midiendo mal."))

# --- línea de tiempo -------------------------------------------------------------------------
A(("h2", "Línea de tiempo del proyecto"))
A(("p", "Cronología completa, de lo más antiguo a lo más reciente. Todos los identificadores son "
        "verificables con `git show`."))

A(("h3", "Semana 1 — arquitectura y primer despliegue (13 al 16 de julio)"))
for h, f, m in [
    ("cca7b87", "13-jul", "Entorno base del servicio + esquema RAG + scaffolding"),
    ("6fd6de7", "13-jul", "Migración 0002: índice vectorial HNSW (corpus_chunks, patient_embeddings)"),
    ("fb922e6", "14-jul", "Núcleo determinístico: CITAS, cascada de recuperación, ingesta, gate de alergia"),
    ("5c12135", "14-jul", "Tier 1 léxico+glosario, Tier 2 vector, contexto de paciente, tests cross-tenant"),
    ("1433db8", "14-jul", "Generación B→A: armado, parseo y VERIFICACIÓN de la nota SOAP"),
    ("2f3829d", "15-jul", "Endpoint /athos/phantom/suggest funcionando de punta a punta"),
    ("f6660a1", "16-jul", "DESPLIEGUE: Railway (backend) + Vercel (frontend)"),
]:
    A(commit(h, f, m))
A(("p", "Al cierre de esta semana el sistema está EN PRODUCCIÓN con: recuperación en cascada, "
        "verificación de citas, gate de alergia severa, umbral de abstención y aislamiento por "
        "clínica cubierto por pruebas."))

A(("h3", "Semana 2 — corpus, módulos y primeras mediciones (21 al 27 de julio)"))
for h, f, m in [
    ("02f1d25", "21-jul", "El Fantasma no citaba por A→B pobre: banco golden de 4/11 a 9/11"),
    ("a667277", "22-jul", "El Fantasma persiste alertas en clinical_notes (migración 0004)"),
    ("ab385cc", "23-jul", "Agenda interna + sincronización con Google Calendar v1"),
    ("1924924", "23-jul", "Vinculación de Google Calendar en un clic desde el login"),
    ("5bc9e1b", "23-jul", "Captura de consulta con consentimiento (Ley 1581) + transcripción Deepgram"),
    ("32ec1bf", "24-jul", "Invitaciones de equipo a la clínica"),
    ("7e1d41c", "27-jul", "Reranking con Cohere + memoria semántica del paciente"),
]:
    A(commit(h, f, m))
A(("p", "El 26 de julio termina la ingesta del corpus completo en producción: 61.544 documentos, "
        "519.999 fragmentos, el 100% con embedding."))

A(("h3", "Semana 3 — se mide, y la medición encuentra los problemas (28 al 29 de julio)"))
for h, f, m in [
    ("201972f", "28-jul", "El Tier 1 tardaba 15s de servidor; separando las ramas, 143 ms"),
    ("58259da", "28-jul", "ABSTENCIÓN: juez semántico en bandas (none/limited/sufficient)"),
    ("21cebd1", "29-jul", "Auditor de fidelidad de citas — apagado: sin calibrar descartaba el 58%"),
    ("05d1bd0", "29-jul", "El rol del hablante se infiere del CONTENIDO, no de quién habló primero"),
    ("47d02c9", "29-jul", "Documento de resultados del smoke testing del agente"),
    ("8577be1", "29-jul", "24 de los 42 negativos no eran negativos: el instrumento estaba roto"),
]:
    A(commit(h, f, m))
A(("p", "Este es el punto de inflexión del proyecto. Al construir el instrumento de medición se "
        "descubre que varias funciones que existían no se comportaban como debían — y también que "
        "el propio instrumento estaba mal. Los dos hallazgos se corrigen."))

A(("h3", "Semana 4 — subsanación (30 y 31 de julio)"))
for h, f, m in [
    ("2303731", "30-jul", "Gemini integrado y cascada entre proveedores"),
    ("a507043", "30-jul", "Routing POR CONSULTA (cláusula 1.5)"),
    ("ca31838", "30-jul", "La cascada registra qué modelo respondió de verdad"),
    ("aa7a72c", "30-jul", "Transcripción EN VIVO por WebSocket contra Deepgram"),
    ("ac8fb8d", "30-jul", "El invitado sin cuenta ya puede entrar (defecto del enlace de correo)"),
    ("cec3661", "31-jul", "Abstención: corroboración determinística — seguridad 82,4% a 92,6%"),
    ("557232e", "31-jul", "Los 5 defectos de la conversación con el agente"),
    ("97ef13c", "31-jul", "Banco de calidad del agente, corrido contra producción"),
    ("4e45c00", "31-jul", "CASCADA EN EL AGENTE: deja de caerse por un solo proveedor"),
]:
    A(commit(h, f, m))

# --- punto por punto -------------------------------------------------------------------------
A(("h1", "Evidencia punto por punto"))

PUNTOS = [
    {
        "n": 1, "titulo": "Cascada y routing entre tres modelos",
        "desde": "30 de julio de 2026 · extendida a la capa agéntica el 31 de julio",
        "honesto": True,
        "historia": [
            ("Situación previa", "Hasta el 29 de julio el sistema operaba con un único proveedor "
             "(DeepSeek). No existía cascada ni routing entre modelos. Esto conviene reconocerlo "
             "de frente: la observación del cliente sobre este punto era correcta."),
            ("Qué se hizo", "El 30 de julio se integró Gemini y se construyó la cascada entre "
             "proveedores (commit 2303731), se añadió el routing por consulta (a507043) y se "
             "amplió a los tres modelos con Claude (5cd027b). El 30 de julio se corrigió además "
             "el registro para que la traza guarde qué modelo respondió realmente (ca31838); "
             "antes anotaba un valor fijo, así que aunque hubiera habido fallback la traza no lo "
             "habría reflejado."),
            ("Estado hoy", "Los tres proveedores están configurados en las variables de producción "
             "de Railway (GEMINI_API_KEY, ANTHROPIC_API_KEY, LLM_API_KEY) junto con las tres "
             "cadenas de cascada. Verificado con caída forzada contra los tres proveedores "
             "reales."),
            ("Un hallazgo del 31 de julio, y su corrección", "La cascada cubría el servicio de RAG "
             "pero NO la capa agéntica: el asistente vive en Next y resolvía un único proveedor sin "
             "alternativa. Se descubrió de la peor forma posible — la cuenta de Anthropic se quedó "
             "sin crédito y el asistente se cayó entero, mientras el chat clínico siguió "
             "respondiendo con su respaldo. Corregido el mismo día (commit 4e45c00): la misma "
             "cascada, portada a TypeScript, con 23 pruebas."),
            ("La regla que gobierna el diseño", "Se cae al respaldo ANTES del primer token, nunca a "
             "mitad de respuesta. Coser dos modelos dejaría media respuesta de uno y media de otro, "
             "que en una nota clínica es peor que un error. Se consigue enganchando el momento en "
             "que el proveedor ACEPTA la petición: un rechazo por saldo, credencial o cuota llega "
             "antes de que salga un solo token."),
            ("Y sólo se reintenta lo que tiene sentido", "Saldo, cuota, credencial, límite de tasa, "
             "servicio caído y timeouts de red. Un error del propio código —un tool mal definido— "
             "fallaría igual en el segundo proveedor: reintentarlo sólo gastaría dinero y tiempo."),
        ],
        "tabla": ("Prueba de caída forzada (30-jul)", [
            ["Escenario", "Quién responde", "Latencia"],
            ["Camino feliz", "DeepSeek", "1,4 s"],
            ["Primario caído", "Gemini", "3,9 s"],
            ["Primario y secundario caídos", "Claude", "3,7 s"],
        ]),
        "tabla2": ("Fallback contra un fallo REAL (31-jul, capa agéntica)", [
            ["Qué pasó", "Resultado"],
            ["Anthropic rechaza por saldo agotado", "«Your credit balance is too low…»"],
            ["La cascada cae a DeepSeek", "respondió «OK»"],
            ["Respuesta entregada al usuario", "sí, sin interrupción"],
        ]),
        "limite": "La traza del chat clínico registra 16 respuestas históricas, todas atendidas "
                  "por DeepSeek: su primario nunca falló, así que su cascada nunca tuvo que "
                  "activarse. Para ESA superficie la evidencia es la prueba de caída forzada, no "
                  "el log. En la capa agéntica, en cambio, el fallback SÍ se ejercitó contra un "
                  "fallo real —Anthropic sin crédito, el 31 de julio— y quedó registrado.",
        "verificar": "git show 2303731 · variables de Railway · docs/COMPARATIVA-MODELOS-2026-07-30.md",
    },
    {
        "n": 2, "titulo": "Smoke testing del agente",
        "desde": "29 de julio de 2026",
        "historia": [
            ("Qué se hizo", "El 29 de julio se construyó la suite de smoke testing del agente y su "
             "documento de resultados (commit 47d02c9). Son 22 casos que corren en integración "
             "continua en cada cambio."),
            ("Valor demostrado", "La suite no es un trámite: al construirla encontró un defecto "
             "real que estaba en producción — la corrupción silenciosa de fechas, donde una fecha "
             "inválida como 2026-02-30 se agendaba el 2 de marzo sin avisar (commit ba2b3f9)."),
            ("Estado hoy", "22 casos en CI. Además, el ciclo agéntico completo quedó verificado en "
             "producción el 30 de julio: el asistente propuso una cita, apareció la tarjeta de "
             "aprobación, el veterinario aprobó y la acción quedó ejecutada con un identificador "
             "de cita real."),
        ],
        "verificar": "docs/AGENT-SMOKE-TESTING.md · git show 47d02c9 · git show ba2b3f9",
    },
    {
        "n": 3, "titulo": "Abstención — «cita o se calla»",
        "desde": "13 de julio de 2026 (primera versión) · calibrada el 31 de julio",
        "historia": [
            ("Implementación original", "El mecanismo existe desde el PRIMER COMMIT del repositorio "
             "(cca7b87, 13 de julio): `passes_threshold` decide si hay evidencia suficiente y "
             "`insufficient_evidence` viaja en el contrato de la API hacia el frontend. Es decir, "
             "la función estaba implementada y desplegada desde el 16 de julio."),
            ("Qué falló en esa primera versión", "Al medirla el 27 de julio sobre 187 casos se "
             "descubrió que el umbral daba «hay evidencia» en 187 de 187. La causa: el score "
             "estaba SATURADO por las constantes del Tier 1, y además el descriptor de especie "
             "(«Dogs», presente en 43.000 fragmentos) contaba como evidencia temática. La función "
             "existía; su criterio no discriminaba."),
            ("Primera corrección", "El 28 de julio (commit 58259da) se añadió un juez semántico que "
             "LEE los pasajes recuperados y dictamina en bandas: ninguna, limitada o suficiente. "
             "Se probaron antes tres señales gratuitas y las tres se descartaron con datos: el "
             "score determinístico (1.701 contra 1.700), el del reranker (0,532 contra 0,499) y el "
             "número de citas (6,0 contra 6,0). Ninguna discriminaba."),
            ("Segunda corrección", "El 31 de julio se descubrió que el propio instrumento de "
             "medición estaba mal: el banco etiquetaba «¿el corpus contiene esto?» mientras la "
             "abstención decide «¿los pasajes recuperados cubren la consulta?». Sólo coinciden en "
             "el 74% de los casos. Se construyó una verdad mecánica basada en el árbol MeSH y se "
             "añadió una corroboración determinística (commit cec3661)."),
        ],
        "tabla": ("Evolución medida", [
            ["Momento", "Seguridad", "Utilidad"],
            ["Primera versión (umbral solo)", "no discriminaba (187/187)", "—"],
            ["Con juez semántico", "82,4 %", "63,3 %"],
            ["Con corroboración determinística", "92,6 %", "65,5 %"],
            ["Mitad del banco no usada al calibrar", "94,5 %", "67,1 %"],
        ]),
        "limite": "No existe el 100% en un juicio semántico: «¿esta literatura cubre este caso?» "
                  "admite grados y dos veterinarios expertos discrepan en los bordes. Además el "
                  "banco tiene 188 casos, así que un caso vale medio punto porcentual.",
        "verificar": "git show cca7b87 · git show 58259da · git show cec3661 · "
                     "docs/ABSTENCION-MEDICION-2026-07-30.md",
    },
    {
        "n": 4, "titulo": "Citas de fuentes correctas",
        "desde": "13 de julio de 2026 (primera versión) · segunda capa el 29 de julio",
        "historia": [
            ("Implementación original", "La verificación de citas existe desde el PRIMER COMMIT "
             "(cca7b87, 13 de julio) y se consolida el 14 de julio en el núcleo determinístico "
             "(fb922e6). Está en producción desde el primer despliegue."),
            ("Por qué es una garantía estructural", "El modelo NO puede escribir una fuente. Lo "
             "único que emite es un número entre corchetes. El título, el año, la revista y el "
             "enlace los reconstruye el código desde el fragmento recuperado de la base de datos. "
             "Un número que no corresponda a un documento realmente recuperado se descarta. "
             "Inventar una fuente no es improbable: no está representado en el camino de datos."),
            ("Segunda capa", "El 29 de julio se añadió un auditor de fidelidad (commit 21cebd1) "
             "porque la procedencia sola no alcanzaba: medido, 18 de 24 respuestas citaban al "
             "menos un pasaje que no respaldaba la afirmación. Se entregó APAGADO por honestidad "
             "—sin calibrar descartaba el 58% de las referencias— y se encendió tras calibrarlo "
             "al 13-18%, sin dejar ninguna respuesta sin fuentes."),
        ],
        "limite": "La segunda capa sólo QUITA referencias, nunca agrega ni sustituye. Su único "
                  "error posible es ser demasiado estricta: jamás puede mostrar una cita "
                  "incorrecta.",
        "verificar": "git show cca7b87 · git show fb922e6 · git show 21cebd1",
    },
    {
        "n": 5, "titulo": "Latencia",
        "desde": "corregida el 28 de julio de 2026",
        "historia": [
            ("El síntoma reportado", "Se reportaron esperas de alrededor de cinco minutos."),
            ("La causa real", "No era la infraestructura ni el plan contratado: era una consulta "
             "SQL. El Tier 1 del buscador combinaba dos ramas con un OR, lo que obligaba al motor "
             "a ordenar unos 19.000 resultados antes de aplicar el límite. Tardaba 15.397 "
             "milisegundos y se cancelaba por statement_timeout — lo que el usuario percibe como "
             "un cuelgue, no como lentitud."),
            ("La corrección", "Separar las dos ramas (commit 201972f, 28 de julio). El mismo "
             "resultado en 143 milisegundos: 107 veces más rápido."),
        ],
        "tabla": ("Medición actual", [
            ["Qué", "Medido"],
            ["Consulta del Tier 1", "143 ms (antes 15.397 ms)"],
            ["Primer token del chat clínico", "12,8 s"],
            ["Respuesta completa", "27,6 s"],
            ["Carga de una página del frontend", "0,4 s"],
        ]),
        "verificar": "git show 201972f",
    },
    {
        "n": 6, "titulo": "Correo y módulo de comunicaciones",
        "desde": "29 y 30 de julio de 2026",
        "historia": [
            ("Qué se hizo", "El motor de recaudo con los límites de la Ley 2300 (commit bd005fa, "
             "29 de julio) y el envío real por SMTP con lectura de respuestas por IMAP "
             "(30 de julio). Incluye hilos de conversación, credenciales cifradas, pantalla de "
             "conexión, facturas por correo y recordatorios de cobranza."),
            ("Estado hoy", "Cubierto por 8 pruebas automáticas. Cada clínica conecta su propia "
             "cuenta desde la pantalla de ajustes: que el módulo esté completo no significa que "
             "una clínica concreta ya lo haya conectado."),
        ],
        "verificar": "git show bd005fa · src/lib/cartera/channels.ts",
    },
    {
        "n": 7, "titulo": "Google Calendar bidireccional",
        "desde": "23 de julio de 2026",
        "historia": [
            ("Implementación original", "La agenda interna con sincronización hacia Google es del "
             "23 de julio (commit ab385cc), junto con la vinculación en un clic desde el login "
             "(1924924). Las tablas de integración de calendario son del 23 de julio."),
            ("Qué faltaba", "Las credenciales de Google (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET) "
             "no estaban configuradas en producción, así que la sincronización no podía operar. "
             "Se configuraron el 31 de julio."),
            ("Estado hoy", "Dos cuentas conectadas y 11.550 de 11.566 citas con identificador de "
             "evento de Google. La sincronización está operando sobre datos reales."),
        ],
        "limite": "La traída automática desde Google hacia la plataforma requiere la verificación "
                  "de la aplicación por parte de Google, que es un trámite de un tercero (~10 "
                  "días). Mientras tanto funciona con un botón de sincronización manual.",
        "verificar": "git show ab385cc · consulta a appointments en producción",
    },
    {
        "n": 8, "titulo": "Transcripción de consultas",
        "desde": "23 de julio de 2026 · en vivo desde el 30 de julio",
        "historia": [
            ("Implementación original", "La captura de la consulta con consentimiento previo "
             "(Ley 1581) y la transcripción con Deepgram son del 23 de julio (commit 5bc9e1b), con "
             "corrección de la duración real del audio el mismo día."),
            ("Defecto 1 — roles invertidos", "El código asumía que el hablante 0 era el "
             "veterinario «porque normalmente inicia la consulta». Es falso: el dueño suele abrir "
             "(«Doctor, mi perro no come»), así que el diálogo entero salía invertido. Corregido "
             "el 29 de julio (commit 05d1bd0): el rol se infiere del CONTENIDO mediante marcadores "
             "lingüísticos, de forma determinística y auditable."),
            ("Defecto 2 — fecha errada", "Tres pantallas formateaban en UTC porque los componentes "
             "de servidor corren en UTC. Ancladas a la zona horaria de Bogotá, con pruebas que "
             "fuerzan UTC para que no vuelva a ocurrir."),
            ("Defecto 3 — por lotes", "El 30 de julio se implementó la transcripción EN VIVO por "
             "WebSocket contra Deepgram (commit aa7a72c). El veterinario ve el texto mientras "
             "habla."),
        ],
        "tabla": ("Verificación contra Deepgram real", [
            ["Métrica", "Resultado"],
            ["Exactitud", "92,3 %"],
            ["Exactitud ignorando formato numérico", "96,1 %"],
            ["Primer texto en pantalla", "1,6 s"],
            ["Fragmentos duplicados por reenvío", "0"],
        ]),
        "limite": "La prueba usó una consulta sintética de una sola voz, así que NO valida la "
                  "separación de hablantes: Deepgram no tiene pista acústica para distinguir dos "
                  "personas que suenan idénticas. La inferencia de rol sí tiene pruebas propias.",
        "verificar": "git show 5bc9e1b · git show 05d1bd0 · "
                     "scripts/calidad/transcripcion_vivo_verificar.py",
    },
    {
        "n": 9, "titulo": "Invitaciones de equipo",
        "desde": "24 de julio de 2026 · defecto corregido el 30 de julio",
        "historia": [
            ("Implementación original", "Invitar colegas a la clínica por enlace y correo es del "
             "24 de julio (commit 32ec1bf)."),
            ("El defecto", "Se reportó que el enlace no funcionaba. Se corrigieron cinco defectos "
             "en total. Los cuatro primeros: el destino no establecía sesión, el origen salía del "
             "dominio efímero del despliegue, la ruta de cierre de sesión respondía a GET (y el "
             "prefetch de un enlace cerraba la sesión sola) y el parámetro de destino podía "
             "quedar vacío."),
            ("El quinto, encontrado el 30 de julio", "Quien recibía la invitación y NO tenía cuenta "
             "terminaba en la pantalla de inicio de sesión. La causa: un enlace de correo lo "
             "inicia el servidor, así que Supabase devuelve la sesión en el FRAGMENTO de la URL, y "
             "el fragmento nunca viaja al servidor. Corregido con una página cliente (commit "
             "ac8fb8d)."),
            ("Por qué no se detectó antes", "La invitación de prueba se aceptó con un correo que "
             "ya tenía cuenta: llegaba con sesión y el fallo no aparecía. Es una trampa de "
             "verificación que conviene conocer."),
        ],
        "verificar": "git show 32ec1bf · git show ac8fb8d · scripts/verificar_enlace_invitacion.py",
    },
    {
        "n": 10, "titulo": "Historial de conversaciones",
        "desde": "13 de julio de 2026",
        "historia": [
            ("Implementación original", "La tabla athos_messages existe desde el PRIMER COMMIT "
             "(cca7b87, 13 de julio). Los mensajes se guardaron desde el principio."),
            ("El reclamo y la realidad", "Se reportó que el historial «no persistía». Es "
             "incorrecto: sí persistía. Lo que faltaba era la PANTALLA que lo mostrara. Los datos "
             "estaban ahí todo el tiempo — hay 61 mensajes guardados desde el 16 de julio."),
            ("Estado hoy", "La pantalla existe y precarga el hilo. El 31 de julio se añadió además "
             "la persistencia de las conversaciones del asistente agéntico, que era la única que "
             "faltaba (commit 557232e)."),
        ],
        "verificar": "git show cca7b87 · consulta a athos_messages en producción",
    },
]

for P in PUNTOS:
    A(("h2", f"Punto {P['n']} — {P['titulo']}"))
    A(("p", f"Implementado desde: {P['desde']}"))
    for sub, txt in P["historia"]:
        A(("h3", sub))
        A(("p", txt))
    for clave in ("tabla", "tabla2"):
        if P.get(clave):
            titulo, filas = P[clave]
            A(("h3", titulo))
            A(("tabla", filas))
    if P.get("limite"):
        A(("h3", "Límite de la evidencia"))
        A(("quote", P["limite"]))
    A(("h3", "Cómo verificarlo"))
    A(("code", P["verificar"]))
    A(("hueco", "Espacio para adjuntar captura o enlace al video de este punto"))

pathlib.Path("C:/Users/wachi/AppData/Local/Temp/claude/C--DevsJesus-tuvetia/"
             "2dda0452-410c-4057-b044-36f8be958b03/scratchpad/contenido.py").write_text(
    "CONTENIDO = " + repr(C), encoding="utf-8")
print(f"contenido base: {len(C)} bloques")
subprocess.run(["echo"], shell=True)
