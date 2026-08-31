import { requerirAdminDePlataforma } from "@/lib/platform-admin"
import { createAdminClient } from "@/lib/supabase/admin"
import { veredictoDelCodigo, type CodigoDeAcceso, type ModoDeLaPuerta } from "@/lib/puerta"
import { AccionesDeCodigo } from "@/components/admin/acciones-de-codigo"
import { CrearCodigo } from "@/components/admin/crear-codigo"
import { InterruptorDeLaPuerta } from "@/components/admin/interruptor-de-la-puerta"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const metadata = { title: "Admin · Acceso" }

type FilaDeCodigo = CodigoDeAcceso & { nota: string | null; creado_en: string }
type FilaDePase = { email: string; codigo: string; otorgado_en: string; usado_en: string | null }

const fecha = (iso: string | null) => (iso ? iso.slice(0, 10) : "—")

/** Cuántos pases recientes se listan. Es una foto para revisar, no un padrón. */
const PASES_A_LA_VISTA = 25

export default async function AdminAccesoPage() {
  // ANTES DE CONSULTAR NADA: el layout no alcanza, la página se renderiza en paralelo y sus
  // datos se serializan en la respuesta aunque el layout devuelva 404. Ver `lib/platform-admin`.
  await requerirAdminDePlataforma()

  const supabase = createAdminClient()

  const [puerta, codigos, pases] = await Promise.all([
    supabase.from("platform_gate").select("modo").maybeSingle(),
    supabase
      .from("access_codes")
      .select("codigo, dias, max_usos, usos, expira_en, activo, nota, creado_en")
      .order("creado_en", { ascending: false }),
    supabase
      .from("access_grants")
      .select("email, codigo, otorgado_en, usado_en")
      .order("otorgado_en", { ascending: false })
      .limit(PASES_A_LA_VISTA),
  ])

  const modo: ModoDeLaPuerta =
    (puerta.data as { modo?: string } | null)?.modo === "cerrado" ? "cerrado" : "abierto"
  const filas = ((codigos.data as FilaDeCodigo[] | null) ?? [])
  const otorgados = ((pases.data as FilaDePase[] | null) ?? [])

  const ahora = new Date()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Acceso a la plataforma</h1>
        <p className="text-sm text-muted-foreground">
          Quién puede crear una cuenta nueva en Tuvetia, y con cuántos días de prueba.
        </p>
      </div>

      <InterruptorDeLaPuerta modo={modo} />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Códigos ({filas.length})</h2>
            <p className="text-sm text-muted-foreground">
              El botón de copiar da el <b>enlace listo para compartir</b>: quien lo abre ni ve el paso
              del código.
            </p>
          </div>
          <CrearCodigo />
        </div>

        {filas.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Todavía no hay ningún código. Con la puerta cerrada y sin códigos, nadie puede
            registrarse.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  <TableHead className="text-right">Usos</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Para qué</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((c) => {
                  // El MISMO veredicto que aplica el registro, no una réplica: un código apagado por
                  // fecha o por cupo tiene que verse apagado acá, o el panel miente sobre lo que el
                  // vet va a encontrar del otro lado del enlace.
                  const v = veredictoDelCodigo(c, ahora)
                  return (
                    <TableRow key={c.codigo}>
                      <TableCell className="font-mono font-medium">{c.codigo}</TableCell>
                      <TableCell>
                        {v.sirve ? (
                          <Badge variant="outline" className="border-ok/40 text-ok">
                            activo
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            {v.motivo === "desactivado" ? "apagado" : v.motivo}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{c.dias}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.usos} / {c.max_usos}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{fecha(c.expira_en)}</TableCell>
                      <TableCell className="max-w-[18rem] truncate text-muted-foreground">
                        {c.nota ?? "—"}
                      </TableCell>
                      <TableCell>
                        <AccionesDeCodigo codigo={c.codigo} activo={c.activo} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {otorgados.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">Últimos pases</h2>
            {/* LOS «PENDIENTES» SON LA MÉTRICA QUE IMPORTA: un pase que se otorgó y nunca se usó es
                alguien que abrió el enlace, escribió su correo y no volvió. Sin esta columna, «5 de
                25 usos» parece cinco clínicas nuevas y pueden ser cero. */}
            <p className="text-sm text-muted-foreground">
              <b>Pendiente</b> = puso su correo pero todavía no terminó de entrar.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>Correo</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Lo pidió</TableHead>
                  <TableHead>Entró</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {otorgados.map((p) => (
                  <TableRow key={p.email}>
                    <TableCell>{p.email}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{p.codigo}</TableCell>
                    <TableCell className="text-muted-foreground">{fecha(p.otorgado_en)}</TableCell>
                    <TableCell>
                      {p.usado_en ? (
                        fecha(p.usado_en)
                      ) : (
                        <Badge variant="outline" className="border-warn/40 text-warn">
                          pendiente
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
