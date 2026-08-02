import type { Metadata } from "next";
import DemoPage from "@/components/subpages/DemoPage";
import "@/app/subpages.css";

const TITULO = "Agenda una demo · Tuvetia";
const DESCRIPCION =
  "20 minutos. Traes un caso real, lo cuentas en voz alta, y ves la ficha escribirse sola. Te escribe un fundador, no un vendedor.";

// Ver la nota en `producto/page.tsx`: sin `openGraph` propio, esta ruta se comparte con el título
// de la home. Y ésta es justo la que más se comparte.
export const metadata: Metadata = {
  title: TITULO,
  description: DESCRIPCION,
  openGraph: { title: TITULO, description: DESCRIPCION },
  twitter: { title: TITULO, description: DESCRIPCION },
};

export default function Page() {
  return <DemoPage />;
}
