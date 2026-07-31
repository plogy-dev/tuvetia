# Dossier de evidencias — Milestone 2

| Archivo | Para qué |
|---|---|
| `DOSSIER-EVIDENCIAS-MILESTONE2.pdf` | El entregable formal, 19 páginas. |
| `DOSSIER-EVIDENCIAS-MILESTONE2.docx` | **La versión editable.** Tiene recuadros vacíos donde pegar capturas y enlaces a los videos. |
| `render_dossier.py` + `contenido.py` | Lo regeneran. Si cambian los datos, se corre el script y salen los dos archivos otra vez. |

## Cómo actualizarlo

```bash
pip install reportlab python-docx
python docs/entrega/render_dossier.py
```

El contenido está en `contenido.py` (los 10 puntos y la línea de tiempo) y en `render_dossier.py`
(el método, la guía de grabación y el anexo). Se edita ahí y se vuelve a renderizar: así el PDF y el
DOCX nunca se desincronizan.

## Qué contiene

1. Cómo leer el documento — las tres clases de evidencia y su fuerza relativa
2. Resumen ejecutivo
3. Línea de tiempo completa, del 13 al 31 de julio, con commit y fecha
4. Evidencia punto por punto de los 10 puntos priorizados
5. El método: por qué el proyecto avanzó en ese orden
6. Guía para grabar los demos probatorios
7. Anexo con los comandos de verificación
