# -*- coding: utf-8 -*-
"""Renderiza el dossier a DOCX (editable) y PDF."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from contenido import CONTENIDO  # noqa: E402

SALIDA = pathlib.Path("C:/DevsJesus/tuvetia/skeleton/docs/entrega")
SALIDA.mkdir(parents=True, exist_ok=True)

C = list(CONTENIDO)
A = C.append

# ---------------------------------------------------------------------------------------------
# El método: por qué el proyecto avanzó en ese orden
# ---------------------------------------------------------------------------------------------
A(("h1", "El método — por qué se avanzó en ese orden"))
A(("p", "Las fechas de la sección anterior no son casualidad. Responden a cuatro decisiones "
        "técnicas que conviene explicar, porque son las que justifican por qué una función podía "
        "estar en producción el 16 de julio y aun así necesitar dos semanas más de trabajo."))

A(("h2", "1. Primero lo determinístico, después la inteligencia artificial"))
A(("p", "La arquitectura parte de una regla: gastar la menor inteligencia artificial posible. El "
        "buscador que recupera literatura es determinístico y no consume tokens; la IA sólo "
        "interviene en dos puntos — entender la consulta y redactar la respuesta citada."))
A(("p", "Por eso la primera versión de la abstención (13 de julio) era un umbral numérico sobre el "
        "score del buscador: era lo barato, lo reproducible y lo que no dependía de ningún modelo. "
        "Sólo cuando se midió y se comprobó que no discriminaba se pagó el costo de un juez que "
        "LEE los pasajes."))
A(("quote", "Ese orden es deliberado, no un descuido. Introducir un modelo de lenguaje donde una "
            "regla determinística alcanza añade costo, latencia y una fuente de error que no se "
            "puede auditar. La secuencia correcta es intentar lo barato, medirlo, y escalar sólo "
            "si los datos lo exigen."))

A(("h2", "2. Las reglas duras viven en el código, no en el prompt"))
A(("p", "Está medido en este proyecto: pedirle al modelo por prompt que no dé una dosis sin peso "
        "del paciente falla en 2 de 23 casos, y con un prompt más resolutivo empeora a 9 de 23 "
        "—porque pedirle que decida lo empuja a decidir—. Por eso las garantías críticas están "
        "impuestas por código:"))
A(("b", "El gate de alergia severa se calcula desde la tabla de alergias, no lo decide el modelo."))
A(("b", "El tapado de dosis cuando faltan datos lo hace un guard, no el prompt."))
A(("b", "La verificación de citas descarta referencias que no correspondan a un documento "
        "recuperado, sin preguntarle al modelo."))
A(("b", "El aviso de evidencia limitada lo emite el código cuando el juez dictamina esa banda."))
A(("p", "Esto explica por qué varias correcciones de las últimas semanas fueron mover una regla "
        "desde el prompt hacia el código: no es refactorización cosmética, es la diferencia entre "
        "una garantía y una sugerencia."))

A(("h2", "3. Medir antes de construir — y arreglar el instrumento cuando está mal"))
A(("p", "Buena parte del trabajo del 28 al 31 de julio no fue escribir funciones nuevas sino "
        "construir con qué medir las existentes. Ese esfuerzo devolvió tres hallazgos que ninguna "
        "revisión de código habría encontrado:"))
A(("b", "El umbral de abstención daba «hay evidencia» en 187 de 187 casos: la función existía pero "
        "su criterio estaba saturado."))
A(("b", "18 de 24 respuestas citaban al menos un pasaje que no respaldaba la afirmación: la "
        "procedencia era correcta, la pertinencia no."))
A(("b", "24 de los 42 casos negativos del banco de pruebas NO eran negativos: el instrumento de "
        "medición estaba roto, y toda cifra anterior medía otra cosa."))
A(("quote", "El tercero es el más incómodo y el más importante. Descubrir que el propio "
            "instrumento estaba mal obliga a descartar mediciones ya reportadas. Se hizo, y por "
            "eso las cifras de este documento son las que se sostienen."))

A(("h2", "4. Lo que se puede contar, se cuenta"))
A(("p", "Se probó usar un modelo de lenguaje como juez de calidad y se midió su fiabilidad: tiene "
        "un ruido de ±7 sobre 40 puntos entre corridas idénticas, y un sesgo de posición del 78% "
        "hacia la primera opción mostrada. Es decir, el juez podía «demostrar» una mejora que no "
        "existía."))
A(("p", "Desde entonces la regla es: si una propiedad se puede contar de forma determinística, se "
        "cuenta. La abstención se mide contra un hecho comprobable —si algún pasaje recuperado "
        "está indexado con el descriptor de la consulta en el árbol MeSH—, la transcripción contra "
        "una verdad de terreno conocida, y la proporcionalidad de las respuestas contando señales "
        "clínicas y caracteres. Ninguna cifra de este documento sale de la opinión de un modelo."))

# ---------------------------------------------------------------------------------------------
# Guía para grabar los demos probatorios
# ---------------------------------------------------------------------------------------------
A(("h1", "Guía para grabar los demos probatorios"))
A(("p", "Un video vale como evidencia sólo si es imposible discutir lo que muestra. Estas reglas "
        "existen para que nadie pueda decir «eso está editado» o «así no se mide»."))

A(("h2", "Reglas que valen para todos los videos"))
A(("b", "Una sola toma, sin cortes. Si algo sale mal, se repite el video entero. Un corte invalida "
        "la evidencia."))
A(("b", "Reloj visible en pantalla desde el primer segundo. Abrí time.is en una ventana lateral: "
        "muestra la hora oficial con segundos y sirve de sello temporal verificable."))
A(("b", "Mostrá la URL. Que se vea que es tuvetia.vercel.app y no un entorno local."))
A(("b", "Narrá lo que vas a hacer ANTES de hacerlo. «Voy a preguntar X y espero que pase Y.» Una "
        "predicción cumplida es más creíble que una explicación posterior."))
A(("b", "No edites nada. Ni recortes, ni acelerados, ni música. El archivo crudo."))
A(("b", "Nombrá el archivo con punto y fecha: `P05-latencia-2026-08-01.mp4`."))

A(("h2", "Con qué grabar"))
A(("p", "En Windows, la Xbox Game Bar viene incluida: tecla Windows + G, y grabás con Windows + "
        "Alt + R. Si necesitás mejor calidad o mostrar el cronómetro con precisión, OBS Studio es "
        "gratuito y permite superponer un cronómetro sobre la pantalla."))
A(("p", "Para el punto de latencia conviene además grabar con el panel de red del navegador "
        "abierto (F12, pestaña Red): ahí queda el tiempo real de cada petición, que es un dato "
        "que el propio navegador certifica."))

A(("h2", "Video por video: qué mostrar exactamente"))

VIDEOS = [
    ("P05 · Latencia", "2 a 3 minutos", [
        "Mostrá time.is y la URL de producción.",
        "Abrí F12 en la pestaña Red y limpiá el registro.",
        "Escribí una consulta clínica real y decí en voz alta: «voy a enviar ahora».",
        "Enviá y NO toques nada. Dejá que se vea aparecer el primer texto.",
        "Al aparecer el primer token, decilo en voz alta: «primer token».",
        "Cuando termine, mostrá en el panel de red el tiempo total de la petición.",
        "Cerrá mostrando el reloj otra vez.",
    ], "Lo que prueba: que el primer token llega en torno a 12,8 s y la respuesta completa en "
       "27,6 s. Los cinco minutos reportados no se reproducen."),

    ("P03 · Abstención", "3 a 4 minutos", [
        "Primero una consulta que SÍ tenga literatura (por ejemplo, dermatitis atópica canina). "
        "Mostrá que responde citando fuentes.",
        "Después una consulta sin cobertura real en el corpus. Anunciá antes: «esto no debería "
        "tener evidencia suficiente».",
        "Mostrá el aviso de evidencia limitada o la abstención en pantalla.",
        "Si aparece la advertencia de evidencia limitada, leela en voz alta.",
    ], "Lo que prueba: que el sistema distingue y lo declara. Es el contraste entre los dos casos "
       "lo que convence, no el segundo caso solo."),

    ("P04 · Citas correctas", "2 minutos", [
        "Hacé una consulta que devuelva fuentes.",
        "Hacé clic en una fuente y mostrá que abre el artículo real (PubMed o el enlace del "
        "documento).",
        "Volvé y abrí otra. Mostrá que el título y el año coinciden con lo que abre.",
    ], "Lo que prueba: que las fuentes existen y son las recuperadas. El argumento fuerte es "
       "estructural —el modelo sólo emite un número, el resto lo reconstruye el código— pero verlo "
       "abrir el artículo real lo hace tangible."),

    ("P08 · Transcripción en vivo", "3 a 5 minutos", [
        "IMPORTANTE: grabá con DOS personas hablando, no una sola. Es lo único que demuestra la "
        "separación de hablantes.",
        "Mostrá la pantalla de consentimiento antes de grabar (Ley 1581).",
        "Iniciá la grabación y hablá alternando: uno hace de dueño («Doctor, mi perro no come») y "
        "otro de veterinario («vamos a palpar el abdomen»).",
        "Mostrá el texto apareciendo EN VIVO mientras hablan.",
        "Al detener, mostrá que los roles quedaron bien asignados: Titular y Veterinario.",
        "Mostrá la fecha de la consulta y comparala con el reloj en pantalla.",
    ], "Lo que prueba: los tres defectos cerrados de una sola vez — en vivo, roles correctos y "
       "fecha correcta. Este es el video más valioso de todos, y el que cubre el hueco que la "
       "medición sintética no pudo cubrir."),

    ("P01 · Cascada de tres modelos", "3 minutos", [
        "Este NO se puede demostrar desde la interfaz: el fallback sólo se activa si el proveedor "
        "principal falla.",
        "Grabá en su lugar la ejecución de la prueba de caída forzada en la terminal, mostrando "
        "que responde DeepSeek, luego Gemini y luego Claude.",
        "Mostrá también las variables de entorno de Railway con las tres claves configuradas "
        "(sin revelar los valores: basta con que se vean los nombres).",
    ], "Lo que prueba: que la cascada existe y funciona. Sé explícito en el video sobre que es una "
       "prueba de caída forzada y no tráfico real: es lo que hace creíble todo lo demás."),

    ("P07 · Google Calendar", "2 a 3 minutos", [
        "Mostrá el calendario de la plataforma con las citas.",
        "Abrí Google Calendar en otra pestaña y mostrá las mismas citas.",
        "Creá una cita en la plataforma y mostrá cómo aparece en Google.",
    ], "Lo que prueba: la sincronización operando. Hay 11.550 citas sincronizadas, así que el "
       "volumen habla solo."),

    ("P09 · Invitaciones", "2 minutos", [
        "Usá un correo que NO tenga cuenta en la plataforma — es el caso que estaba roto.",
        "Enviá la invitación desde ajustes de equipo.",
        "Abrí el correo, hacé clic en el enlace.",
        "Mostrá que aterriza en la invitación y que al aceptar entra a la clínica.",
    ], "Lo que prueba: el quinto defecto corregido. Con un correo que ya tenga cuenta NO se "
       "demuestra nada: ése es el camino que siempre funcionó."),

    ("P10 · Historial y memoria", "2 minutos", [
        "Escribí una pregunta al asistente y esperá la respuesta.",
        "RECARGÁ la página por completo (F5).",
        "Mostrá que la conversación anterior sigue ahí.",
        "Preguntá: «¿cuál fue la última pregunta que te hice?» y mostrá que responde bien.",
    ], "Lo que prueba: que el historial persiste entre sesiones. La recarga es la parte "
       "importante: sin ella no se demuestra persistencia."),
]

for titulo, duracion, pasos, prueba in VIDEOS:
    A(("h3", f"{titulo}  ({duracion})"))
    for p in pasos:
        A(("b", p))
    A(("quote", prueba))
    A(("hueco", "Espacio para pegar el video o su captura"))

A(("h2", "Qué NO hacer"))
A(("b", "No grabes en un entorno local. Si la URL no es la de producción, no prueba nada."))
A(("b", "No uses datos de pacientes reales de una clínica cliente sin autorización. Creá pacientes "
        "de demostración."))
A(("b", "No repitas la toma hasta que «salga bien» y muestres sólo esa. Si el sistema falla en un "
        "intento, eso también es información — y si se descubre después, cuesta mucho más caro."))
A(("b", "No afirmes en el video nada que el video no muestre. Si querés dar contexto, decilo como "
        "contexto, no como demostración."))

# --- anexo de comandos -----------------------------------------------------------------------
A(("h1", "Anexo — comandos de verificación"))
A(("p", "Cualquiera con acceso al repositorio puede reproducir esta evidencia."))

A(("h3", "Verificar un commit concreto"))
A(("code", "git show cca7b87        # primer commit: citas + abstención + historial\n"
           "git log --format='%h %ad %s' --date=short --reverse | head -20"))

A(("h3", "Correr la suite completa"))
A(("code", "python scripts/auditoria.py        # backend + front + tipos + lint + build"))

A(("h3", "Medir la abstención contra producción"))
A(("code", "cd athos-service\n"
           "python scripts/calidad/abstencion_verdad.py --n 0"))

A(("h3", "Medir la transcripción en vivo contra Deepgram"))
A(("code", "python scripts/calidad/transcripcion_vivo_verificar.py audio.wav referencia.txt"))

A(("h3", "Correr el banco de calidad del agente"))
A(("code", "RUN_BANCO=1 ANTHROPIC_API_KEY=... \\\n"
           "  npx vitest run --config vitest.e2e.config.mts e2e/banco-agente.e2e.ts"))

A(("h3", "Comprobar la configuración de producción"))
A(("code", 'curl -H "Authorization: Bearer $CRON_SECRET" \\\n'
           "  https://tuvetia.vercel.app/api/health"))

A(("h2", "Documentos de referencia en el repositorio"))
for d in [
    "docs/SOPORTES-MILESTONE2-2026-07-30.md — respuesta punto por punto a la guía de soportes",
    "docs/VERIFICACION-10-PUNTOS-2026-07-30.md — estado de los 10 puntos priorizados",
    "docs/ABSTENCION-MEDICION-2026-07-30.md — cómo se mide la abstención y por qué",
    "docs/BANCO-AGENTE-RESULTADO.md — banco de calidad del agente con las respuestas íntegras",
    "docs/COMPARATIVA-MODELOS-2026-07-30.md — prueba de caída forzada entre los tres proveedores",
    "docs/AGENT-SMOKE-TESTING.md — resultados del smoke testing",
    "docs/CONFIGURACION-PRODUCCION.md — qué variable vive dónde",
    "INVENTARIO-COMPONENTES.md — inventario formal de componentes",
]:
    A(("b", d))

# ---------------------------------------------------------------------------------------------
# DOCX
# ---------------------------------------------------------------------------------------------
from docx import Document  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402
from docx.shared import Pt, RGBColor  # noqa: E402

doc = Document()
for st, sz in (("Normal", 10.5),):
    doc.styles[st].font.size = Pt(sz)
    doc.styles[st].font.name = "Calibri"

for tipo, val in C:
    if tipo == "h1":
        doc.add_page_break() if len(doc.paragraphs) > 3 else None
        doc.add_heading(val, level=0)
    elif tipo == "h2":
        doc.add_heading(val, level=1)
    elif tipo == "h3":
        doc.add_heading(val, level=2)
    elif tipo == "p":
        doc.add_paragraph(val)
    elif tipo == "b":
        doc.add_paragraph(val, style="List Bullet")
    elif tipo == "quote":
        p = doc.add_paragraph(val)
        p.paragraph_format.left_indent = Pt(24)
        for r in p.runs:
            r.italic = True
            r.font.color.rgb = RGBColor(0x44, 0x44, 0x44)
    elif tipo == "code":
        p = doc.add_paragraph()
        r = p.add_run(val)
        r.font.name = "Consolas"
        r.font.size = Pt(9)
        p.paragraph_format.left_indent = Pt(18)
    elif tipo == "tabla":
        t = doc.add_table(rows=0, cols=len(val[0]))
        t.style = "Light Grid Accent 1"
        for i, fila in enumerate(val):
            celdas = t.add_row().cells
            for j, txt in enumerate(fila):
                celdas[j].text = str(txt)
                if i == 0:
                    for pr in celdas[j].paragraphs:
                        for run in pr.runs:
                            run.bold = True
        doc.add_paragraph()
    elif tipo == "hueco":
        p = doc.add_paragraph(f"[ {val} ]")
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for r in p.runs:
            r.italic = True
            r.font.color.rgb = RGBColor(0x99, 0x99, 0x99)
        doc.add_paragraph()

ruta_docx = SALIDA / "DOSSIER-EVIDENCIAS-MILESTONE2.docx"
doc.save(ruta_docx)
print(f"DOCX -> {ruta_docx}")

# ---------------------------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------------------------
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.enums import TA_CENTER  # noqa: E402
from reportlab.lib.pagesizes import LETTER  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import cm  # noqa: E402
from reportlab.platypus import (PageBreak, Paragraph, SimpleDocTemplate,  # noqa: E402
                                Spacer, Table, TableStyle)

ss = getSampleStyleSheet()
E = {
    "h1": ParagraphStyle("H1", parent=ss["Title"], fontSize=19, spaceAfter=14, spaceBefore=6,
                         textColor=colors.HexColor("#12313f")),
    "h2": ParagraphStyle("H2", parent=ss["Heading1"], fontSize=14, spaceBefore=14, spaceAfter=7,
                         textColor=colors.HexColor("#1a5670")),
    "h3": ParagraphStyle("H3", parent=ss["Heading2"], fontSize=11.5, spaceBefore=10, spaceAfter=4,
                         textColor=colors.HexColor("#2c3e50")),
    "p": ParagraphStyle("P", parent=ss["BodyText"], fontSize=9.8, leading=14.5, spaceAfter=7,
                        alignment=4),
    "b": ParagraphStyle("B", parent=ss["BodyText"], fontSize=9.8, leading=14, spaceAfter=4,
                        leftIndent=14, bulletIndent=4),
    "quote": ParagraphStyle("Q", parent=ss["BodyText"], fontSize=9.5, leading=14, spaceAfter=8,
                            leftIndent=18, rightIndent=10, textColor=colors.HexColor("#444444"),
                            borderColor=colors.HexColor("#bcd4de"), borderWidth=0,
                            borderPadding=4, fontName="Helvetica-Oblique"),
    "code": ParagraphStyle("C", parent=ss["BodyText"], fontName="Courier", fontSize=8.2,
                           leading=11.5, leftIndent=12, spaceAfter=3,
                           textColor=colors.HexColor("#20303a")),
    "hueco": ParagraphStyle("Hu", parent=ss["BodyText"], fontSize=9, alignment=TA_CENTER,
                            textColor=colors.HexColor("#9a9a9a"), spaceBefore=8, spaceAfter=12,
                            fontName="Helvetica-Oblique"),
}


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


flow = []
primero = True
for tipo, val in C:
    if tipo == "h1":
        if not primero:
            flow.append(PageBreak())
        primero = False
        flow.append(Paragraph(esc(val), E["h1"]))
    elif tipo in ("h2", "h3", "p"):
        flow.append(Paragraph(esc(val), E[tipo]))
    elif tipo == "b":
        flow.append(Paragraph(esc(val), E["b"], bulletText="•"))
    elif tipo == "quote":
        flow.append(Paragraph(esc(val), E["quote"]))
    elif tipo == "code":
        for ln in str(val).split("\n"):
            flow.append(Paragraph(esc(ln).replace(" ", "&nbsp;"), E["code"]))
        flow.append(Spacer(1, 5))
    elif tipo == "tabla":
        datos = [[Paragraph(f"<b>{esc(c)}</b>" if i == 0 else esc(c), E["p"]) for c in fila]
                 for i, fila in enumerate(val)]
        t = Table(datos, hAlign="LEFT", colWidths=[16.5 * cm / len(val[0])] * len(val[0]))
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8f1f5")),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#b9ccd6")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        flow.append(t)
        flow.append(Spacer(1, 9))
    elif tipo == "hueco":
        t = Table([[Paragraph(f"[ {esc(val)} ]", E["hueco"])]], colWidths=[16.5 * cm],
                  rowHeights=[2.6 * cm])
        t.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#cccccc")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        flow.append(t)
        flow.append(Spacer(1, 10))


def pie(canvas, doc_):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#8a8a8a"))
    canvas.drawString(2 * cm, 1.3 * cm, "Dossier de evidencias — Milestone 2 · COT-2026-TUV-001 · 31-jul-2026")
    canvas.drawRightString(19.4 * cm, 1.3 * cm, f"pág. {doc_.page}")
    canvas.restoreState()


ruta_pdf = SALIDA / "DOSSIER-EVIDENCIAS-MILESTONE2.pdf"
SimpleDocTemplate(str(ruta_pdf), pagesize=LETTER, topMargin=2 * cm, bottomMargin=2 * cm,
                  leftMargin=2.2 * cm, rightMargin=2.2 * cm,
                  title="Dossier de evidencias — Milestone 2",
                  author="Equipo Plogy").build(flow, onFirstPage=pie, onLaterPages=pie)
print(f"PDF  -> {ruta_pdf}")
print(f"bloques renderizados: {len(C)}")
