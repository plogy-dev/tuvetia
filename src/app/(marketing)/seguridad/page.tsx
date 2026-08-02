import type { Metadata } from "next";
import SeguridadPage from "@/components/subpages/SeguridadPage";
import "@/app/subpages.css";

const TITULO = "Datos y seguridad · Tuvetia";
const DESCRIPCION =
  "El audio se borra a los 4 días. No entrenamos con tus datos. Nada clínico sale sin tu firma. Tus datos nunca son rehenes.";

// Ver la nota en `producto/page.tsx`.
export const metadata: Metadata = {
  title: TITULO,
  description: DESCRIPCION,
  openGraph: { title: TITULO, description: DESCRIPCION },
  twitter: { title: TITULO, description: DESCRIPCION },
};

export default function Page() {
  return <SeguridadPage />;
}
