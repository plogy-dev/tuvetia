"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SidebarMenuButton } from "@/components/ui/sidebar"
import { useIsMobile } from "@/hooks/use-mobile"
import { CirclePlusIcon, Loader2Icon } from "lucide-react"

type Owner = {
  id: string
  full_name: string
  phone: string | null
}

const NEW_OWNER = "__new__"

export function CreatePatientDrawer() {
  const isMobile = useIsMobile()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [owners, setOwners] = useState<Owner[] | null>(null)
  const [ownersLoading, setOwnersLoading] = useState(false)
  const [ownerId, setOwnerId] = useState<string>(NEW_OWNER)

  const [name, setName] = useState("")
  const [species, setSpecies] = useState("")
  const [breed, setBreed] = useState("")
  const [sex, setSex] = useState<"male" | "female" | "unknown">("unknown")
  const [birthDate, setBirthDate] = useState("")
  const [weight, setWeight] = useState("")

  const [ownerName, setOwnerName] = useState("")
  const [ownerPhone, setOwnerPhone] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")

  function resetForm() {
    setName("")
    setSpecies("")
    setBreed("")
    setSex("unknown")
    setBirthDate("")
    setWeight("")
    setOwnerId(NEW_OWNER)
    setOwnerName("")
    setOwnerPhone("")
    setOwnerEmail("")
    setError(null)
  }

  async function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      resetForm()
      return
    }
    if (owners !== null) return
    setOwnersLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("owners")
      .select("id, full_name, phone")
      .order("full_name")
    setOwners(data ?? [])
    setOwnersLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (ownerId === NEW_OWNER && !ownerName.trim()) {
      setError("El titular necesita un nombre.")
      return
    }

    setLoading(true)
    const supabase = createClient()

    let finalOwnerId = ownerId

    if (ownerId === NEW_OWNER) {
      const { data: newOwnerId, error: ownerError } = await supabase.rpc(
        "create_owner",
        {
          p_full_name: ownerName.trim(),
          p_phone: ownerPhone.trim() || null,
          p_email: ownerEmail.trim() || null,
        }
      )
      if (ownerError || !newOwnerId) {
        setLoading(false)
        setError(ownerError?.message ?? "No se pudo crear el titular.")
        return
      }
      finalOwnerId = newOwnerId
    }

    const { error: patientError } = await supabase.rpc("create_patient", {
      p_owner_id: finalOwnerId,
      p_name: name.trim(),
      p_species: species.trim(),
      p_sex: sex,
      p_breed: breed.trim() || null,
      p_birth_date: birthDate || null,
      p_weight_kg: weight ? Number(weight) : null,
    })

    setLoading(false)

    if (patientError) {
      setError(patientError.message)
      return
    }

    toast.success(`${name} se registró correctamente`)
    setOpen(false)
    resetForm()
    router.push("/dashboard/patients")
    router.refresh()
  }

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      swipeDirection={isMobile ? "down" : "right"}
    >
      <DrawerTrigger
        render={
          <SidebarMenuButton
            tooltip="Crear paciente"
            className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
          />
        }
      >
        <CirclePlusIcon />
        <span>Crear paciente</span>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Crear paciente</DrawerTitle>
          <DrawerDescription>
            Registra una nueva mascota y, si hace falta, a su titular.
          </DrawerDescription>
        </DrawerHeader>
        <form
          id="create-patient-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 overflow-y-auto px-4 text-sm"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="patient-name">Nombre de la mascota</FieldLabel>
              <Input
                id="patient-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="patient-species">Especie</FieldLabel>
                <Input
                  id="patient-species"
                  placeholder="Perro, Gato..."
                  value={species}
                  onChange={(e) => setSpecies(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="patient-breed">Raza</FieldLabel>
                <Input
                  id="patient-breed"
                  value={breed}
                  onChange={(e) => setBreed(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field>
                <FieldLabel htmlFor="patient-sex">Sexo</FieldLabel>
                <Select
                  value={sex}
                  onValueChange={(value) =>
                    setSex(value as "male" | "female" | "unknown")
                  }
                  items={[
                    { label: "Macho", value: "male" },
                    { label: "Hembra", value: "female" },
                    { label: "Desconocido", value: "unknown" },
                  ]}
                >
                  <SelectTrigger id="patient-sex" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="male">Macho</SelectItem>
                      <SelectItem value="female">Hembra</SelectItem>
                      <SelectItem value="unknown">Desconocido</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="patient-birth-date">Nacimiento</FieldLabel>
                <Input
                  id="patient-birth-date"
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="patient-weight">Peso (kg)</FieldLabel>
                <Input
                  id="patient-weight"
                  type="number"
                  step="0.1"
                  min="0"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="patient-owner">Titular</FieldLabel>
              <Select
                value={ownerId}
                onValueChange={(value) => setOwnerId(value ?? NEW_OWNER)}
                disabled={ownersLoading}
                items={[
                  { label: "+ Nuevo titular", value: NEW_OWNER },
                  ...(owners ?? []).map((owner) => ({
                    label: owner.phone
                      ? `${owner.full_name} · ${owner.phone}`
                      : owner.full_name,
                    value: owner.id,
                  })),
                ]}
              >
                <SelectTrigger id="patient-owner" className="w-full">
                  <SelectValue
                    placeholder={
                      ownersLoading ? "Cargando titulares..." : "Selecciona"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NEW_OWNER}>+ Nuevo titular</SelectItem>
                    {owners?.map((owner) => (
                      <SelectItem key={owner.id} value={owner.id}>
                        {owner.phone
                          ? `${owner.full_name} · ${owner.phone}`
                          : owner.full_name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            {ownerId === NEW_OWNER && (
              <>
                <Field>
                  <FieldLabel htmlFor="owner-name">
                    Nombre del titular
                  </FieldLabel>
                  <Input
                    id="owner-name"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    required={ownerId === NEW_OWNER}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="owner-phone">Teléfono</FieldLabel>
                    <Input
                      id="owner-phone"
                      type="tel"
                      value={ownerPhone}
                      onChange={(e) => setOwnerPhone(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="owner-email">Email</FieldLabel>
                    <Input
                      id="owner-email"
                      type="email"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                    />
                  </Field>
                </div>
              </>
            )}

            {error && (
              <FieldDescription className="text-destructive">
                {error}
              </FieldDescription>
            )}
          </FieldGroup>
        </form>
        <DrawerFooter>
          <Button type="submit" form="create-patient-form" disabled={loading}>
            {loading && <Loader2Icon className="animate-spin" />}
            Crear paciente
          </Button>
          <DrawerClose render={<Button variant="outline" />}>
            Cancelar
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
