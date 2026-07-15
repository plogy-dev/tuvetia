"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

export const description = "Gráfica interactiva de actividad de consultas"

const chartData = [
  { date: "2024-04-01", presencial: 22, whatsapp: 15 },
  { date: "2024-04-02", presencial: 9, whatsapp: 18 },
  { date: "2024-04-03", presencial: 16, whatsapp: 12 },
  { date: "2024-04-04", presencial: 24, whatsapp: 26 },
  { date: "2024-04-05", presencial: 37, whatsapp: 29 },
  { date: "2024-04-06", presencial: 30, whatsapp: 34 },
  { date: "2024-04-07", presencial: 24, whatsapp: 18 },
  { date: "2024-04-08", presencial: 40, whatsapp: 32 },
  { date: "2024-04-09", presencial: 5, whatsapp: 11 },
  { date: "2024-04-10", presencial: 26, whatsapp: 19 },
  { date: "2024-04-11", presencial: 32, whatsapp: 35 },
  { date: "2024-04-12", presencial: 29, whatsapp: 21 },
  { date: "2024-04-13", presencial: 34, whatsapp: 38 },
  { date: "2024-04-14", presencial: 13, whatsapp: 22 },
  { date: "2024-04-15", presencial: 12, whatsapp: 17 },
  { date: "2024-04-16", presencial: 13, whatsapp: 19 },
  { date: "2024-04-17", presencial: 44, whatsapp: 36 },
  { date: "2024-04-18", presencial: 36, whatsapp: 41 },
  { date: "2024-04-19", presencial: 24, whatsapp: 18 },
  { date: "2024-04-20", presencial: 8, whatsapp: 15 },
  { date: "2024-04-21", presencial: 13, whatsapp: 20 },
  { date: "2024-04-22", presencial: 22, whatsapp: 17 },
  { date: "2024-04-23", presencial: 13, whatsapp: 23 },
  { date: "2024-04-24", presencial: 38, whatsapp: 29 },
  { date: "2024-04-25", presencial: 21, whatsapp: 25 },
  { date: "2024-04-26", presencial: 7, whatsapp: 13 },
  { date: "2024-04-27", presencial: 38, whatsapp: 42 },
  { date: "2024-04-28", presencial: 12, whatsapp: 18 },
  { date: "2024-04-29", presencial: 31, whatsapp: 24 },
  { date: "2024-04-30", presencial: 45, whatsapp: 38 },
  { date: "2024-05-01", presencial: 16, whatsapp: 22 },
  { date: "2024-05-02", presencial: 29, whatsapp: 31 },
  { date: "2024-05-03", presencial: 24, whatsapp: 19 },
  { date: "2024-05-04", presencial: 38, whatsapp: 42 },
  { date: "2024-05-05", presencial: 48, whatsapp: 39 },
  { date: "2024-05-06", presencial: 49, whatsapp: 52 },
  { date: "2024-05-07", presencial: 38, whatsapp: 30 },
  { date: "2024-05-08", presencial: 14, whatsapp: 21 },
  { date: "2024-05-09", presencial: 22, whatsapp: 18 },
  { date: "2024-05-10", presencial: 29, whatsapp: 33 },
  { date: "2024-05-11", presencial: 33, whatsapp: 27 },
  { date: "2024-05-12", presencial: 19, whatsapp: 24 },
  { date: "2024-05-13", presencial: 19, whatsapp: 16 },
  { date: "2024-05-14", presencial: 44, whatsapp: 49 },
  { date: "2024-05-15", presencial: 47, whatsapp: 38 },
  { date: "2024-05-16", presencial: 33, whatsapp: 40 },
  { date: "2024-05-17", presencial: 49, whatsapp: 42 },
  { date: "2024-05-18", presencial: 31, whatsapp: 35 },
  { date: "2024-05-19", presencial: 23, whatsapp: 18 },
  { date: "2024-05-20", presencial: 17, whatsapp: 23 },
  { date: "2024-05-21", presencial: 8, whatsapp: 14 },
  { date: "2024-05-22", presencial: 8, whatsapp: 12 },
  { date: "2024-05-23", presencial: 25, whatsapp: 29 },
  { date: "2024-05-24", presencial: 29, whatsapp: 22 },
  { date: "2024-05-25", presencial: 20, whatsapp: 25 },
  { date: "2024-05-26", presencial: 21, whatsapp: 17 },
  { date: "2024-05-27", presencial: 42, whatsapp: 46 },
  { date: "2024-05-28", presencial: 23, whatsapp: 19 },
  { date: "2024-05-29", presencial: 7, whatsapp: 13 },
  { date: "2024-05-30", presencial: 34, whatsapp: 28 },
  { date: "2024-05-31", presencial: 17, whatsapp: 23 },
  { date: "2024-06-01", presencial: 17, whatsapp: 20 },
  { date: "2024-06-02", presencial: 47, whatsapp: 41 },
  { date: "2024-06-03", presencial: 10, whatsapp: 16 },
  { date: "2024-06-04", presencial: 43, whatsapp: 38 },
  { date: "2024-06-05", presencial: 8, whatsapp: 14 },
  { date: "2024-06-06", presencial: 29, whatsapp: 25 },
  { date: "2024-06-07", presencial: 32, whatsapp: 37 },
  { date: "2024-06-08", presencial: 38, whatsapp: 32 },
  { date: "2024-06-09", presencial: 43, whatsapp: 48 },
  { date: "2024-06-10", presencial: 15, whatsapp: 20 },
  { date: "2024-06-11", presencial: 9, whatsapp: 15 },
  { date: "2024-06-12", presencial: 49, whatsapp: 42 },
  { date: "2024-06-13", presencial: 8, whatsapp: 13 },
  { date: "2024-06-14", presencial: 42, whatsapp: 38 },
  { date: "2024-06-15", presencial: 30, whatsapp: 35 },
  { date: "2024-06-16", presencial: 37, whatsapp: 31 },
  { date: "2024-06-17", presencial: 47, whatsapp: 52 },
  { date: "2024-06-18", presencial: 10, whatsapp: 17 },
  { date: "2024-06-19", presencial: 34, whatsapp: 29 },
  { date: "2024-06-20", presencial: 40, whatsapp: 45 },
  { date: "2024-06-21", presencial: 16, whatsapp: 21 },
  { date: "2024-06-22", presencial: 31, whatsapp: 27 },
  { date: "2024-06-23", presencial: 48, whatsapp: 53 },
  { date: "2024-06-24", presencial: 13, whatsapp: 18 },
  { date: "2024-06-25", presencial: 14, whatsapp: 19 },
  { date: "2024-06-26", presencial: 43, whatsapp: 38 },
  { date: "2024-06-27", presencial: 44, whatsapp: 49 },
  { date: "2024-06-28", presencial: 14, whatsapp: 20 },
  { date: "2024-06-29", presencial: 10, whatsapp: 16 },
  { date: "2024-06-30", presencial: 44, whatsapp: 40 },
]

