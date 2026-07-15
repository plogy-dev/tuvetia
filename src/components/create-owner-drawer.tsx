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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useIsMobile } from "@/hooks/use-mobile"
import { PlusIcon, Loader2Icon } from "lucide-react"

export function CreateOwnerDrawer() {
  const isMobile = useIsMobile()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [documentId, setDocumentId] = useState("")
  const [address, setAddress] = useState("")

  function resetForm() {
    setFullName("")
    setPhone("")
    setEmail("")
    setDocumentId("")
    setAddress("")
    setError(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) resetForm()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc("create_owner", {
      p_full_name: fullName.trim(),
      p_phone: phone.trim() || null,
      p_email: email.trim() || null,
      p_document_id: documentId.trim() || null,
      p_address: address.trim() || null,
    })

    setLoading(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    toast.success(`${fullName} se registró correctamente`)
    setOpen(false)
    resetForm()
    router.refresh()
  }

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      swipeDirection={isMobile ? "down" : "right"}
    >
      <DrawerTrigger render={<Button />}>
        <PlusIcon />
        Nuevo titular
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Nuevo titular</DrawerTitle>
          <DrawerDescription>
            Registra un dueño de mascota para poder asignarle pacientes.
          </DrawerDescription>
        </DrawerHeader>
        <form
          id="create-owner-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 overflow-y-auto px-4 text-sm"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="owner-full-name">Nombre completo</FieldLabel>
              <Input
                id="owner-full-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="owner-phone-full">Teléfono</FieldLabel>
                <Input
                  id="owner-phone-full"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="owner-email-full">Email</FieldLabel>
                <Input
                  id="owner-email-full"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="owner-document">Documento</FieldLabel>
                <Input
                  id="owner-document"
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="owner-address">Dirección</FieldLabel>
                <Input
                  id="owner-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </Field>
            </div>
            {error && (
              <FieldDescription className="text-destructive">
                {error}
              </FieldDescription>
            )}
          </FieldGroup>
        </form>
        <DrawerFooter>
          <Button type="submit" form="create-owner-form" disabled={loading}>
            {loading && <Loader2Icon className="animate-spin" />}
            Crear titular
          </Button>
          <DrawerClose render={<Button variant="outline" />}>
            Cancelar
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
