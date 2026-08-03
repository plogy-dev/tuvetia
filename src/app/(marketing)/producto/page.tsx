import type { Metadata } from "next";
import ProductoPage from "@/components/subpages/ProductoPage";
import "@/app/subpages.css";

const TITULO = "El producto · Tuvetia";
const DESCRIPCION =
  "Athos oye tu consulta, escribe la ficha y contesta el WhatsApp. Tú firmas. Una sola inteligencia, tres caras, conectada a todo tu día clínico.";

// `openGraph` se repite a propósito: Next NO deriva `openGraph.title` del `title` de la página, así
// que sin esto compartir /producto mostraba el título de la home (el del layout del grupo). La
// imagen sí se hereda.
export const metadata: Metadata = {
  title: TITULO,
  description: DESCRIPCION,
  openGraph: { title: TITULO, description: DESCRIPCION },
  twitter: { title: TITULO, description: DESCRIPCION },
};

export default function Page() {
  return <ProductoPage />;
}