const chartConfig = {
  consultas: {
    label: "Consultas",
  },
  presencial: {
    label: "Presencial",
    color: "var(--primary)",
  },
  whatsapp: {
    label: "WhatsApp",
    color: "var(--primary)",
  },
} satisfies ChartConfig

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("90d")

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d")
    }
  }, [isMobile])

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date("2024-06-30")
    let daysToSubtract = 90
    if (timeRange === "30d") {
      daysToSubtract = 30
    } else if (timeRange === "7d") {
      daysToSubtract = 7
    }
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return date >= startDate
  })

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Actividad de consultas</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Total de los últimos 3 meses
          </span>
          <span className="@[540px]/card:hidden">Últimos 3 meses</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            multiple={false}
            value={timeRange ? [timeRange] : []}
            onValueChange={(value) => {
              setTimeRange(value[0] ?? "90d")
            }}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Últimos 3 meses</ToggleGroupItem>
            <ToggleGroupItem value="30d">Últimos 30 días</ToggleGroupItem>
            <ToggleGroupItem value="7d">Últimos 7 días</ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={timeRange}
            onValueChange={(value) => {
              if (value !== null) {
                setTimeRange(value)
              }
            }}
          >
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Seleccionar un rango"
            >
              <SelectValue placeholder="Últimos 3 meses" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Últimos 3 meses
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Últimos 30 días
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Últimos 7 días
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillPresencial" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-presencial)"
                  stopOpacity={1.0}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-presencial)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillWhatsapp" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-whatsapp)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-whatsapp)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value)
                return date.toLocaleDateString("es-CO", {
                  month: "short",
                  day: "numeric",
                })
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString("es-CO", {
                      month: "short",
                      day: "numeric",
                    })
                  }}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="whatsapp"
              type="natural"
              fill="url(#fillWhatsapp)"
              stroke="var(--color-whatsapp)"
              stackId="a"
            />
            <Area
              dataKey="presencial"
              type="natural"
              fill="url(#fillPresencial)"
              stroke="var(--color-presencial)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
