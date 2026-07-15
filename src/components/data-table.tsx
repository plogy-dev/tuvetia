"use client"

import * as React from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type Row,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { toast } from "sonner"
import { z } from "zod"

import { useIsMobile } from "@/hooks/use-mobile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { GripVerticalIcon, CircleCheckIcon, LoaderIcon, EllipsisVerticalIcon, Columns3Icon, ChevronDownIcon, PlusIcon, ChevronsLeftIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsRightIcon, TrendingUpIcon } from "lucide-react"

export const schema = z.object({
  id: z.number(),
  header: z.string(),
  type: z.string(),
  status: z.string(),
  target: z.string(),
  limit: z.string(),
  reviewer: z.string(),
})

// Create a separate component for the drag handle
function DragHandle({ id }: { id: number }) {
  const { attributes, listeners } = useSortable({
    id,
  })
  return (
    <Button
      {...attributes}
      {...listeners}
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:bg-transparent"
    >
      <GripVerticalIcon className="size-3 text-muted-foreground" />
      <span className="sr-only">Arrastrar para reordenar</span>
    </Button>
  )
}
const columns: ColumnDef<z.infer<typeof schema>>[] = [
  {
    id: "drag",
    header: () => null,
    cell: ({ row }) => <DragHandle id={row.original.id} />,
  },
  {
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={
            table.getIsSomePageRowsSelected() &&
            !table.getIsAllPageRowsSelected()
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Seleccionar todo"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Seleccionar fila"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "header",
    header: "Paciente",
    cell: ({ row }) => {
      return <TableCellViewer item={row.original} />
    },
    enableHiding: false,
  },
  {
    accessorKey: "type",
    header: "Motivo",
    cell: ({ row }) => (
      <div className="w-32">
        <Badge variant="outline" className="px-1.5 text-muted-foreground">
          {row.original.type}
        </Badge>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Estado",
    cell: ({ row }) => (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        {row.original.status === "Completada" ? (
          <CircleCheckIcon className="fill-green-500 dark:fill-green-400" />
        ) : (
          <LoaderIcon
          />
        )}
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "target",
    header: () => <div className="w-full text-right">Peso (kg)</div>,
    cell: ({ row }) => (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          toast.promise(new Promise((resolve) => setTimeout(resolve, 1000)), {
            loading: `Guardando ${row.original.header}`,
            success: "Guardado",
            error: "Error",
          })
        }}
      >
        <Label htmlFor={`${row.original.id}-target`} className="sr-only">
          Peso (kg)
        </Label>
        <Input
          className="h-8 w-16 border-transparent bg-transparent text-right shadow-none hover:bg-input/30 focus-visible:border focus-visible:bg-background dark:bg-transparent dark:hover:bg-input/30 dark:focus-visible:bg-input/30"
          defaultValue={row.original.target}
          id={`${row.original.id}-target`}
        />
      </form>
    ),
  },
  {
    accessorKey: "limit",
    header: () => <div className="w-full text-right">Edad (años)</div>,
    cell: ({ row }) => (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          toast.promise(new Promise((resolve) => setTimeout(resolve, 1000)), {
            loading: `Guardando ${row.original.header}`,
            success: "Guardado",
            error: "Error",
          })
        }}
      >
        <Label htmlFor={`${row.original.id}-limit`} className="sr-only">
          Edad (años)
        </Label>
        <Input
          className="h-8 w-16 border-transparent bg-transparent text-right shadow-none hover:bg-input/30 focus-visible:border focus-visible:bg-background dark:bg-transparent dark:hover:bg-input/30 dark:focus-visible:bg-input/30"
          defaultValue={row.original.limit}
          id={`${row.original.id}-limit`}
        />
      </form>
    ),
  },
  {
    accessorKey: "reviewer",
    header: "Veterinario",
    cell: ({ row }) => {
      const isAssigned = row.original.reviewer !== "Asignar veterinario"
      if (isAssigned) {
        return row.original.reviewer
      }
      return (
        <>
          <Label htmlFor={`${row.original.id}-reviewer`} className="sr-only">
            Veterinario
          </Label>
          <Select
            items={[
              { label: "Dra. Camila Rojas", value: "Dra. Camila Rojas" },
              { label: "Dr. Andrés Gómez", value: "Dr. Andrés Gómez" },
            ]}
          >
            <SelectTrigger
              className="w-38 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate"
              size="sm"
              id={`${row.original.id}-reviewer`}
            >
              <SelectValue placeholder="Asignar veterinario" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                <SelectItem value="Dra. Camila Rojas">Dra. Camila Rojas</SelectItem>
                <SelectItem value="Dr. Andrés Gómez">
                  Dr. Andrés Gómez
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </>
      )
    },
  },
  {
    id: "actions",
    cell: () => (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className="flex size-8 text-muted-foreground data-open:bg-muted"
              size="icon"
            />
          }
        >
          <EllipsisVerticalIcon
          />
          <span className="sr-only">Abrir menú</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem>Editar</DropdownMenuItem>
          <DropdownMenuItem>Duplicar</DropdownMenuItem>
          <DropdownMenuItem>Marcar favorito</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">Eliminar</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]
function DraggableRow({ row }: { row: Row<z.infer<typeof schema>> }) {
  const { transform, transition, setNodeRef, isDragging } = useSortable({
    id: row.original.id,
  })
  return (
    <TableRow
      data-state={row.getIsSelected() && "selected"}
      data-dragging={isDragging}
      ref={setNodeRef}
      className="relative z-0 data-[dragging=true]:z-10 data-[dragging=true]:opacity-80"
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  )
}
export function DataTable({
  data: initialData,
}: {
  data: z.infer<typeof schema>[]
}) {
  const [data, setData] = React.useState(() => initialData)
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })
  const sortableId = React.useId()
  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {})
  )
  const dataIds = React.useMemo<UniqueIdentifier[]>(
    () => data?.map(({ id }) => id) || [],
    [data]
  )
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (active && over && active.id !== over.id) {
      setData((data) => {
        const oldIndex = dataIds.indexOf(active.id)
        const newIndex = dataIds.indexOf(over.id)
        return arrayMove(data, oldIndex, newIndex)
      })
    }
  }
  return (
    <Tabs
      defaultValue="todas"
      className="w-full flex-col justify-start gap-6"
    >
      <div className="flex items-center justify-between px-4 lg:px-6">
        <Label htmlFor="view-selector" className="sr-only">
          Vista
        </Label>
        <Select
          defaultValue="todas"
          items={[
            { label: "Todas", value: "todas" },
            { label: "Pendientes", value: "pendientes" },
            { label: "En revisión", value: "en-revision" },
            { label: "Completadas", value: "completadas" },
          ]}
        >
          <SelectTrigger
            className="flex w-fit @4xl/main:hidden"
            size="sm"
            id="view-selector"
          >
            <SelectValue placeholder="Seleccionar vista" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="pendientes">Pendientes</SelectItem>
              <SelectItem value="en-revision">En revisión</SelectItem>
              <SelectItem value="completadas">Completadas</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <TabsList className="hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:px-1 @4xl/main:flex">
          <TabsTrigger value="todas">Todas</TabsTrigger>
          <TabsTrigger value="pendientes">
            Pendientes <Badge variant="secondary">3</Badge>
          </TabsTrigger>
          <TabsTrigger value="en-revision">
            En revisión <Badge variant="secondary">2</Badge>
          </TabsTrigger>
          <TabsTrigger value="completadas">Completadas</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
            >
              <Columns3Icon data-icon="inline-start" />
              Columnas
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              {table
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== "undefined" &&
                    column.getCanHide()
                )
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {column.id}
                    </DropdownMenuCheckboxItem>
                  )
                })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm">
            <PlusIcon
            />
            <span className="hidden lg:inline">Agregar consulta</span>
          </Button>
        </div>
      </div>
      <TabsContent
        value="todas"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
      >
        <div className="overflow-hidden rounded-lg border">
          <DndContext
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            sensors={sensors}
            id={sortableId}
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      return (
                        <TableHead key={header.id} colSpan={header.colSpan}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody className="**:data-[slot=table-cell]:first:w-8">
                {table.getRowModel().rows?.length ? (
                  <SortableContext
                    items={dataIds}
                    strategy={verticalListSortingStrategy}
                  >
                    {table.getRowModel().rows.map((row) => (
                      <DraggableRow key={row.id} row={row} />
                    ))}
                  </SortableContext>
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      Sin resultados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>
        <div className="flex items-center justify-between px-4">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
            {table.getFilteredSelectedRowModel().rows.length} de{" "}
            {table.getFilteredRowModel().rows.length} fila(s) seleccionada(s).
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Filas por página
              </Label>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => {
                  table.setPageSize(Number(value))
                }}
                items={[10, 20, 30, 40, 50].map((pageSize) => ({
                  label: `${pageSize}`,
                  value: `${pageSize}`,
                }))}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue
                    placeholder={table.getState().pagination.pageSize}
                  />
                </SelectTrigger>
                <SelectContent side="top">
                  <SelectGroup>
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>
                        {pageSize}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Página {table.getState().pagination.pageIndex + 1} de{" "}
              {table.getPageCount()}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Ir a la primera página</span>
                <ChevronsLeftIcon
                />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Ir a la página anterior</span>
                <ChevronLeftIcon
                />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Ir a la página siguiente</span>
                <ChevronRightIcon
                />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Ir a la última página</span>
                <ChevronsRightIcon
                />
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>
      <TabsContent
        value="pendientes"
        className="flex flex-col px-4 lg:px-6"
      >
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed"></div>
      </TabsContent>
      <TabsContent value="en-revision" className="flex flex-col px-4 lg:px-6">
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed"></div>
      </TabsContent>
      <TabsContent
        value="completadas"
        className="flex flex-col px-4 lg:px-6"
      >
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed"></div>
      </TabsContent>
    </Tabs>
  )
}
const chartData = [
  {
    month: "Enero",
    presencial: 32,
    whatsapp: 18,
  },
  {
    month: "Febrero",
    presencial: 41,
    whatsapp: 28,
  },
  {
    month: "Marzo",
    presencial: 35,
    whatsapp: 22,
  },
  {
    month: "Abril",
    presencial: 20,
    whatsapp: 26,
  },
  {
    month: "Mayo",
    presencial: 29,
    whatsapp: 19,
  },
  {
    month: "Junio",
    presencial: 31,
    whatsapp: 21,
  },
]
const chartConfig = {
  presencial: {
    label: "Presencial",
    color: "var(--primary)",
  },
  whatsapp: {
    label: "WhatsApp",
    color: "var(--primary)",
  },
} satisfies ChartConfig
function TableCellViewer({ item }: { item: z.infer<typeof schema> }) {
  const isMobile = useIsMobile()
  return (
    <Drawer swipeDirection={isMobile ? "down" : "right"}>
      <DrawerTrigger
        render={
          <Button
            variant="link"
            className="w-fit px-0 text-left text-foreground"
          />
        }
      >
        {item.header}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle>{item.header}</DrawerTitle>
          <DrawerDescription>
            Historial de consultas de los últimos 6 meses
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
          {!isMobile && (
            <>
              <ChartContainer config={chartConfig}>
                <AreaChart
                  accessibilityLayer
                  data={chartData}
                  margin={{
                    left: 0,
                    right: 10,
                  }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => value.slice(0, 3)}
                    hide
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="dot" />}
                  />
                  <Area
                    dataKey="whatsapp"
                    type="natural"
                    fill="var(--color-whatsapp)"
                    fillOpacity={0.6}
                    stroke="var(--color-whatsapp)"
                    stackId="a"
                  />
                  <Area
                    dataKey="presencial"
                    type="natural"
                    fill="var(--color-presencial)"
                    fillOpacity={0.4}
                    stroke="var(--color-presencial)"
                    stackId="a"
                  />
                </AreaChart>
              </ChartContainer>
              <Separator />
              <div className="grid gap-2">
                <div className="flex gap-2 leading-none font-medium">
                  Aumento del 5.2% este mes{" "}
                  <TrendingUpIcon className="size-4" />
                </div>
                <div className="text-muted-foreground">
                  Historial de actividad clínica de los últimos 6 meses para
                  este paciente.
                </div>
              </div>
              <Separator />
            </>
          )}
          <form className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <Label htmlFor="header">Paciente</Label>
              <Input id="header" defaultValue={item.header} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <Label htmlFor="type">Motivo</Label>
                <Select
                  defaultValue={item.type}
                  items={[
                    { label: "Chequeo general", value: "Chequeo general" },
                    { label: "Vacunación", value: "Vacunación" },
                    { label: "Control", value: "Control" },
                    { label: "Urgencia", value: "Urgencia" },
                    { label: "Cirugía", value: "Cirugía" },
                    { label: "Desparasitación", value: "Desparasitación" },
                    { label: "Estética", value: "Estética" },
                  ]}
                >
                  <SelectTrigger id="type" className="w-full">
                    <SelectValue placeholder="Seleccionar un motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="Chequeo general">
                        Chequeo general
                      </SelectItem>
                      <SelectItem value="Vacunación">Vacunación</SelectItem>
                      <SelectItem value="Control">Control</SelectItem>
                      <SelectItem value="Urgencia">Urgencia</SelectItem>
                      <SelectItem value="Cirugía">Cirugía</SelectItem>
                      <SelectItem value="Desparasitación">
                        Desparasitación
                      </SelectItem>
                      <SelectItem value="Estética">Estética</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-3">
                <Label htmlFor="status">Estado</Label>
                <Select
                  defaultValue={item.status}
                  items={[
                    { label: "Completada", value: "Completada" },
                    { label: "En progreso", value: "En progreso" },
                    { label: "Programada", value: "Programada" },
                  ]}
                >
                  <SelectTrigger id="status" className="w-full">
                    <SelectValue placeholder="Seleccionar un estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="Completada">Completada</SelectItem>
                      <SelectItem value="En progreso">En progreso</SelectItem>
                      <SelectItem value="Programada">Programada</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <Label htmlFor="target">Peso (kg)</Label>
                <Input id="target" defaultValue={item.target} />
              </div>
              <div className="flex flex-col gap-3">
                <Label htmlFor="limit">Edad (años)</Label>
                <Input id="limit" defaultValue={item.limit} />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label htmlFor="reviewer">Veterinario</Label>
              <Select
                defaultValue={item.reviewer}
                items={[
                  { label: "Dra. Camila Rojas", value: "Dra. Camila Rojas" },
                  { label: "Dr. Andrés Gómez", value: "Dr. Andrés Gómez" },
                  { label: "Dra. Valentina Ruiz", value: "Dra. Valentina Ruiz" },
                ]}
              >
                <SelectTrigger id="reviewer" className="w-full">
                  <SelectValue placeholder="Seleccionar un veterinario" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="Dra. Camila Rojas">
                      Dra. Camila Rojas
                    </SelectItem>
                    <SelectItem value="Dr. Andrés Gómez">
                      Dr. Andrés Gómez
                    </SelectItem>
                    <SelectItem value="Dra. Valentina Ruiz">
                      Dra. Valentina Ruiz
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </form>
        </div>
        <DrawerFooter>
          <Button>Guardar</Button>
          <DrawerClose render={<Button variant="outline" />}>Cerrar</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
