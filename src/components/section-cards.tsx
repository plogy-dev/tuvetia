"use client"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { TrendingUpIcon, TrendingDownIcon } from "lucide-react"

export function SectionCards() {
  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Consultas este mes</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            128
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <TrendingUpIcon
              />
              +12.5%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Más actividad que el mes pasado{" "}
            <TrendingUpIcon className="size-4" />
          </div>
          <div className="text-muted-foreground">
            Consultas registradas en la clínica
          </div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Pacientes nuevos</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            34
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <TrendingUpIcon
              />
              +8.2%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Crecimiento constante{" "}
            <TrendingUpIcon className="size-4" />
          </div>
          <div className="text-muted-foreground">
            Nuevos registros de mascotas
          </div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Citas programadas</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            56
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <TrendingDownIcon
              />
              -4%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Menos citas que la semana pasada{" "}
            <TrendingDownIcon className="size-4" />
          </div>
          <div className="text-muted-foreground">Agenda con espacio disponible</div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Mensajes de WhatsApp</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            312
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <TrendingUpIcon
              />
              +18%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Mayor uso del canal{" "}
            <TrendingUpIcon className="size-4" />
          </div>
          <div className="text-muted-foreground">
            Conversaciones con dueños de mascotas
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
