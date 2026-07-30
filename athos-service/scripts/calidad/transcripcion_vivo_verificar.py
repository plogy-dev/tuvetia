"""Verificación END-TO-END de la transcripción EN VIVO contra Deepgram real.

Manda un audio por el socket de Deepgram Live **al ritmo del reloj** (como lo haría el navegador
con `MediaRecorder`), lo acumula con `DeepgramLiveSession` —el mismo código que corre en
producción— y compara contra la verdad-de-terreno. Reporta WER (word error rate).

No es una prueba unitaria: gasta cuota de Deepgram y necesita red. Se corre a mano cuando hay que
declarar un número con evidencia.

    python scripts/calidad/transcripcion_vivo_verificar.py audio.wav referencia.txt

La `DEEPGRAM_API_KEY` sale del entorno.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.streaming_transcription import (  # noqa: E402
    DEEPGRAM_LIVE_URL,
    LIVE_PARAMS,
    DeepgramLiveSession,
    close_message,
)

TROZO_SEGUNDOS = 1.0          # igual que `rec.start(1000)` en el grabador del front


def normalizar(texto: str) -> list[str]:
    """Palabras comparables: sin acentos, sin puntuación, en minúscula."""
    plano = unicodedata.normalize("NFKD", texto.lower())
    plano = "".join(c for c in plano if not unicodedata.combining(c))
    return re.findall(r"[a-z0-9]+", plano)


# Deepgram con `smart_format` escribe los números como cifras: "treinta y nueve punto ocho" sale
# "39.8". Para una nota clínica eso es MEJOR (una temperatura o una dosis se leen en cifras), pero
# un WER ingenuo lo cuenta como error. Por eso se reporta también la tasa ignorando ese formato:
# separa "el modelo oyó mal" de "el modelo escribió el número como se debe".
_CIFRAS = {
    "cero": "0", "uno": "1", "dos": "2", "tres": "3", "cuatro": "4", "cinco": "5",
    "seis": "6", "siete": "7", "ocho": "8", "nueve": "9", "diez": "10",
}


def sin_formato_numerico(palabras: list[str]) -> list[str]:
    """Pasa los números escritos con letra a cifra y descompone los decimales."""
    salida: list[str] = []
    for w in palabras:
        if w in _CIFRAS:
            salida.append(_CIFRAS[w])
        elif w in ("punto", "y") and salida and salida[-1].isdigit():
            continue                       # "treinta y nueve punto ocho" -> "30 9 8"
        elif re.fullmatch(r"\d+\.\d+", w):
            salida.extend(w.split("."))    # "39.8" -> "39" "8"
        else:
            salida.append(w)
    return salida


def wer(referencia: list[str], hipotesis: list[str]) -> tuple[float, int, int, int]:
    """Distancia de edición por palabras. Devuelve (wer, sustituciones, inserciones, borrados)."""
    n, m = len(referencia), len(hipotesis)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            coste = 0 if referencia[i - 1] == hipotesis[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + coste)
    # Retroceso para separar los tipos de error.
    i, j, sub, ins, bor = n, m, 0, 0, 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (
            0 if referencia[i - 1] == hipotesis[j - 1] else 1
        ):
            if referencia[i - 1] != hipotesis[j - 1]:
                sub += 1
            i, j = i - 1, j - 1
        elif j > 0 and d[i][j] == d[i][j - 1] + 1:
            ins += 1
            j -= 1
        else:
            bor += 1
            i -= 1
    return (d[n][m] / max(n, 1)), sub, ins, bor


def trocear(audio: bytes, bytes_por_seg: int) -> list[bytes]:
    paso = max(int(bytes_por_seg * TROZO_SEGUNDOS), 1024)
    return [audio[i:i + paso] for i in range(0, len(audio), paso)]


def bytes_por_segundo(wav: bytes) -> int:
    """Lee el byte-rate de la cabecera RIFF; si no es WAV, asume 48 kB/s."""
    try:
        if wav[:4] == b"RIFF" and wav[8:12] == b"WAVE":
            i = wav.find(b"fmt ")
            return int.from_bytes(wav[i + 16:i + 20], "little")
    except Exception:  # noqa: BLE001
        pass
    return 48_000


async def correr(ruta_audio: Path, ruta_ref: Path) -> int:
    from websockets.asyncio.client import connect

    api_key = os.environ.get("DEEPGRAM_API_KEY", "")
    if not api_key:
        print("falta DEEPGRAM_API_KEY en el entorno")
        return 2

    audio = ruta_audio.read_bytes()
    referencia = normalizar(ruta_ref.read_text(encoding="utf-8"))
    trozos = trocear(audio, bytes_por_segundo(audio))
    print(f"audio     : {ruta_audio.name}  {len(audio):,} bytes  -> {len(trozos)} trozos de "
          f"{TROZO_SEGUNDOS}s")
    print(f"referencia: {len(referencia)} palabras\n")

    from urllib.parse import urlencode
    params = dict(LIVE_PARAMS)
    params["model"] = os.environ.get("STT_MODEL", "nova-2")
    url = f"{DEEPGRAM_LIVE_URL}?{urlencode(params)}"

    sesion = DeepgramLiveSession()
    interinos = 0
    primer_texto: float | None = None
    arranque = time.monotonic()

    async with connect(url, additional_headers={"Authorization": f"Token {api_key}"}) as dg:

        async def recibir():
            nonlocal interinos, primer_texto
            async for crudo in dg:
                msg = json.loads(crudo)
                upd = sesion.add_message(msg)
                if upd is None:
                    continue
                if primer_texto is None:
                    primer_texto = time.monotonic() - arranque
                if not upd.es_final:
                    interinos += 1
                    print(f"  ~ {upd.texto_provisional[:70]}", end="\r")
                else:
                    print(f"  + {upd.texto_estable.splitlines()[-1][:70]:<72}")

        tarea = asyncio.create_task(recibir())

        # Al ritmo del reloj: así se ejerce de verdad el camino en vivo (interinos incluidos).
        for trozo in trozos:
            await dg.send(trozo)
            await asyncio.sleep(TROZO_SEGUNDOS)

        # Deepgram puede haber cerrado ya por su cuenta al terminar el audio: mandar CloseStream
        # sobre un socket cerrado lanza, y no es un error (el resultado ya llegó completo).
        try:
            await dg.send(json.dumps(close_message()))
        except Exception:  # noqa: BLE001
            pass
        try:
            await asyncio.wait_for(tarea, timeout=20)
        except (TimeoutError, asyncio.TimeoutError, Exception):  # noqa: BLE001
            tarea.cancel()

    hipotesis = normalizar(" ".join(
        s["text"] for s in sesion.segments
    ))
    tasa, sub, ins, bor = wer(referencia, hipotesis)
    tasa_fmt, *_ = wer(sin_formato_numerico(referencia), sin_formato_numerico(hipotesis))

    print("\n" + "=" * 74)
    print("TRANSCRIPCIÓN OBTENIDA")
    print("=" * 74)
    print(sesion.texto_estable)
    print("\n" + "=" * 74)
    print("RESULTADO")
    print("=" * 74)
    print(f"  palabras referencia   : {len(referencia)}")
    print(f"  palabras transcritas  : {len(hipotesis)}")
    print(f"  sustituciones         : {sub}")
    print(f"  inserciones           : {ins}")
    print(f"  borrados              : {bor}")
    print(f"  WER                   : {tasa:.1%}")
    print(f"  EXACTITUD             : {1 - tasa:.1%}")
    print(f"  WER sin formato num.  : {tasa_fmt:.1%}   (ignora 'tres' vs '3')")
    print(f"  EXACTITUD sin formato : {1 - tasa_fmt:.1%}")
    print(f"  hablantes detectados  : {len({s['speaker'] for s in sesion.segments})}")
    print(f"  roles inferidos       : {sesion.segments[0]['role_inferred'] if sesion.segments else '—'}")
    print(f"  mensajes interinos    : {interinos}  (0 = no hubo texto en vivo)")
    print(f"  primer texto a los    : {primer_texto:.1f}s" if primer_texto else "  sin texto")
    print(f"  diagnóstico sesión    : {sesion.diagnostico()}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(asyncio.run(correr(Path(sys.argv[1]), Path(sys.argv[2]))))
